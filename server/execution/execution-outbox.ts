import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { executionOutbox, testPlanExecutions, type TestPlanExecution } from '@shared/schema';
import { privilegedDb } from '../platform/db';
import { getCorrelationId } from '../platform/middleware/correlation';
import {
  runWithTenant,
  withTenantTransaction,
  type TenantTx,
} from '../platform/middleware/tenancy';
import logger from '../platform/logger';
import { transitionExecution } from './execution-state';
import { readExecutionSnapshot } from './execution-snapshot';

/**
 * Handing a run's job to the queue, so that a process stopping halfway cannot lose it.
 *
 * A run used to be committed and then submitted: a crash, a kill or a redeploy between the two
 * left a `queued` row no worker would ever come for. It held a place in the organization's queue
 * quota, a pipeline waited on it until its own timeout, and asking again with the same key only
 * returned the same stranded row. The run recovery could not see it either: it looks for runs a
 * worker took and stopped answering for, and no worker had ever taken this one.
 *
 * Now the job is written down in the transaction that creates the run — a row of
 * execution_outbox — and published from there:
 *
 * 1. claim: the row is leased to whoever publishes it, so two publishers do not race;
 * 2. publish: queue.add with the run's id as the job id, so publishing twice still makes one job;
 * 3. confirm: the row is deleted.
 *
 * The request that created the run publishes it straight away, as before. If its process stops
 * anywhere in between, the row stays, its lease runs out, and the dispatcher the web server runs
 * every few seconds publishes it. Whatever happens, the worker's own guard
 * (server/execution/execution-state.ts) still lets exactly one worker take the run.
 */

/** The failure code a run is left with when its job never reached the queue. */
export const QUEUE_SUBMISSION_FAILED = 'queue_submission_failed';

/** How long a claimed row belongs to its claimer before anyone else may publish it. */
export const OUTBOX_LEASE_MS = Number(process.env.EXECUTION_OUTBOX_LEASE_MS) || 60_000;
/** How long the dispatcher leaves a new row to the request that wrote it. */
export const OUTBOX_GRACE_MS = 15_000;
/** Attempts the dispatcher makes before it gives the run up as `queue_submission_failed`. */
export const OUTBOX_MAX_ATTEMPTS = 10;
const OUTBOX_MAX_BACKOFF_MS = 5 * 60_000;
const OUTBOX_BATCH = 100;

export interface ExecutionQueuePort {
  add(
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string; delay?: number; priority?: number },
  ): Promise<unknown>;
}

export interface OutboxTimingOptions {
  now?: Date;
  leaseMs?: number;
  graceMs?: number;
}

/** What the worker is given. The row, not this, is what the worker trusts. */
export function executionJobPayload(execution: TestPlanExecution): Record<string, unknown> {
  return {
    executionId: execution.id,
    // The names the worker has always read, so a worker from before this keeps working
    // through a rolling deploy.
    testPlanRunId: execution.id,
    planId: execution.testPlanId,
    userId: execution.requestedByUserId,
    updateBaselines:
      readExecutionSnapshot(execution.configurationSnapshot)?.visualTesting.updateBaselines ===
      true,
    correlationId: getCorrelationId() ?? `job-${execution.id.slice(0, 8)}`,
  };
}

/**
 * Writes down that this run's job is to be published. Called in the transaction that creates
 * (or takes back) the run, so either both exist or neither does.
 */
export async function recordPendingSubmission(
  tx: TenantTx,
  execution: TestPlanExecution,
  { delayMs = 0, priority = 1, graceMs = OUTBOX_GRACE_MS, now = new Date() } = {},
): Promise<void> {
  const values = {
    executionId: execution.id,
    organizationId: execution.organizationId,
    payload: executionJobPayload(execution),
    priority,
    runAt: new Date(now.getTime() + Math.max(delayMs, 0)),
    availableAt: new Date(now.getTime() + graceMs),
    leaseUntil: null,
    attempts: 0,
    lastError: null,
  };
  await tx
    .insert(executionOutbox)
    .values(values)
    .onConflictDoUpdate({ target: executionOutbox.executionId, set: values });
}

export type PublishOutcome =
  | { state: 'published' }
  /** No row, or somebody else holds its lease: nothing for this caller to do. */
  | { state: 'not_pending' }
  /** The run is over or was never queued; its row was removed without publishing. */
  | { state: 'dropped' }
  | { state: 'failed'; error: unknown; attempts: number };

/**
 * Claims, publishes and confirms one run's pending job. Runs inside the run's organization.
 *
 * A failure releases the row with a backoff, so the dispatcher tries it again later; whether the
 * run is given up is the caller's choice.
 */
export async function publishPendingSubmission(
  queue: ExecutionQueuePort,
  executionId: string,
  options: OutboxTimingOptions = {},
): Promise<PublishOutcome> {
  const now = options.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + (options.leaseMs ?? OUTBOX_LEASE_MS));

  const claim = await withTenantTransaction(async (tx) => {
    const [claimed] = await tx
      .update(executionOutbox)
      .set({ leaseUntil, attempts: sql`${executionOutbox.attempts} + 1` })
      .where(
        and(
          eq(executionOutbox.executionId, executionId),
          or(isNull(executionOutbox.leaseUntil), lte(executionOutbox.leaseUntil, now)),
        ),
      )
      .returning();
    if (!claimed) return null;
    const [run] = await tx
      .select({ status: testPlanExecutions.status })
      .from(testPlanExecutions)
      .where(eq(testPlanExecutions.id, executionId))
      .limit(1);
    // A run cancelled while it waited still goes to a worker, which ends it; one that is already
    // over, or was taken back as failed, has nothing a job could do.
    if (!run || (run.status !== 'queued' && run.status !== 'cancelling')) {
      await tx.delete(executionOutbox).where(eq(executionOutbox.executionId, executionId));
      return 'dropped' as const;
    }
    return claimed;
  });
  if (!claim) return { state: 'not_pending' };
  if (claim === 'dropped') return { state: 'dropped' };

  const delay = Math.max(claim.runAt.getTime() - now.getTime(), 0);
  try {
    await queue.add(
      'execute-plan',
      claim.payload,
      // The run's fair place in the queue — see server/tenancy/tenant-quotas.ts.
      delay > 0
        ? { jobId: executionId, delay, priority: claim.priority }
        : { jobId: executionId, priority: claim.priority },
    );
  } catch (error) {
    const backoff = Math.min(1_000 * 2 ** claim.attempts, OUTBOX_MAX_BACKOFF_MS);
    await withTenantTransaction(async (tx) => {
      await tx
        .update(executionOutbox)
        .set({
          leaseUntil: null,
          availableAt: new Date(now.getTime() + backoff),
          lastError: String((error as Error | null)?.message ?? error).slice(0, 1000),
        })
        .where(ownedBy(executionId, leaseUntil));
    });
    return { state: 'failed', error, attempts: claim.attempts };
  }

  // Confirmed only while the lease is still ours: a claimer whose lease ran out and whose row was
  // published by somebody else in the meantime finds nothing to delete, and nothing is lost.
  await withTenantTransaction((tx) =>
    tx.delete(executionOutbox).where(ownedBy(executionId, leaseUntil)),
  );
  return { state: 'published' };
}

function ownedBy(executionId: string, leaseUntil: Date) {
  return and(
    eq(executionOutbox.executionId, executionId),
    eq(executionOutbox.leaseUntil, leaseUntil),
  );
}

/** Forgets a run's pending job: the caller has given the run up. */
export async function discardPendingSubmission(executionId: string): Promise<void> {
  await withTenantTransaction((tx) =>
    tx.delete(executionOutbox).where(eq(executionOutbox.executionId, executionId)),
  );
}

/** Ends a run whose job could not be handed to the queue, so nobody waits for it for ever. */
export async function abandonSubmission(executionId: string): Promise<TestPlanExecution | null> {
  await discardPendingSubmission(executionId);
  return transitionExecution(executionId, 'error', {
    failureCode: QUEUE_SUBMISSION_FAILED,
    // The queue's own words stay in the log; this is what a person reading the run sees.
    failureMessage:
      'The run could not be handed to a worker. Asking again with the same idempotency key will retry it.',
  });
}

export interface DispatchReport {
  published: string[];
  failed: string[];
  abandoned: string[];
}

/**
 * Publishes every pending job whose request did not: its process stopped, or the queue refused
 * it and the backoff is over. A run that has failed OUTBOX_MAX_ATTEMPTS times ends in `error`.
 */
export async function dispatchPendingSubmissions(
  queue: ExecutionQueuePort,
  options: OutboxTimingOptions & { maxAttempts?: number } = {},
): Promise<DispatchReport> {
  const now = options.now ?? new Date();
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;

  // Across every organization: the dispatcher is not a request and has no tenant of its own. It
  // only finds the candidates; each is claimed and published inside its own organization.
  const candidates = await privilegedDb
    .select({
      executionId: executionOutbox.executionId,
      organizationId: executionOutbox.organizationId,
    })
    .from(executionOutbox)
    .where(
      and(
        lte(executionOutbox.availableAt, now),
        or(isNull(executionOutbox.leaseUntil), lte(executionOutbox.leaseUntil, now)),
      ),
    )
    .orderBy(asc(executionOutbox.availableAt))
    .limit(OUTBOX_BATCH);

  const report: DispatchReport = { published: [], failed: [], abandoned: [] };
  for (const candidate of candidates) {
    await runWithTenant(candidate.organizationId, async () => {
      const outcome = await publishPendingSubmission(queue, candidate.executionId, {
        ...options,
        now,
      });
      if (outcome.state === 'published') report.published.push(candidate.executionId);
      if (outcome.state !== 'failed') return;
      if (outcome.attempts >= maxAttempts) {
        await abandonSubmission(candidate.executionId);
        report.abandoned.push(candidate.executionId);
      } else {
        report.failed.push(candidate.executionId);
      }
    });
  }
  return report;
}

/** Dispatches every intervalMs until stopped. Started by the web server, which always runs. */
export function startOutboxDispatcher(intervalMs = 5_000): () => void {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const { testExecutionQueue } = await import('../platform/queue');
      const report = await dispatchPendingSubmissions(testExecutionQueue);
      if (report.published.length + report.failed.length + report.abandoned.length > 0) {
        logger.warn({ message: 'Published run jobs their request did not', ...report });
      }
    } catch (error: any) {
      logger.error({ message: 'The run outbox dispatcher failed', error: error?.message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void sweep(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
