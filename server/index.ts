import express from "express";
import { mailProviderBodyParser } from './routes/mail-provider.routes';
import { configureEgressProxy } from './egress-proxy';
import { registerRoutes } from "./routes";
import schedulerService from "./scheduler-service"; // Import the scheduler service
import { apiNotFound, serveStatic } from "./static";
import 'dotenv/config';
import loggerPromise, { flushLogs } from './logger'; // Import Winston logger promise
import { privilegedDb, closeDb, assertTenancyPreconditions } from './db';
import { systemSettings } from '@shared/schema'; // Import systemSettings table
import { eq, sql } from 'drizzle-orm'; // Import eq operator
import { setupWebSockets } from './websocket';
import { setupAgentRelay } from './agents/setup';
import { registerCommitStatus } from './commit-status';
import { correlationMiddleware } from './middleware/correlation';
import { csrfOriginCheck } from './middleware/csrf';
import { connection as redisConnection, connectSessionRedis, sessionRedis } from './redis';
import { resolvePort } from './config';
import { assertStartupConfig, connectSessionStore } from './startup-config';
import { inspectSchemaState, describeSchemaState } from './schema-state';
import { redactWebhookPath } from './webhook-tokens';
import { healthRouter } from './health';

import { startTracing } from '../shared/telemetry';
import { applicationMetrics, startMetricsServer } from './observability/metrics';

const stopTracing = startTracing('api');
configureEgressProxy();
const app = express();
// First: probes come every few seconds and would otherwise dominate the request metrics.
app.use(healthRouter({
  database: () => privilegedDb.execute(sql`SELECT 1`),
  redis: () => redisConnection.ping(),
  sessions: () => process.env.NODE_ENV === 'test' || sessionRedis.isReady,
}));
app.use(applicationMetrics.middleware);
app.use(mailProviderBodyParser);
// The API tester sends form-data files and binary bodies inside its JSON, as base64, so its
// proxy gets a larger allowance than the 100KB default everything else keeps. Mounted first:
// the general parser below skips a body that has already been read.
app.use('/api/proxy-api-request', express.json({ limit: '20mb' }));
// An OpenAPI description or a Postman collection can be several megabytes (server/api-import.ts).
app.use('/api/api-tests/import', express.json({ limit: '12mb' }));
// A project's tests as a file (server/test-bundle.ts) can be large.
app.use('/api/tests/import-bundle', express.json({ limit: '24mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

(async () => {
  // First, before the database or Redis is asked anything: a misspelt setting is reported by
  // name instead of hiding behind whichever connection happens to fail first.
  assertStartupConfig();

  const logger = await loggerPromise; // Resolve the logger promise

  // Before anything serves a request: confirm the database is actually configured for tenant
  // isolation. None of it can be checked by the test suite, which runs on PGlite as a
  // superuser, and a misconfiguration here does not fail loudly at the boundary — it either
  // 500s every request or, worse, stops isolating without saying so. Throws with what to fix.
  await assertTenancyPreconditions();

  // And confirm the schema came from the migrations rather than from `db:push`. This is the
  // half of the same question that the check above cannot answer on PGlite, where it returns
  // early: a pushed database has the tables from shared/schema.ts and none of the migrations
  // that are not derivable from it — row-level security among them — so it starts, serves
  // requests, and does not isolate tenants, without a word about any of it.
  const schemaState = await inspectSchemaState();
  if (schemaState.kind === 'unmanaged' || schemaState.kind === 'behind') {
    throw new Error(describeSchemaState(schemaState));
  }

  // A misconfigured artifact store fails here, not on the first screenshot of the first run.
  const { initializeQuotaDefaults } = await import('./tenant-quotas');
  await initializeQuotaDefaults();
  const { artifactStore } = await import('./artifact-store');
  logger.info(`Artifact store: ${artifactStore().kind}`);

  // ─── Correlation ID middleware (must be FIRST) ──────────────────────────
  // Generates a unique trace ID for each request and propagates it
  // through AsyncLocalStorage to all downstream async operations.
  app.use(correlationMiddleware);
  const metricsListener = await startMetricsServer('api', applicationMetrics, []);

  // ─── CSRF (Origin/Referer) check for state-changing requests ────────────
  // Layered on top of the SameSite=Lax session cookie. Rejects cross-origin
  // browser POST/PUT/PATCH/DELETE; server-to-server calls (no Origin) pass.
  app.use(csrfOriginCheck);

  // ─── Structured request logging middleware ──────────────────────────────
  app.use((req, res, next) => {
    const start = Date.now();
    // Masked: a webhook's token can be part of its path, and this line is written for every call.
    const requestPath = redactWebhookPath(req.path);

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (requestPath.startsWith("/api")) {
        // Structured log: each field is a discrete, queryable property
        logger.http('[express] Request completed', {
          method: req.method,
          path: requestPath,
          statusCode: res.statusCode,
          durationMs: duration,
        });
      }
    });

    next();
  });

  // Ensure default system settings, including logRetentionDays
  async function ensureDefaultSystemSettings() {
    const settingsToEnsure = [
      { key: 'logRetentionDays', value: process.env.LOG_RETENTION_DAYS || '7' },
      { key: 'logLevel', value: process.env.LOG_LEVEL || 'info' },
      // Separate from logLevel on purpose: turning the server up to debug should not also
      // flood the ingest endpoint with browser traffic.
      { key: 'clientLogLevel', value: process.env.CLIENT_LOG_LEVEL || 'info' },
      // What the sidebar and the breadcrumb call this installation. It used to read "DMO"
      // in two places in AppShell.tsx, written by hand — which made a product meant to test
      // any web application present itself as the tool of a single customer.
      { key: 'workspaceName', value: process.env.WORKSPACE_NAME || 'WebFlowMaster' },
    ];

    for (const settingToEnsure of settingsToEnsure) {
      try {
        const existingSetting = await privilegedDb.select()
          .from(systemSettings)
          .where(eq(systemSettings.key, settingToEnsure.key))
          .limit(1);

        if (existingSetting.length === 0) {
          await privilegedDb.insert(systemSettings).values(settingToEnsure);
          logger.info(`Initialized default system setting: ${settingToEnsure.key}=${settingToEnsure.value}`);
        }
      } catch (error) {
        // Use the resolved logger here, or console.error if logger itself might fail
        logger.error(`Failed to ensure default system setting for ${settingToEnsure.key}:`, error);
      }
    }
  }

  await ensureDefaultSystemSettings(); // Call during server startup

  // The express-session store needs its node-redis client connected before the first
  // request. Fatal in production, a warning in development (server/startup-config.ts).
  if (process.env.NODE_ENV !== "test") {
    await connectSessionStore(() => connectSessionRedis(), (message) => logger.warn(message));
  }

  // Rate limits counted in Redis, so every web process shares one budget (server/middleware/rate-limit-store.ts).
  if (process.env.NODE_ENV !== "test") {
    const { useRedisForRateLimits } = await import("./middleware/rate-limit-store");
    useRedisForRateLimits(redisConnection);
  }

  const server = await registerRoutes(app);
  
  const { webhooksRouter } = await import("./webhooks");
  // Per client address (server/middleware/rate-limits.ts).
  const { webhookRateLimit } = await import("./middleware/rate-limits");
  app.use("/api/webhooks", webhookRateLimit(), webhooksRouter);
  // Text messages the organizations' test numbers receive, posted by their SMS provider (server/sms-inbox.ts).
  const { smsInboundRouter, SMS_INBOUND_PATH } = await import("./routes/sms-inbox.routes");
  app.use(SMS_INBOUND_PATH, webhookRateLimit(), smsInboundRouter);

  // Provisioning by the organizations' identity providers, with a bearer token of their own.
  const { default: scimRouter, SCIM_BASE_PATH } = await import("./routes/scim.routes");
  app.use(SCIM_BASE_PATH, scimRouter);
  
  // Set up WebSockets for real-time logging
  await setupWebSockets(server);
  // Local agents dial in on the same address: see server/agents/relay.ts.
  await setupAgentRelay(server);
  // Runs queued and cancelled from here report on their commit; the worker reports the rest.
  registerCommitStatus();
  // A run that ends lets its organization's next waiting run start at once (server/run-promotion.ts).
  const { registerRunPromotion } = await import('./run-promotion');
  registerRunPromotion();

  // Initialize the scheduler after routes are registered and DB is presumably ready
  // In a real app, ensure DB connection/migration is complete before this.
  try {
    await schedulerService.initializeScheduler();
    logger.info('Scheduler initialized successfully after routes.');
  } catch (schedulerError) {
    logger.error('Failed to initialize scheduler:', schedulerError);
    // Decide if server should proceed or exit based on severity
  }

  // Ends runs whose worker has stopped answering — see server/run-recovery.ts. Here rather than
  // in the worker: when every worker is gone, somebody still has to say their runs are over.
  const { startRunRecovery } = await import('./run-recovery');
  const stopRunRecovery = process.env.NODE_ENV === 'test' ? () => {} : startRunRecovery();

  // Removes the screenshots, videos and traces of runs older than ARTIFACT_RETENTION_DAYS —
  // see server/artifact-retention.ts.
  const { startArtifactRetention } = await import('./artifact-retention');
  const stopArtifactRetention = process.env.NODE_ENV === 'test' ? () => {} : startArtifactRetention();

  // An /api path nothing above answered is not a client route: without this the catch-all
  // below handed back index.html with 200, so a removed endpoint looked alive and a caller
  // parsing JSON got HTML (collaudo SEC-17).
  app.use("/api", apiNotFound);

  // Records an incident for every unhandled error, then answers as before.
  const { incidentErrorHandler } = await import("./observability/taps/express");
  app.use(incidentErrorHandler(logger));

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    // Imported here rather than at the top: server/vite.ts pulls in vite, a dev dependency
    // that is pruned from the production image, and a static import would be evaluated on
    // load whatever this branch decides.
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // One process serves both the API and the client. PORT overrides the default of 5000,
  // which is what the Vite dev proxy and existing deployments assume.
  const port = resolvePort();
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    // Use the resolved logger for consistency, though the custom `log` was used before
    logger.info(`Server listening on port ${port}`);
  });

  // ─── Graceful shutdown ──────────────────────────────────────────────────────
  // Stop accepting new connections, stop cron jobs, then close Redis and DB so
  // a redeploy/termination doesn't sever in-flight work or leak connections.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Force-exit if cleanup hangs.
    const forceTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit.');
      process.exit(1);
    }, 10000);
    forceTimer.unref();

    server.close(async () => {
      try {
        await schedulerService.shutdownScheduler();
        stopRunRecovery();
        stopArtifactRetention();
        const { closeBrowserTasks } = await import('./browser-tasks');
        await closeBrowserTasks();
        await redisConnection.quit();
        if (sessionRedis.isOpen) await sessionRedis.quit();
        await closeDb();
        await metricsListener?.close();
        await stopTracing();
        logger.info('Graceful shutdown complete.');
        await flushLogs();
        process.exit(0);
      } catch (err) {
        logger.error('Error during graceful shutdown', err);
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
})().catch((error) => {
  // Exit rather than linger: the Redis client retries forever, which would keep a process that
  // failed to start alive and printing connection errors over the one message that matters.
  console.error('[startup] The server did not start:', error);
  process.exit(1);
});
