import { and, eq, inArray, lt } from 'drizzle-orm';
import { comparisonRuns, type ComparisonRun } from '@shared/schema';
import type { ComparisonStatus } from '@shared/comparison';
import type { TenantTx } from '../platform/middleware/tenancy';

/**
 * Which way a comparison may move, and the only code allowed to move it.
 *
 * As for runs (execution-state.ts), every move is one conditional UPDATE: "set it to X where it is
 * currently one of the states X may follow". Two processes that both see the second run end both
 * try `running → comparing`; the database lets one through, and only that one computes the
 * comparison. A terminal state has no way out.
 */

/** For each state, the states it may be reached from. `queued` is only ever the first state. */
const ALLOWED_FROM: Record<ComparisonStatus, readonly ComparisonStatus[]> = {
  queued: [],
  running: ['queued'],
  comparing: ['running'],
  completed: ['comparing'],
  error: ['queued', 'running', 'comparing'],
  // Not from `comparing`: the two runs have ended, and the comparison finishes in moments.
  cancelled: ['queued', 'running'],
};

const TERMINAL: readonly ComparisonStatus[] = ['completed', 'error', 'cancelled'];

/** Fields a move may carry. The status and the lifecycle timestamps are set here. */
export type ComparisonTransitionPatch = Partial<
  Pick<
    ComparisonRun,
    | 'baselineExecutionId'
    | 'candidateExecutionId'
    | 'verdict'
    | 'summary'
    | 'failureCode'
    | 'failureMessage'
  >
>;

export function canTransitionComparison(from: string, to: ComparisonStatus): boolean {
  return (ALLOWED_FROM[to] as readonly string[]).includes(from);
}

/**
 * Moves a comparison to `to`, if it is currently somewhere `to` may follow.
 *
 * Returns the updated row, or null when the move was not allowed: somebody else moved it first,
 * it has ended, or it is not in this organization. Runs in the caller's transaction, so a move
 * commits with what it records (the results of a completed comparison, an audit entry).
 */
export async function transitionComparison(
  tx: TenantTx,
  comparisonId: string,
  to: ComparisonStatus,
  patch: ComparisonTransitionPatch = {},
): Promise<ComparisonRun | null> {
  const sources = ALLOWED_FROM[to];
  if (sources.length === 0) return null;
  const now = new Date();
  const [row] = await tx
    .update(comparisonRuns)
    .set({
      ...patch,
      status: to,
      updatedAt: now,
      ...(TERMINAL.includes(to) ? { completedAt: now } : {}),
    })
    .where(and(eq(comparisonRuns.id, comparisonId), inArray(comparisonRuns.status, [...sources])))
    .returning();
  return row ?? null;
}

/**
 * Records what a running comparison learned without moving it: the candidate's run once it
 * exists, or why it does not yet (`candidate_deferred`). Only while it is `running`, so a late
 * write cannot touch a comparison that has ended.
 */
export async function updateRunningComparison(
  tx: TenantTx,
  comparisonId: string,
  patch: Pick<ComparisonTransitionPatch, 'candidateExecutionId' | 'failureCode' | 'failureMessage'>,
): Promise<ComparisonRun | null> {
  const [row] = await tx
    .update(comparisonRuns)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(comparisonRuns.id, comparisonId), eq(comparisonRuns.status, 'running')))
    .returning();
  return row ?? null;
}

/**
 * Takes over a comparison whose computation stopped: `comparing` and untouched since `staleBefore`
 * (the process that claimed it died). One caller wins, as for the claim itself.
 */
export async function reclaimStaleComparison(
  tx: TenantTx,
  comparisonId: string,
  staleBefore: Date,
): Promise<ComparisonRun | null> {
  const [row] = await tx
    .update(comparisonRuns)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(comparisonRuns.id, comparisonId),
        eq(comparisonRuns.status, 'comparing'),
        lt(comparisonRuns.updatedAt, staleBefore),
      ),
    )
    .returning();
  return row ?? null;
}
