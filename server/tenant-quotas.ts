import { and, eq, inArray, sql } from 'drizzle-orm';
import { organizations, testPlanExecutions } from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';

/**
 * How much of the execution plane one organization may hold, and its place in the queue.
 *
 * Runs were served first come, first served. One organization's pipeline that queued fifty runs
 * held every worker until the fiftieth was done, and every other organization — including one
 * that wanted a single run — waited behind all of it. Three rules replace that:
 *
 * - A limit on runs executing at once (max_concurrent_runs). A worker that picks up a run past
 *   it puts the run back for a moment and moves on; the run waits, it does not fail.
 * - A limit on runs waiting (max_queued_runs). Asking for one more is refused with 429, so one
 *   flood cannot fill the queue for everybody.
 * - A fair place in the queue: a run's priority is one more than the runs its organization
 *   already has in flight. An organization's first run goes ahead of another's fiftieth.
 *
 * Defaults come from the environment; an organization's row can change them. There is no grant
 * for the application to write those columns: an organization cannot raise its own limits.
 */

export interface TenantQuotas {
  maxConcurrentRuns: number;
  maxQueuedRuns: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function defaultQuotas(env: NodeJS.ProcessEnv = process.env): TenantQuotas {
  return {
    maxConcurrentRuns: positiveInt(env.ORG_MAX_CONCURRENT_RUNS, 2),
    maxQueuedRuns: positiveInt(env.ORG_MAX_QUEUED_RUNS, 100),
  };
}

/** The organization's limits: its own where it has them, the installation's otherwise. */
export async function quotasFor(tx: TenantTx, organizationId: number): Promise<TenantQuotas> {
  const defaults = defaultQuotas();
  const [row] = await tx
    .select({ maxConcurrentRuns: organizations.maxConcurrentRuns, maxQueuedRuns: organizations.maxQueuedRuns })
    .from(organizations)
    // organizations has no row policy; the predicate is what keeps this to one's own.
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return {
    maxConcurrentRuns: row?.maxConcurrentRuns ?? defaults.maxConcurrentRuns,
    maxQueuedRuns: row?.maxQueuedRuns ?? defaults.maxQueuedRuns,
  };
}

export interface LiveRunCounts {
  /** Executing, or finishing a cancellation — either way holding a worker. */
  running: number;
  queued: number;
}

export async function liveRunCounts(tx: TenantTx, organizationId: number): Promise<LiveRunCounts> {
  const rows = await tx
    .select({ status: testPlanExecutions.status, count: sql<number>`count(*)::int` })
    .from(testPlanExecutions)
    .where(and(
      eq(testPlanExecutions.organizationId, organizationId),
      inArray(testPlanExecutions.status, ['queued', 'running', 'cancelling']),
    ))
    .groupBy(testPlanExecutions.status);
  const of = (status: string) => rows.find((row) => row.status === status)?.count ?? 0;
  return { running: of('running') + of('cancelling'), queued: of('queued') };
}

/** BullMQ's highest usable priority number; lower numbers are served first. */
const LOWEST_PRIORITY = 2_097_152;

/** A run's place in the queue: behind every run its organization already has in flight. */
export function fairPriority(counts: LiveRunCounts): number {
  return Math.min(1 + counts.running + counts.queued, LOWEST_PRIORITY);
}

/**
 * One lock per organization, held for the length of a transaction, for the decisions that
 * count its runs and then act on the count: without it two workers both see one slot free and
 * both take it.
 */
export async function lockOrganizationRuns(tx: TenantTx, organizationId: number): Promise<void> {
  await (tx as any).execute(sql`select pg_advisory_xact_lock(7301, ${organizationId})`);
}
