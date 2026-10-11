/**
 * Messages on the live /ws socket: server/websocket.ts and the run console
 * (client/src/components/ExecutionLogConsole.tsx).
 *
 * What a browser sends is untrusted input, read through ClientSocketMessageSchema; anything
 * else is ignored. What the server sends is ServerSocketMessage.
 */
import { z } from 'zod';

export const EXECUTION_LOG_LEVELS = ['info', 'warn', 'error', 'step', 'debug'] as const;
export type ExecutionLogLevel = (typeof EXECUTION_LOG_LEVELS)[number];

/** One line of a run's log, as stored in execution_logs and pushed to the sockets watching it. */
export interface ExecutionLogEntry {
  level: ExecutionLogLevel;
  source: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  testCaseResultId?: string;
}

// The client sends the id it got from the API; older pages sent it as a number.
const executionId = z
  .union([z.string().min(1).max(200), z.number().int().nonnegative()])
  .transform(String);

export const ClientSocketMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe-execution'), executionId }),
  z.object({ type: z.literal('unsubscribe-execution'), executionId }),
]);
export type ClientSocketMessage = z.input<typeof ClientSocketMessageSchema>;

export type ServerSocketMessage =
  | { type: 'subscribed'; executionId: string }
  | { type: 'subscribe-error'; executionId: string; error: string }
  | ({ type: 'execution-log'; executionId: string } & ExecutionLogEntry)
  | {
      type: 'job-active' | 'job-completed' | 'job-failed' | 'job-progress';
      jobId: string | undefined;
      log: string;
    };
