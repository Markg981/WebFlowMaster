/**
 * What every phase of a plan run shares (server/plan-run/pipeline.ts).
 *
 * A run used to be one function of nearly two thousand lines whose closures reached for whatever
 * an earlier part had computed. The phases now take what they read as arguments and return what
 * they produce, so each can be read, and tested, on its own; this file is the part they all hold.
 */
import type loggerPromise from '../logger';
import type { WsEmitter, ExecutionLogEntry } from '../websocket';
import type { RunWatch } from '../run-watch';
import type { TestPlanExecution } from '@shared/schema';
import { recordStopReason } from '../run-shards';

export type Logger = Awaited<typeof loggerPromise>;

/** A plan run as the queue asked for it. */
export interface PlanJob {
  planId: string;
  executionId: string;
  userId: number | null;
  options: { updateBaselines?: boolean };
  /** Set for a helper sharing a run another worker took (server/run-shards.ts). */
  helper?: { shard: number };
}

/** What a run job returns to the queue: the finished execution, or why there is none. */
export type PlanJobResult = TestPlanExecution | Record<string, unknown>;

/** Where a run says what it is doing: the worker's log, and the run's live console. */
export interface RunLog {
  executionId: string;
  logger: Logger;
  emitter: WsEmitter;
  /** A helper repeats the coordinator's setup; its informational lines would only say everything twice. */
  quiet: boolean;
}

/** One line of a run's console. Always from the system; stamped now unless it says otherwise. */
export type LogLine = Omit<ExecutionLogEntry, 'source' | 'timestamp'> & { timestamp?: string };

function entryOf(line: LogLine): ExecutionLogEntry {
  return { ...line, source: 'system', timestamp: line.timestamp ?? new Date().toISOString() };
}

/** Said on the run's console only. */
export function emit(log: RunLog, line: LogLine): void {
  const entry = entryOf(line);
  if (log.quiet && entry.level === 'info') return;
  log.emitter.emitExecutionLog(log.executionId, entry);
}

/** Said in the worker's log and on the run's console. */
export function report(log: RunLog, line: LogLine & { level: 'info' | 'warn' | 'error' }): void {
  const entry = entryOf(line);
  log.logger[entry.level as 'info' | 'warn' | 'error'](entry);
  if (log.quiet && entry.level === 'info') return;
  log.emitter.emitExecutionLog(log.executionId, entry);
}

/**
 * Set when a plan policy stops the run. Every test that has not started by then is recorded as
 * skipped with this as its reason, rather than silently absent: a report with three results
 * out of forty has to say why the other thirty-seven are not there. Tests already running when
 * it is set — other browsers, parallel slots — finish, because stopping a browser mid-step
 * leaves the application in a state nobody asked for.
 */
export class RunStop {
  reason: string | null = null;
  /** Set once it is known whether workers share this run. */
  shared = false;

  constructor(private readonly log: RunLog) {}

  async stop(reason: string): Promise<void> {
    if (this.reason) return;
    this.reason = reason;
    emit(this.log, {
      level: 'error',
      message: `Stopping the run: ${reason.replace(/^Not run: /, '')}`,
    });
    // The other workers sharing it read it before each item they take.
    if (this.shared) await recordStopReason(this.log.executionId, reason).catch(() => undefined);
  }
}

/** A run this worker holds: the job, where it reports, and how it is stopped. */
export interface PlanRun extends PlanJob, RunLog {
  /** When the run started, which is when its time limit counts from. */
  startedAt: number;
  watch: RunWatch;
  /** Where its tests write their evidence. */
  resultsDir: string;
  stop: RunStop;
}

/** A phase that ends the run early hands back what the job returns. */
export interface Ended {
  ended: PlanJobResult;
}

export const ended = (result: PlanJobResult): Ended => ({ ended: result });

export const isEnded = (value: unknown): value is Ended =>
  typeof value === 'object' && value !== null && 'ended' in value;
