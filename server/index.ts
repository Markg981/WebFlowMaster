import express from "express";
import { registerRoutes } from "./routes";
import schedulerService from "./scheduler-service"; // Import the scheduler service
import { setupVite, serveStatic } from "./vite";
import 'dotenv/config';
import loggerPromise from './logger'; // Import Winston logger promise
import { privilegedDb, closeDb, assertTenancyPreconditions } from './db';
import { systemSettings } from '@shared/schema'; // Import systemSettings table
import { eq } from 'drizzle-orm'; // Import eq operator
import { setupWebSockets } from './websocket';
import { correlationMiddleware } from './middleware/correlation';
import { csrfOriginCheck } from './middleware/csrf';
import { connection as redisConnection, connectSessionRedis, sessionRedis } from './redis';
import { resolvePort } from './config';
import { inspectSchemaState, describeSchemaState } from './schema-state';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

(async () => {
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

  // ─── Correlation ID middleware (must be FIRST) ──────────────────────────
  // Generates a unique trace ID for each request and propagates it
  // through AsyncLocalStorage to all downstream async operations.
  app.use(correlationMiddleware);

  // ─── CSRF (Origin/Referer) check for state-changing requests ────────────
  // Layered on top of the SameSite=Lax session cookie. Rejects cross-origin
  // browser POST/PUT/PATCH/DELETE; server-to-server calls (no Origin) pass.
  app.use(csrfOriginCheck);

  // ─── Structured request logging middleware ──────────────────────────────
  app.use((req, res, next) => {
    const start = Date.now();
    const requestPath = req.path;

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
  // request. Non-fatal: a failure is logged loudly and the server still boots (sessions
  // just won't persist), rather than blocking startup entirely.
  if (process.env.NODE_ENV !== "test") {
    try {
      await connectSessionRedis();
    } catch {
      logger.error("Continuing without a Redis session store — logins will not persist.");
    }
  }

  const server = await registerRoutes(app);
  
  const { webhooksRouter } = await import("./webhooks");
  app.use("/api/webhooks", webhooksRouter);
  
  // Set up WebSockets for real-time logging
  await setupWebSockets(server);

  // Initialize the scheduler after routes are registered and DB is presumably ready
  // In a real app, ensure DB connection/migration is complete before this.
  try {
    await schedulerService.initializeScheduler();
    logger.info('Scheduler initialized successfully after routes.');
  } catch (schedulerError) {
    logger.error('Failed to initialize scheduler:', schedulerError);
    // Decide if server should proceed or exit based on severity
  }

  // Records an incident for every unhandled error, then answers as before.
  const { incidentErrorHandler } = await import("./observability/taps/express");
  app.use(incidentErrorHandler(logger));

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
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
        await redisConnection.quit();
        if (sessionRedis.isOpen) await sessionRedis.quit();
        await closeDb();
        logger.info('Graceful shutdown complete.');
        process.exit(0);
      } catch (err) {
        logger.error('Error during graceful shutdown', err);
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
})();
