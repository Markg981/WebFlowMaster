import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { RequestHandler } from 'express';
import passport from 'passport';
import { QueueEvents, Job } from 'bullmq';
import { connection } from './redis';
import { TEST_EXECUTION_QUEUE_NAME, testExecutionQueue } from './queue';
import loggerPromise from './logger';
import { privilegedDb } from './db';
import { executionLogs, testPlanExecutions, type User as SelectUser } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { getCorrelationId } from './middleware/correlation';
import { getSessionMiddleware } from './auth';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';

/**
 * Execution Log Entry — the structure sent to WebSocket subscribers
 * and persisted to the execution_logs table.
 */
export interface ExecutionLogEntry {
  level: 'info' | 'warn' | 'error' | 'step' | 'debug';
  source: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, any>;
  testCaseResultId?: string;
}

/**
 * WebSocket Emitter — returned from setupWebSockets so services
 * can push structured log entries to subscribed frontend clients.
 */
export interface WsEmitter {
  emitExecutionLog(executionId: string, logEntry: ExecutionLogEntry): void;
}

/** A socket that has completed the authenticated upgrade handshake. */
type AuthenticatedWebSocket = WebSocket & { organizationId: number; userId: number };

// Global emitter reference, set after setupWebSockets is called
let globalWsEmitter: WsEmitter | null = null;

/**
 * Get the global WebSocket emitter. Returns a no-op emitter if WebSocket
 * hasn't been initialized yet (safe to call during startup).
 */
export function getWsEmitter(): WsEmitter {
  return globalWsEmitter || {
    emitExecutionLog: () => {} // no-op fallback
  };
}

/** Runs one Express-style middleware against a raw (req, res) pair and awaits its `next()`. */
function runMiddleware(mw: RequestHandler, req: any, res: any): Promise<void> {
  return new Promise((resolve, reject) => {
    mw(req, res, (err?: any) => (err ? reject(err) : resolve()));
  });
}

/**
 * Resolves the session user for a raw WebSocket upgrade request, the same way Express
 * resolves `req.user` for an HTTP request — by running the exact session middleware
 * `setupAuth` mounted (same secret, same store; see server/auth.ts's getSessionMiddleware)
 * followed by passport's initialize/session middleware, against a minimal stub response.
 *
 * The stub response is safe here because session/passport only touch it during this call to
 * read `req`/attach `req.session` and `req.user`; the code paths that write to a response
 * (saving the session, setting the Set-Cookie header) are wired through `res.end`/
 * `res.writeHead`, which are never invoked on an upgrade request — the socket is handed off
 * to `wss.handleUpgrade` instead of ever completing an HTTP response.
 */
async function authenticateUpgrade(req: IncomingMessage): Promise<SelectUser | undefined> {
  const res = {} as any;
  await runMiddleware(getSessionMiddleware(), req, res);
  await runMiddleware(passport.initialize(), req, res);
  await runMiddleware(passport.session(), req, res);
  return (req as any).user as SelectUser | undefined;
}

/**
 * Confirms the given execution belongs to the given organization, the same way an HTTP
 * handler would under RLS: `runWithTenant` establishes the ambient organization (there is no
 * Express request/tenancyMiddleware for a WebSocket message to inherit it from), and
 * `withTenantTransaction` opens a transaction under `app_user` with that organization bound to
 * `app.current_org`. The SELECT carries no explicit organization filter — RLS supplies it — so
 * a row comes back if and only if the execution exists *and* belongs to this organization.
 * Both "no such execution" and "exists, but someone else's" therefore produce the same
 * `false`, which is what keeps the subscribe response from being an existence oracle.
 */
async function isExecutionInOrganization(executionId: string, organizationId: number): Promise<boolean> {
  return runWithTenant(organizationId, () =>
    withTenantTransaction(async (tx) => {
      const [row] = await tx
        .select({ id: testPlanExecutions.id })
        .from(testPlanExecutions)
        .where(eq(testPlanExecutions.id, executionId))
        .limit(1);
      return !!row;
    }),
  );
}

export async function setupWebSockets(server: Server): Promise<WsEmitter> {
  const logger = await loggerPromise;
  const wss = new WebSocketServer({ noServer: true });

  // ─── Room-based subscriptions ───────────────────────────────────────────
  // Map: executionId → Set<WebSocket clients>
  const subscriptions = new Map<string, Set<WebSocket>>();

  // Memoizes executionId -> organizationId lookups for emitExecutionLog, which fires once
  // per emitted log line on the execution hot path. Without this, every log line would
  // cost its own SELECT; an execution's organizationId never changes, so the first lookup
  // is reused for the rest of that execution's logs.
  //
  // Bounded with LRU eviction, the same rule the rest of this codebase's long-lived maps
  // follow (see BreadcrumbRing and fingerprintState in server/observability): this map is
  // keyed by "every execution this process has ever emitted a log for" and the server runs
  // indefinitely, so without a cap it only grows. Evicting a key costs one SELECT the next
  // time that execution logs anything, which is the correct trade.
  const MAX_CACHED_EXECUTIONS = 500;
  const executionOrgCache = new Map<string, number>();

  function rememberExecutionOrg(executionId: string, organizationId: number) {
    // Re-insert to mark most-recently-used: Map iterates in insertion order, so the first key
    // is the oldest.
    executionOrgCache.delete(executionId);
    executionOrgCache.set(executionId, organizationId);
    while (executionOrgCache.size > MAX_CACHED_EXECUTIONS) {
      const oldest = executionOrgCache.keys().next();
      if (oldest.done) break;
      executionOrgCache.delete(oldest.value);
    }
  }

  /** Sends a message only to sockets subscribed to this execution's room. */
  function broadcastToExecution(executionId: string, message: any) {
    const clients = subscriptions.get(executionId);
    if (!clients || clients.size === 0) return;
    const payload = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  // ─── Authenticate the upgrade before the handshake completes ────────────
  // Switching from `{ server, path: '/ws' }` to `noServer: true` + a manual 'upgrade' handler
  // means an unauthenticated client is refused a 401 before any WebSocket ever opens, instead
  // of being allowed to connect and policed per-message. Other listeners on this same 'upgrade'
  // event (e.g. Vite's HMR websocket in dev, wired up by setupVite) are left alone: this
  // handler only acts on the '/ws' path and otherwise returns without touching the socket.
  server.on('upgrade', (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '', 'http://localhost').pathname;
    } catch {
      pathname = '';
    }
    if (pathname !== '/ws') {
      return;
    }

    authenticateUpgrade(req)
      .then((user) => {
        if (!user) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req, user);
        });
      })
      .catch((err) => {
        logger.error('WebSocket upgrade authentication failed', { error: (err as Error).message });
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, user: SelectUser) => {
    const authedWs = ws as AuthenticatedWebSocket;
    authedWs.organizationId = user.organizationId;
    authedWs.userId = user.id;

    logger.info('WebSocket client connected', { userId: user.id, organizationId: user.organizationId });

    authedWs.on('message', (raw) => {
      void (async () => {
        try {
          const msg = JSON.parse(raw.toString());

          // Client subscribes to a specific execution's logs. Refused (not added to the room)
          // unless the execution belongs to this socket's organization.
          if (msg.type === 'subscribe-execution' && msg.executionId) {
            const execId = String(msg.executionId);
            const authorized = await isExecutionInOrganization(execId, authedWs.organizationId);
            if (!authorized) {
              // Same response for "no such execution" and "exists, but not yours" — see
              // isExecutionInOrganization's doc comment.
              authedWs.send(JSON.stringify({ type: 'subscribe-error', executionId: execId, error: 'Not found' }));
              logger.debug(`Subscribe refused for execution ${execId}: not visible to this organization`);
              return;
            }

            if (!subscriptions.has(execId)) {
              subscriptions.set(execId, new Set());
            }
            subscriptions.get(execId)!.add(authedWs);
            authedWs.send(JSON.stringify({ type: 'subscribed', executionId: execId }));
            logger.debug(`Client subscribed to execution: ${execId}`);
          }

          if (msg.type === 'unsubscribe-execution' && msg.executionId) {
            subscriptions.get(String(msg.executionId))?.delete(authedWs);
            logger.debug(`Client unsubscribed from execution: ${msg.executionId}`);
          }
        } catch (e) {
          // Ignore malformed messages
        }
      })();
    });

    authedWs.on('close', () => {
      // Clean up all subscriptions for this client
      for (const [, clients] of subscriptions) {
        clients.delete(authedWs);
      }
    });
  });

  // ─── BullMQ Queue Events ─────────────────────────────────────────────────
  // Lifecycle events fire for every job on the shared queue, including jobs (e.g. scheduler
  // triggers) that carry no per-execution data. jobId is a BullMQ-internal id, not the
  // executionId, so each handler looks up the job to find its testPlanRunId and routes the
  // message through the same subscription room emitExecutionLog uses — which is already
  // authorization-checked by isExecutionInOrganization above. A job with no resolvable
  // execution is dropped rather than broadcast, since there is no room whose membership has
  // been checked against it.
  const queueEvents = new QueueEvents(TEST_EXECUTION_QUEUE_NAME, { connection });

  async function resolveExecutionIdForJob(jobId: string | undefined): Promise<string | undefined> {
    if (!jobId) return undefined;
    try {
      const job = await Job.fromId(testExecutionQueue, jobId);
      return (job?.data as { testPlanRunId?: string } | undefined)?.testPlanRunId;
    } catch (err) {
      logger.error('Failed to resolve execution id for queue job', { jobId, error: (err as Error).message });
      return undefined;
    }
  }

  queueEvents.on('active', ({ jobId }: { jobId: string }) => {
    void (async () => {
      const executionId = await resolveExecutionIdForJob(jobId);
      if (!executionId) return;
      broadcastToExecution(executionId, { type: 'job-active', jobId, log: `[SYSTEM] Job ${jobId} is active and running.` });
    })();
  });

  queueEvents.on('completed', ({ jobId }: { jobId: string }) => {
    void (async () => {
      const executionId = await resolveExecutionIdForJob(jobId);
      if (!executionId) return;
      broadcastToExecution(executionId, { type: 'job-completed', jobId, log: `[SYSTEM] Job ${jobId} PASSED successfully.` });
    })();
  });

  queueEvents.on('failed', ({ jobId, failedReason }: { jobId: string | undefined; failedReason: string }) => {
    void (async () => {
      const executionId = await resolveExecutionIdForJob(jobId);
      if (!executionId) return;
      broadcastToExecution(executionId, { type: 'job-failed', jobId, log: `[SYSTEM] Job ${jobId} FAILED: ${failedReason}` });
    })();
  });

  queueEvents.on('progress', ({ jobId, data }: { jobId: string; data: any }) => {
    void (async () => {
      if (!(typeof data === 'object' && data !== null && 'log' in data)) return;
      const executionId = await resolveExecutionIdForJob(jobId);
      if (!executionId) return;
      broadcastToExecution(executionId, { type: 'job-progress', jobId, log: data.log });
    })();
  });

  // ─── Emitter for execution-specific logs ────────────────────────────────
  const emitter: WsEmitter = {
    emitExecutionLog(executionId: string, logEntry: ExecutionLogEntry) {
      // 1. Persist to database (async, fire-and-forget). An execution log belongs to the
      // same organization as its parent testPlanExecutions row; look it up (once per
      // execution, via executionOrgCache) rather than threading organizationId through
      // every emitExecutionLog call site.
      (async () => {
        let organizationId = executionOrgCache.get(executionId);
        if (organizationId === undefined) {
          const [execution] = await privilegedDb
            .select({ organizationId: testPlanExecutions.organizationId })
            .from(testPlanExecutions)
            .where(eq(testPlanExecutions.id, executionId))
            .limit(1);
          if (!execution) {
            // Preserve pre-lookup behavior: a log for an execution that doesn't exist is a
            // persistence failure worth surfacing via the catch below, not a silent no-op.
            throw new Error(`No test plan execution found for id ${executionId}`);
          }
          organizationId = execution.organizationId;
        }
        rememberExecutionOrg(executionId, organizationId);

        await privilegedDb.insert(executionLogs).values({
          organizationId,
          testPlanExecutionId: executionId,
          timestamp: new Date(logEntry.timestamp),
          level: logEntry.level,
          source: logEntry.source,
          message: logEntry.message,
          metadata: logEntry.metadata || null,
          testCaseResultId: logEntry.testCaseResultId || null,
          correlationId: getCorrelationId() || null,
        });
      })().catch(err => {
        // Don't let DB errors break log streaming
        logger.error('Failed to persist execution log', { executionId, error: (err as Error).message });
      });

      // 2. Send to subscribed WebSocket clients
      broadcastToExecution(executionId, {
        type: 'execution-log',
        executionId,
        ...logEntry,
      });

      // 3. Also send the legacy log shape for the old LiveConsole — scoped to the same room,
      // not broadcast to every connected client regardless of tenant or subscription.
      broadcastToExecution(executionId, {
        type: 'job-progress',
        jobId: executionId,
        log: `[${logEntry.level.toUpperCase()}] [${logEntry.source}] ${logEntry.message}`,
      });
    }
  };

  // Set global reference
  globalWsEmitter = emitter;

  logger.info('WebSocket server initialized with authenticated, room-based subscriptions');
  return emitter;
}
