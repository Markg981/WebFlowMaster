import { and, asc, eq } from 'drizzle-orm';
import { testPlanExecutions } from '@shared/schema';
import { isTerminalExecutionStatus, onExecutionTransition } from './execution-state';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { liveRunCounts, quotasFor } from './tenant-quotas';
import { testExecutionQueue } from './queue';
import { checkExecutionBudget } from './execution-usage';
import { QuotaError } from './tenant-quotas';

/**
 * Waiting runs start when a slot frees, not at the next look.
 *
 * A run held back by its organization's limit goes back to the queue as a delayed job and is looked
 * at again after RUN_DEFERRAL_MS (server/worker.ts). With short runs that was most of the wait: the
 * load test (scripts/wfm-load.ts) measured eight 2-second runs per organization, two at a time,
 * ending after 33 s with the default 10 s instead of about 9 s.
 *
 * So when a run of an organization ends, the delayed jobs of its oldest waiting runs are made ready
 * at once, as many as it now has slots free. They still go through takeExecution, under the
 * organization's lock: promoting one too many costs a deferral, never a run over the limit. Only
 * jobs delayed for the limit are promoted (marked deferredForQuota by the worker); a retry waiting
 * out its backoff keeps waiting. The delay stays as the fallback, for a promotion missed because a
 * process restarted or Redis was briefly away.
 */

/** The part of a BullMQ queue this needs. */
export interface PromotableQueue {
  getJob(id: string): Promise<{ data?: Record<string, unknown>; getState(): Promise<string>; promote(): Promise<void> } | undefined | null>;
}

/** Makes the deferred jobs of the organization's oldest waiting runs ready, up to its free slots. Returns how many. */
export async function promoteWaitingRuns(organizationId: number, queue: PromotableQueue): Promise<number> {
  const waiting = await runWithTenant(organizationId, () =>
    withTenantTransaction(async (tx) => {
      const [quotas, counts] = [await quotasFor(tx, organizationId), await liveRunCounts(tx, organizationId)];
      try { await checkExecutionBudget(tx, organizationId); }
      catch (error) { if (error instanceof QuotaError) return []; throw error; }
      const free = quotas.mode === 'enforce' ? quotas.maxConcurrentRuns - counts.running : counts.queued;
      if (free <= 0 || counts.queued === 0) return [];
      return tx
        .select({ id: testPlanExecutions.id })
        .from(testPlanExecutions)
        .where(and(eq(testPlanExecutions.organizationId, organizationId), eq(testPlanExecutions.status, 'queued')))
        .orderBy(asc(testPlanExecutions.queuedAt), asc(testPlanExecutions.id))
        .limit(free);
    }),
  );
  let promoted = 0;
  for (const { id } of waiting) {
    const job = await queue.getJob(id);
    if (!job || job.data?.deferredForQuota !== true) continue;
    // Between the look and the promotion the job may have been taken or promoted already.
    if ((await job.getState()) !== 'delayed') continue;
    await job.promote().then(() => promoted++, () => undefined);
  }
  return promoted;
}

let registered: (() => void) | null = null;

/** Turns it on for this process: runs end in the worker, and in the web server's recovery and cancellations. */
export function registerRunPromotion(queue: PromotableQueue = testExecutionQueue): () => void {
  registered?.();
  const off = onExecutionTransition(async (execution) => {
    if (!isTerminalExecutionStatus(execution.status)) return;
    await promoteWaitingRuns(execution.organizationId, queue).catch(() => undefined);
  });
  registered = () => {
    off();
    registered = null;
  };
  return registered;
}
