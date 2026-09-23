import { and, inArray, lt, or, sql } from 'drizzle-orm';
import { testPlanExecutions, type TestPlanExecution } from '@shared/schema';
import { privilegedDb } from './db';
import { runWithTenant } from './middleware/tenancy';
import { LIVE_EXECUTION_STATUSES, transitionExecution } from './execution-state';
import { RUN_HEARTBEAT_INTERVAL_MS, RUN_MAX_DURATION_MS } from './run-watch';
import loggerPromise from './logger';

/**
 * Ends the runs nobody is running any more.
 *
 * A worker that died — a crash, an out-of-memory kill, a redeploy that did not wait — left its
 * run `running` for ever: the report spun, the pipeline's CLI waited until its own timeout, and
 * the run counted as in progress in every list. Nothing could tell a run that was slow from one
 * that was dead, because the heartbeat was written once and never again.
 *
 * Workers now beat every RUN_HEARTBEAT_INTERVAL_MS (server/run-watch.ts). This sweep looks for
 * live runs whose heartbeat has gone quiet for RUN_STALE_AFTER_MS and ends them:
 * - running → error, `worker_lost`. Not requeued as it stands: tests may already have created
 *   records in the application under test, and a second run on top of half a first is not the
 *   same run. A scheduled run with retries left gets its next attempt, as any failed attempt does.
 * - cancelling → cancelled: somebody asked to stop it, and it has stopped.
 *
 * And, as the backstop to the worker's own limit, a run past RUN_MAX_DURATION_MS plus a grace
 * period ends as `timed_out` even while its heartbeat goes on: the worker is alive but its run is
 * stuck somewhere a step's timeout does not reach.
 *
 * Every ending goes through the state machine, so a worker that turns out to be alive after all
 * cannot write a verdict over it, and several web servers sweeping at once end each run once.
 */

export const RUN_STALE_AFTER_MS = Number(process.env.RUN_STALE_AFTER_MS) || Math.max(8 * RUN_HEARTBEAT_INTERVAL_MS, 120_000);
export const RUN_TIMEOUT_GRACE_MS = 5 * 60_000;

export interface RecoveryOptions {
  now?: Date;
  staleAfterMs?: number;
  maxDurationMs?: number;
  graceMs?: number;
  /** The next attempt of a run ended here, when it has one — see retryFailedRun. */
  retry?: (ended: TestPlanExecution) => Promise<unknown>;
}

export interface RecoveryReport {
  lost: string[];
  cancelled: string[];
  timedOut: string[];
}

export async function recoverAbandonedRuns(options: RecoveryOptions = {}): Promise<RecoveryReport> {
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - (options.staleAfterMs ?? RUN_STALE_AFTER_MS));
  const overdueBefore = new Date(now.getTime() - (options.maxDurationMs ?? RUN_MAX_DURATION_MS) - (options.graceMs ?? RUN_TIMEOUT_GRACE_MS));
  const lastSignOfLife = sql`coalesce(${testPlanExecutions.heartbeatAt}, ${testPlanExecutions.startedAt}, ${testPlanExecutions.queuedAt})`;

  // Across every organization: a sweep is not a request and has no tenant of its own. It only
  // finds the candidates; each is ended inside its own organization's context.
  const candidates = await privilegedDb
    .select({
      id: testPlanExecutions.id,
      organizationId: testPlanExecutions.organizationId,
      status: testPlanExecutions.status,
      startedAt: testPlanExecutions.startedAt,
      heartbeatAt: testPlanExecutions.heartbeatAt,
    })
    .from(testPlanExecutions)
    .where(
      and(
        inArray(testPlanExecutions.status, [...LIVE_EXECUTION_STATUSES]),
        or(sql`${lastSignOfLife} < ${staleBefore}`, lt(testPlanExecutions.startedAt, overdueBefore)),
      ),
    );

  const report: RecoveryReport = { lost: [], cancelled: [], timedOut: [] };
  for (const run of candidates) {
    await runWithTenant(run.organizationId, async () => {
      const lastBeat = run.heartbeatAt ?? run.startedAt;
      const quiet = !lastBeat || lastBeat < staleBefore;

      if (run.status === 'cancelling') {
        if (await transitionExecution(run.id, 'cancelled')) report.cancelled.push(run.id);
        return;
      }
      if (quiet) {
        const ended = await transitionExecution(run.id, 'error', {
          failureCode: 'worker_lost',
          failureMessage:
            `The worker running this stopped answering${lastBeat ? ` (last heard from at ${lastBeat.toISOString()})` : ''}. ` +
            'Its results up to then are kept; the run did not finish.',
        });
        if (ended) {
          report.lost.push(run.id);
          await options.retry?.(ended);
        }
        return;
      }
      const ended = await transitionExecution(run.id, 'timed_out', {
        failureCode: 'run_timed_out',
        failureMessage: 'The run went past its time limit and did not stop on its own.',
      });
      if (ended) report.timedOut.push(run.id);
    });
  }
  return report;
}

/** Sweeps every intervalMs until stopped. Started by the web server, which always runs. */
export function startRunRecovery(intervalMs = 60_000): () => void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const { executionOrchestrator } = await import('./execution-orchestrator');
      const report = await recoverAbandonedRuns({
        retry: (ended) => executionOrchestrator.retryFailedRun(ended, 0).catch(() => null),
      });
      const total = report.lost.length + report.cancelled.length + report.timedOut.length;
      if (total > 0) {
        const logger = await loggerPromise;
        logger.warn({ message: 'Ended runs nobody was running any more', ...report });
      }
    } catch (error: any) {
      const logger = await loggerPromise;
      logger.error({ message: 'The run recovery sweep failed', error: error?.message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void sweep(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
