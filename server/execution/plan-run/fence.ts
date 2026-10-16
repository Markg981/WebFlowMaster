/**
 * Who may still write a unit's result (lot P11, audit C08).
 *
 * A worker's write used to be accepted because it arrived. A worker that stalled — a long GC
 * pause, a network partition, a laptop lid — and woke after its run or its work item had been given
 * up on could still write a result and its evidence over what the run had decided. Every write that
 * a verdict or a report reads now goes through a fence, checked inside the transaction that writes:
 *
 * - every run: the run is still live (running or cancelling). Locked FOR SHARE, so the recovery
 *   sweep's ending of the run and the write are one before the other, never interleaved.
 * - a shared run's work item, besides: the claim is still the writer's (state claimed, same owner,
 *   same epoch) and its lease has not ended by the database's clock (server/runtime/run-shards.ts).
 *   Locked FOR UPDATE, so a reclaim or a finish of the item waits for the write, or the write sees it.
 *
 * What a fence cannot do is undo what already happened outside the database: a click or a request
 * the test already made to the application under test happened, whoever then writes the result.
 * A result refused here makes the unit `indeterminate`, never "passed twice" or "failed silently".
 */
import { eq } from 'drizzle-orm';
import { testPlanExecutions } from '@shared/schema';
import type { WorkClaimRef } from '@shared/execution-identity';
import type { TenantTx } from '../../platform/middleware/tenancy';
import { admitUnderClaim, OwnershipLostError } from '../../runtime/run-shards';
import { LIVE_EXECUTION_STATUSES } from '../execution-state';

export { OwnershipLostError };

export interface UnitFence {
  /** Inside the transaction that writes: throws OwnershipLostError when the write is not this worker's to make. */
  admit(tx: TenantTx): Promise<void>;
  /** Aborted when this worker can no longer confirm it owns the work; absent for a run on one worker. */
  readonly signal?: AbortSignal;
  /** The claim's epoch, recorded on each attempt made under it; null outside a shared run. */
  readonly epoch: number | null;
}

const LIVE = new Set<string>(LIVE_EXECUTION_STATUSES);

/** The run is still live: a run the recovery sweep ended takes no more results. */
async function admitWhileLive(tx: TenantTx, executionId: string): Promise<void> {
  const [row] = await tx
    .select({ status: testPlanExecutions.status })
    .from(testPlanExecutions)
    .where(eq(testPlanExecutions.id, executionId))
    .for('share');
  if (!row || !LIVE.has(row.status))
    throw new OwnershipLostError(
      `The run ${executionId} is ${row?.status ?? 'gone'}: it takes no more results.`,
    );
}

/** The fence of a run held by one worker. */
export function runFence(executionId: string): UnitFence {
  return { admit: (tx) => admitWhileLive(tx, executionId), epoch: null };
}

/** The fence of one claim on a shared run's work item. */
export function claimFence(claim: WorkClaimRef, signal?: AbortSignal): UnitFence {
  return {
    admit: async (tx) => {
      await admitWhileLive(tx, claim.executionId);
      await admitUnderClaim(tx, claim);
    },
    signal,
    epoch: claim.epoch,
  };
}
