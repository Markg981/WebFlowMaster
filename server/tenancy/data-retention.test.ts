import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import { runWithTenant, withTenantTransaction } from '../platform/middleware/tenancy';
import { recordAudit } from './audit';
import { AUDIT_ACTIONS } from '@shared/schema';
import { auditLogMaintenance, createTestOrganization, createTestUser } from '../tests/factories';
import { eraseOrganization } from './organization-lifecycle';
import {
  purgeExpiredRows,
  runRetentionSweep,
  auditLogRetentionDays,
  auditIpRetentionDays,
  evidenceRetentionDays,
} from './data-retention';
import { ADVISORY_KEYS, withAdvisoryLock } from '../platform/advisory-lock';

let org: number;
let user: number;

beforeEach(async () => {
  org = await createTestOrganization('Retained');
  user = await createTestUser(org, 'retained_user');
  await runWithTenant(org, () =>
    withTenantTransaction((tx) =>
      recordAudit(tx, { action: AUDIT_ACTIONS.MEMBER_REMOVED, actor: { id: user, username: 'x' } }),
    ),
  );
  await auditLogMaintenance(sql`UPDATE audit_log SET created_at = now() - interval '400 days'`);
  await runWithTenant(org, () =>
    withTenantTransaction((tx) =>
      recordAudit(tx, { action: AUDIT_ACTIONS.MEMBER_REMOVED, actor: { id: user, username: 'y' } }),
    ),
  );
});
afterEach(() => eraseOrganization(org));

const count = async () =>
  Number(
    (
      await privilegedDb.execute(
        sql`SELECT count(*)::int AS n FROM audit_log WHERE organization_id = ${org}`,
      )
    ).rows[0].n,
  );

describe('data retention', () => {
  it('is off unless a window is set', () => {
    expect(auditLogRetentionDays({} as any)).toBe(0);
    expect(evidenceRetentionDays({ EVIDENCE_RETENTION_DAYS: '' } as any)).toBe(0);
    expect(auditLogRetentionDays({ AUDIT_LOG_RETENTION_DAYS: '-3' } as any)).toBe(0);
    expect(auditLogRetentionDays({ AUDIT_LOG_RETENTION_DAYS: '30' } as any)).toBe(30);
  });

  it('keeps every audit entry when no window is set', async () => {
    const report = await purgeExpiredRows({ auditDays: 0, auditIpDays: 0, evidenceDays: 0 });
    expect(report).toEqual({ auditEntriesDeleted: 0, auditIpsCleared: 0, evidenceCleared: 0 });
    expect(await count()).toBe(2);
  });

  it('deletes only audit entries older than the window', async () => {
    const report = await purgeExpiredRows({ auditDays: 365 });
    expect(report.auditEntriesDeleted).toBeGreaterThanOrEqual(1);
    expect(await count()).toBe(1);
  });

  it('deletes in batches until nothing is left', async () => {
    await runWithTenant(org, () =>
      withTenantTransaction(async (tx) => {
        for (let i = 0; i < 4; i++) {
          await recordAudit(tx, {
            action: AUDIT_ACTIONS.MEMBER_REMOVED,
            actor: { id: user, username: 'z' },
          });
        }
      }),
    );
    await auditLogMaintenance(
      sql`UPDATE audit_log SET created_at = now() - interval '400 days' WHERE organization_id = ${org}`,
    );
    const report = await purgeExpiredRows({
      auditDays: 365,
      auditIpDays: 0,
      batchSize: 2,
      pauseMs: 0,
    });
    expect(report.auditEntriesDeleted).toBeGreaterThanOrEqual(6);
    expect(await count()).toBe(0);
  });

  it('stops when the time budget is spent', async () => {
    const report = await purgeExpiredRows({ auditDays: 365, auditIpDays: 0, budgetMs: -1 });
    expect(report.auditEntriesDeleted).toBe(0);
    expect(await count()).toBe(2);
  });

  it('nulls the IP of old entries only, keeping the entries', async () => {
    await auditLogMaintenance(
      sql`UPDATE audit_log SET ip_address = '203.0.113.7' WHERE organization_id = ${org}`,
    );
    const report = await purgeExpiredRows({ auditDays: 0, auditIpDays: 90, evidenceDays: 0 });
    expect(report.auditIpsCleared).toBeGreaterThanOrEqual(1);
    const rows = (
      await privilegedDb.execute(
        sql`SELECT ip_address, created_at < now() - interval '90 days' AS old FROM audit_log WHERE organization_id = ${org}`,
      )
    ).rows as { ip_address: string | null; old: boolean }[];
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.ip_address === null).toBe(r.old);
  });

  it('defaults the IP window to 90 days, 0 disables it', () => {
    expect(auditIpRetentionDays({} as any)).toBe(90);
    expect(auditIpRetentionDays({ AUDIT_LOG_IP_RETENTION_DAYS: '30' } as any)).toBe(30);
    expect(auditIpRetentionDays({ AUDIT_LOG_IP_RETENTION_DAYS: '0' } as any)).toBe(0);
  });

  it('skips the sweep while another process holds the lock', async () => {
    const held = await withAdvisoryLock(ADVISORY_KEYS.dataRetention, () =>
      runRetentionSweep({ auditDays: 365 }),
    );
    expect(held).toEqual({ ran: true, value: undefined });
    expect(await count()).toBe(2);
    const free = await runRetentionSweep({ auditDays: 365, auditIpDays: 0, evidenceDays: 0 });
    expect(free?.auditEntriesDeleted).toBeGreaterThanOrEqual(1);
  });
});
