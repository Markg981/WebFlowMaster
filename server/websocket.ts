import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { QueueEvents } from 'bullmq';
import { connection } from './redis';
import { TEST_EXECUTION_QUEUE_NAME } from './queue';
import loggerPromise from './logger';
import { db } from './db';
import { executionLogs } from '@shared/schema';
import { getCorrelationId } from './middleware/correlation';

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

export async function setupWebSockets(server: Server): Promise<WsEmitter> {
  const logger = await loggerPromise;
  const wss = new WebSocketServer({ server, path: '/ws' });

  // ─── Room-based subscriptions ───────────────────────────────────────────
  // Map: executionId → Set<WebSocket clients>
  const subscriptions = new Map<string, Set<WebSocket>>();

  // All connected clients (for backward-compatible broadcast)
  const allClients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    logger.info('WebSocket client connected');
    allClients.add(ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Client subscribes to a specific execution's logs
        if (msg.type === 'subscribe-execution' && msg.executionId) {
          const execId = msg.executionId;
          if (!subscriptions.has(execId)) {
            subscriptions.set(execId, new Set());
          }
          subscriptions.get(execId)!.add(ws);
          ws.send(JSON.stringify({ type: 'subscribed', executionId: execId }));
          logger.debug(`Client subscribed to execution: ${execId}`);
        }

        if (msg.type === 'unsubscribe-execution' && msg.executionId) {
          subscriptions.get(msg.executionId)?.delete(ws);
          logger.debug(`Client unsubscribed from execution: ${msg.executionId}`);
        }
      } catch (e) {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      allClients.delete(ws);
      // Clean up all subscriptions for this client
      for (const [, clients] of subscriptions) {
        clients.delete(ws);
      }
    });
  });

  // ─── BullMQ Queue Events (backward-compatible broadcast) ────────────────
  const queueEvents = new QueueEvents(TEST_EXECUTION_QUEUE_NAME, { connection });

  queueEvents.on('active', ({ jobId }: { jobId: string }) => {
    broadcastAll({ type: 'job-active', jobId, log: `[SYSTEM] Job ${jobId} is active and running.` });
  });

  queueEvents.on('completed', ({ jobId }: { jobId: string }) => {
    broadcastAll({ type: 'job-completed', jobId, log: `[SYSTEM] Job ${jobId} PASSED successfully.` });
  });

  queueEvents.on('failed', ({ jobId, failedReason }: { jobId: string | undefined; failedReason: string }) => {
    broadcastAll({ type: 'job-failed', jobId, log: `[SYSTEM] Job ${jobId} FAILED: ${failedReason}` });
  });

  queueEvents.on('progress', ({ jobId, data }: { jobId: string; data: any }) => {
    if (typeof data === 'object' && data !== null && 'log' in data) {
      broadcastAll({ type: 'job-progress', jobId, log: data.log });
    }
  });

  /** Broadcast to ALL connected clients (legacy behavior) */
  function broadcastAll(message: any) {
    const payload = JSON.stringify(message);
    for (const client of allClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  // ─── Emitter for execution-specific logs ────────────────────────────────
  const emitter: WsEmitter = {
    emitExecutionLog(executionId: string, logEntry: ExecutionLogEntry) {
      // 1. Persist to database (async, fire-and-forget)
      db.insert(executionLogs).values({
        testPlanExecutionId: executionId,
        timestamp: new Date(logEntry.timestamp),
        level: logEntry.level,
        source: logEntry.source,
        message: logEntry.message,
        metadata: logEntry.metadata || null,
        testCaseResultId: logEntry.testCaseResultId || null,
        correlationId: getCorrelationId() || null,
      }).catch(err => {
        // Don't let DB errors break log streaming
        logger.error('Failed to persist execution log', { executionId, error: (err as Error).message });
      });

      // 2. Send to subscribed WebSocket clients
      const clients = subscriptions.get(executionId);
      if (!clients || clients.size === 0) return;

      const payload = JSON.stringify({
        type: 'execution-log',
        executionId,
        ...logEntry,
      });

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }

      // 3. Also broadcast as legacy log for the old LiveConsole
      broadcastAll({
        type: 'job-progress',
        jobId: executionId,
        log: `[${logEntry.level.toUpperCase()}] [${logEntry.source}] ${logEntry.message}`,
      });
    }
  };

  // Set global reference
  globalWsEmitter = emitter;

  logger.info('WebSocket server initialized with room-based subscriptions');
  return emitter;
}
