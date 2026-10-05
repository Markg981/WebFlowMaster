import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { privilegedDb } from './db';
import { createTestOrganization, createTestUser } from './tests/factories';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { takeExecution, transitionExecution } from './execution-state';
import { quotaUsage } from './tenant-quotas';

let org: number;
let run: string;
const asOrg = <T>(work: () => Promise<T>) => runWithTenant(org, work);
beforeEach(async () => {
  org = await createTestOrganization('Execution budget');
  const user = await createTestUser(org);
  const plan = randomUUID(); run = randomUUID();
  await privilegedDb.execute(sql`INSERT INTO test_plans (id,name,user_id,organization_id) VALUES (${plan},'Budget',${user},${org})`);
  await privilegedDb.execute(sql`INSERT INTO test_plan_executions (id,test_plan_id,organization_id,status,triggered_by) VALUES (${run},${plan},${org},'queued','manual')`);
});
afterEach(() => vi.useRealTimers());

describe('execution occupancy', () => {
  it('begins at actual take, finishes once, and survives source history removal', async () => {
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    await asOrg(() => takeExecution(run));
    vi.setSystemTime(new Date('2026-10-05T12:00:30Z'));
    expect((await asOrg(() => withTenantTransaction(tx => quotaUsage(tx, org)))).executionMs).toBe(30_000);
    await asOrg(() => transitionExecution(run, 'completed'));
    vi.setSystemTime(new Date('2026-10-05T12:00:50Z'));
    await asOrg(() => transitionExecution(run, 'completed'));
    await privilegedDb.execute(sql`DELETE FROM test_plan_executions WHERE id=${run}`);
    expect((await asOrg(() => withTenantTransaction(tx => quotaUsage(tx, org)))).executionMs).toBe(30_000);
  });
  it('splits month boundaries and does not charge queued executions', async () => {
    vi.setSystemTime(new Date('2026-09-30T23:59:30Z'));
    expect((await asOrg(() => withTenantTransaction(tx => quotaUsage(tx, org)))).executionMs).toBe(0);
    await asOrg(() => takeExecution(run));
    vi.setSystemTime(new Date('2026-10-01T00:00:30Z'));
    await asOrg(() => transitionExecution(run, 'failed'));
    expect((await asOrg(() => withTenantTransaction(tx => quotaUsage(tx, org)))).executionMs).toBe(30_000);
    expect((await asOrg(() => withTenantTransaction(tx => quotaUsage(tx, org, new Date('2026-09-30T23:59:59Z'))))).executionMs).toBe(30_000);
  });
  it('defers exhausted queued work and permits it after the UTC month changes', async () => {
    await privilegedDb.execute(sql`UPDATE organizations SET max_monthly_execution_minutes=1 WHERE id=${org}`);
    await privilegedDb.execute(sql`INSERT INTO quota_execution_sessions VALUES (${org},'api','previous','2026-10-01','2026-10-01 00:01:00','2026-10-01 00:01:00')`);
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    expect(await asOrg(() => takeExecution(run))).toMatchObject({ outcome: 'over_quota', reason: 'execution_quota_exceeded' });
    const deferred = await privilegedDb.execute(sql`SELECT quota_defer_reason,quota_defer_until FROM test_plan_executions WHERE id=${run}`);
    expect(deferred.rows[0]).toMatchObject({ quota_defer_reason: 'execution_quota_exceeded' });
    const boundary = await privilegedDb.execute(sql`SELECT quota_defer_until::text AS boundary FROM test_plan_executions WHERE id=${run}`);
    expect(boundary.rows[0].boundary).toBe('2026-11-01 00:00:00');
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    expect(await asOrg(() => takeExecution(run))).toMatchObject({ outcome: 'taken' });
    const resumed = await privilegedDb.execute(sql`SELECT quota_defer_reason FROM test_plan_executions WHERE id=${run}`);
    expect(resumed.rows[0].quota_defer_reason).toBeNull();
  });
});
