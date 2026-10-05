import { and, eq, inArray, sql } from 'drizzle-orm';
import { organizations, testPlanExecutions } from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';
import { quotaDefaults, type TenantQuotas, type QuotaUsage } from '@shared/tenant-quotas';
import { privilegedDb } from './db';
export type { TenantQuotas } from '@shared/tenant-quotas';

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

export function defaultQuotas(env: NodeJS.ProcessEnv = process.env): TenantQuotas {
  return quotaDefaults(env);
}

/** The database trigger and the application resolve the same trusted installation defaults. */
export async function initializeQuotaDefaults(): Promise<void> {
  const defaults = defaultQuotas();
  await privilegedDb.execute(sql`UPDATE quota_installation_defaults SET mode=${defaults.mode}, max_tests=${defaults.maxTests},max_artifact_bytes=${defaults.maxArtifactBytes} WHERE id=1`);
}

/** The organization's limits: its own where it has them, the installation's otherwise. */
export async function quotasFor(tx: TenantTx, organizationId: number): Promise<TenantQuotas> {
  const defaults = defaultQuotas();
  const [row] = await tx
    .select({ maxConcurrentRuns: organizations.maxConcurrentRuns, maxQueuedRuns: organizations.maxQueuedRuns,
      mode: organizations.quotaMode, maxTests: organizations.maxTests, maxArtifactBytes: organizations.maxArtifactBytes,
      maxMonthlyExecutionMinutes: organizations.maxMonthlyExecutionMinutes })
    .from(organizations)
    // organizations has no row policy; the predicate is what keeps this to one's own.
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return {
    maxConcurrentRuns: row?.maxConcurrentRuns ?? defaults.maxConcurrentRuns,
    maxQueuedRuns: row?.maxQueuedRuns ?? defaults.maxQueuedRuns,
    mode: row?.mode ?? defaults.mode,
    maxTests: row?.maxTests ?? defaults.maxTests,
    maxArtifactBytes: row?.maxArtifactBytes ?? defaults.maxArtifactBytes,
    maxMonthlyExecutionMinutes: row?.maxMonthlyExecutionMinutes ?? defaults.maxMonthlyExecutionMinutes,
  };
}

export async function quotaUsage(tx: TenantTx, organizationId: number, now = new Date()): Promise<QuotaUsage> {
  const result = await tx.execute(sql`SELECT * FROM app_quota_usage(${now.toISOString()}::timestamp)`);
  const row = result.rows[0] as Record<string, unknown>;
  const number = (key: string) => {
    const value = Number(row[key]);
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error('Quota usage exceeds supported numeric range');
    return value;
  };
  const [organization] = await tx.select({ reconciledAt: organizations.artifactsReconciledAt }).from(organizations).where(eq(organizations.id, organizationId));
  return { tests: number('tests'), artifactBytes: number('artifact_bytes'), reservedArtifactBytes: number('reserved_artifact_bytes'),
    executionMs: Math.floor(number('execution_ms')),
    periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    artifactsReconciledAt: organization?.reconciledAt?.toISOString() ?? null };
}

export class QuotaError extends Error {
  readonly status = 429;
  constructor(readonly code: string, readonly dimension: string, readonly usage: number, readonly limit: number, readonly periodEnd?: string) {
    super(`${code}: The organization's ${dimension} quota has been reached.`);
  }
}

/** Database triggers and application admission checks share a public, non-sensitive error shape. */
export function quotaErrorBody(error: unknown): Record<string, unknown> | null {
  if (error instanceof QuotaError) return { error: error.message, code: error.code, dimension: error.dimension, usage: error.usage, limit: error.limit, periodEnd: error.periodEnd };
  // BullMQ forwards a worker's message, without its Error subclass or additional fields.
  if (error instanceof Error && error.message.startsWith('execution_quota_exceeded:')) return { error: error.message, code: 'execution_quota_exceeded', dimension: 'execution_minutes' };
  if (error && typeof error === 'object' && (error as { message?: string }).message === 'test_quota_exceeded') {
    const detail = (error as { detail?: string }).detail;
    let values: Record<string, unknown> = {};
    try { values = JSON.parse(detail ?? '{}'); } catch { /* The error remains an admission refusal. */ }
    return { error: 'The organization test quota has been reached.', code: 'test_quota_exceeded', ...values };
  }
  return null;
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
