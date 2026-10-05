import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getTenantOrgId, withTenantTransaction, type TenantTx } from './middleware/tenancy';
import { lockOrganizationRuns, quotaUsage, quotasFor, QuotaError } from './tenant-quotas';

export type UsageKind = 'plan' | 'shard' | 'browser' | 'api' | 'mobile';
const activeUsage = new AsyncLocalStorage<boolean>();

export async function checkExecutionBudget(tx: TenantTx, organizationId: number): Promise<void> {
  const limits = await quotasFor(tx, organizationId);
  if (limits.mode !== 'enforce' || limits.maxMonthlyExecutionMinutes === 0) return;
  const usage = await quotaUsage(tx, organizationId);
  if (usage.executionMs / 60_000 >= limits.maxMonthlyExecutionMinutes) {
    throw new QuotaError('execution_quota_exceeded', 'execution_minutes', usage.executionMs / 60_000, limits.maxMonthlyExecutionMinutes, usage.periodEnd);
  }
}

export async function beginExecutionUsage(tx: TenantTx, organizationId: number, kind: UsageKind, executionId: string, now = new Date()): Promise<void> {
  await lockOrganizationRuns(tx, organizationId);
  if (kind !== 'shard') await checkExecutionBudget(tx, organizationId);
  const limits = await quotasFor(tx, organizationId);
  if (limits.mode === 'off') return;
  const inserted = await tx.execute(sql`INSERT INTO quota_execution_sessions(organization_id,kind,execution_id,started_at,heartbeat_at)
    VALUES (${organizationId},${kind},${executionId},${now.toISOString()}::timestamp,${now.toISOString()}::timestamp)
    ON CONFLICT (organization_id,kind,execution_id) DO NOTHING RETURNING execution_id`);
  if (!inserted.rows.length) throw Object.assign(new Error('This execution has already started.'), { status: 409, code: 'execution_already_started' });
}

export async function finishExecutionUsage(tx: TenantTx, organizationId: number, kind: UsageKind, executionId: string, now = new Date()): Promise<void> {
  await tx.execute(sql`UPDATE quota_execution_sessions SET ended_at=GREATEST(started_at,LEAST(${now.toISOString()}::timestamp,heartbeat_at+interval '2 minutes'))
    WHERE organization_id=${organizationId} AND kind=${kind} AND execution_id=${executionId} AND ended_at IS NULL`);
}

export async function heartbeatUsage(tx: TenantTx, organizationId: number, kind: UsageKind, executionId: string, now = new Date()): Promise<void> {
  await tx.execute(sql`UPDATE quota_execution_sessions SET heartbeat_at=${now.toISOString()}::timestamp
    WHERE organization_id=${organizationId} AND kind=${kind} AND execution_id=${executionId} AND ended_at IS NULL`);
}

/** Direct execution paths; nested operations are charged to their enclosing task only. */
export async function withExecutionUsage<T>(kind: Exclude<UsageKind, 'plan'>, work: () => Promise<T>, executionId: string = randomUUID()): Promise<T> {
  if (activeUsage.getStore()) return work();
  const organizationId = getTenantOrgId();
  if (organizationId === undefined) throw new Error('Execution usage requires a tenant');
  await withTenantTransaction(tx => beginExecutionUsage(tx, organizationId, kind, executionId));
  let beating = false;
  const timer = setInterval(() => {
    if (beating) return;
    beating = true;
    void withTenantTransaction(tx => heartbeatUsage(tx, organizationId, kind, executionId))
      .catch(() => undefined).finally(() => { beating = false; });
  }, 15_000);
  timer.unref();
  try { return await activeUsage.run(true, work); }
  finally {
    clearInterval(timer);
    await withTenantTransaction(tx => finishExecutionUsage(tx, organizationId, kind, executionId));
  }
}
