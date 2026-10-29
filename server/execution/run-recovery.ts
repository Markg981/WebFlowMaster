import { ADVISORY_KEYS, withAdvisoryLock } from '../platform/advisory-lock';
import { and, eq, inArray, lt, notExists, or, sql } from 'drizzle-orm';
import { executionOutbox, testPlanExecutions, type TestPlanExecution } from '@shared/schema';
import { privilegedDb } from '../platform/db';
import { runWithTenant, withTenantTransaction } from '../platform/middleware/tenancy';
import { LIVE_EXECUTION_STATUSES, transitionExecution } from './execution-state';
import { markRunIndeterminate } from './execution-units';
import type { ExecutionSnapshot } from './execution-snapshot';
import { RUN_HEARTBEAT_INTERVAL_MS, RUN_MAX_DURATION_MS } from './run-watch';
import logger from '../platform/logger';

/**
 * Ends the runs nobody is running any more.
 *
 * A worker that died — a crash, an out-of-memory kill, a redeploy that did not wait — left its
 * run `running` for ever: the report spun, the pipeline's CLI waited until its own timeout, and
 * the run counted as in progress in every list. Nothing could tell a run that was slow from one
 * that was dead, because the heartbeat was written once and never again.
 *
 * Workers now beat every RUN_HEARTBEAT_INTERVAL_MS (server/execution/run-watch.ts). This sweep looks for
 * live runs whose heartbeat has gone quiet for RUN_STALE_AFTER_MS and ends them:
 * - running → error, `worker_lost`. Not requeued as it stands: tests may already have created
 *   records in the application under test, and a second run on top of half a first is not the
 *   same run. What it left half-done is marked so (markRunIndeterminate): its running units are
 *   `indeterminate`, its running attempts `abandoned`, its held work items `indeterminate`. Its
 *   next attempt is queued only when its plan's worker-loss policy says `replay` — an explicit
 *   choice that its tests may run twice against the application; a retry count or the plan's
 *   re-run-on-failure is not that choice (lot P11).
 * - cancelling → cancelled: somebody asked to stop it, and it has stopped.
 *
 * And, as the backstop to the worker's own limit, a run past RUN_MAX_DURATION_MS plus a grace
 * period ends as `timed_out` even while its heartbeat goes on: the worker is alive but its run is
 * stuck somewhere a step's timeout does not reach.
 *
 * Every ending goes through the state machine, so a worker that turns out to be alive after all
 * cannot write a verdict over it, and several web servers sweeping at once end each run once.
 */

export const RUN_STALE_AFTER_MS =
  Number(process.env.RUN_STALE_AFTER_MS) || Math.max(8 * RUN_HEARTBEAT_INTERVAL_MS, 120_000);
export const RUN_TIMEOUT_GRACE_MS = 5 * 60_000;
/** How long a run may be `queued` with no job in the queue and no pending outbox row before it is ended. */
export const QUEUED_RUN_LOST_AFTER_MS = Number(process.env.QUEUED_RUN_LOST_AFTER_MS) || 10 * 60_000;
/** The failure code of a run whose job vanished from the queue. */
export const QUEUE_JOB_LOST = 'queue_job_lost';

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
  const overdueBefore = new Date(
    now.getTime() -
      (options.maxDurationMs ?? RUN_MAX_DURATION_MS) -
      (options.graceMs ?? RUN_TIMEOUT_GRACE_MS),
  );
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
        or(
          sql`${lastSignOfLife} < ${staleBefore}`,
          lt(testPlanExecutions.startedAt, overdueBefore),
        ),
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
          await withTenantTransaction((tx) =>
            markRunIndeterminate(
              tx,
              run.id,
              'The worker running this was lost: its result is not known, and it was not run again.',
            ),
          );
          if (mayReplayAfterLoss(ended)) await options.retry?.(ended);
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

/** The part of the queue the reconciliation reads: the state BullMQ gives a job id, if it has one. */
export interface QueuedJobLookup {
  getJobState(jobId: string): Promise<string | null>;
}

/** States in which a job is still going to reach (or has reached) a worker. */
const JOB_PRESENT_STATES = new Set([
  'waiting',
  'delayed',
  'active',
  'prioritized',
  'waiting-children',
]);

/**
 * Ends the `queued` runs whose job is gone.
 *
 * The recovery above only looks at live (`running`/`cancelling`) runs, and the outbox only at
 * rows it still holds. A run whose row was confirmed and whose job then disappeared (a queue
 * store that lost its state, a job that failed before a worker took the run) stayed `queued`
 * for ever, holding its organization's quota. Run id = job id, so the lookup is one call per run.
 *
 * It does not publish the job again: the run may have been taken in a way this cannot see, and
 * a second run on top of half a first is not the same run. It ends as `error` / `queue_job_lost`
 * and the user starts it again on purpose.
 */
export async function reconcileQueuedRuns(
  queue: QueuedJobLookup,
  options: { now?: Date; lostAfterMs?: number } = {},
): Promise<string[]> {
  const now = options.now ?? new Date();
  const before = new Date(now.getTime() - (options.lostAfterMs ?? QUEUED_RUN_LOST_AFTER_MS));
  const candidates = await privilegedDb
    .select({ id: testPlanExecutions.id, organizationId: testPlanExecutions.organizationId })
    .from(testPlanExecutions)
    .where(
      and(
        eq(testPlanExecutions.status, 'queued'),
        lt(testPlanExecutions.queuedAt, before),
        notExists(
          privilegedDb
            .select({ one: sql`1` })
            .from(executionOutbox)
            .where(eq(executionOutbox.executionId, testPlanExecutions.id)),
        ),
      ),
    )
    .limit(200);

  const lost: string[] = [];
  for (const run of candidates) {
    const state = await queue.getJobState(run.id);
    if (state && JOB_PRESENT_STATES.has(state)) continue;
    const ended = await runWithTenant(run.organizationId, () => markQueuedRunLost(run.id, state));
    if (ended) lost.push(run.id);
  }
  return lost;
}

/** queued → error for a run whose job is gone or failed; false when it had already moved on. */
export async function markQueuedRunLost(runId: string, jobState: string | null = null) {
  const ended = await transitionExecution(runId, 'error', {
    failureCode: QUEUE_JOB_LOST,
    failureMessage:
      (jobState
        ? `The job for this run ended as "${jobState}" before any worker took the run. `
        : 'The job for this run is no longer in the queue and no worker ever took the run. ') +
      'It was not run again; start it again if it is still needed.',
  });
  return Boolean(ended);
}

/** Whether a run whose worker was lost may run again: only when its plan said so, at enqueue. */
export function mayReplayAfterLoss(
  ended: Pick<TestPlanExecution, 'configurationSnapshot'>,
): boolean {
  const snapshot = ended.configurationSnapshot as Partial<ExecutionSnapshot> | null;
  return snapshot?.workerLossPolicy === 'replay';
}

/** Sweeps every intervalMs until stopped. Started by the web server, which always runs. */
export function startRunRecovery(intervalMs = 60_000): () => void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const { executionOrchestrator } = await import('./execution-orchestrator');
      const locked = await withAdvisoryLock(ADVISORY_KEYS.runRecovery, () =>
        recoverAbandonedRuns({
          retry: (ended) => executionOrchestrator.retryFailedRun(ended, 0).catch(() => null),
        }),
      );
      if (!locked.ran) return;
      const report = locked.value;
      const { testExecutionQueue } = await import('../platform/queue');
      const lostJobs = await withAdvisoryLock(ADVISORY_KEYS.runRecovery, () =>
        reconcileQueuedRuns({
          getJobState: async (id) => {
            const job = await testExecutionQueue.getJob(id);
            return job ? await job.getState() : null;
          },
        }),
      );
      if (lostJobs.ran && lostJobs.value.length > 0) {
        logger.warn({ message: 'Ended queued runs whose job was gone', runs: lostJobs.value });
      }
      const total = report.lost.length + report.cancelled.length + report.timedOut.length;
      if (total > 0) {
        logger.warn({ message: 'Ended runs nobody was running any more', ...report });
      }
    } catch (error: any) {
      logger.error({ message: 'The run recovery sweep failed', error: error?.message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void sweep(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
