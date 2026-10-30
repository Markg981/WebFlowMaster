import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import { runWithTenant, withTenantTransaction } from '../platform/middleware/tenancy';
import { recordAudit } from './audit';
import { AUDIT_ACTIONS } from '@shared/schema';
import { auditLogMaintenance, createTestOrganization, createTestUser } from '../tests/factories';
import { eraseOrganization } from './organization-lifecycle';
import { purgeExpiredRows, auditLogRetentionDays, evidenceRetentionDays } from './data-retention';

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
    const report = await purgeExpiredRows({ auditDays: 0, evidenceDays: 0 });
    expect(report).toEqual({ auditEntriesDeleted: 0, evidenceCleared: 0 });
    expect(await count()).toBe(2);
  });

  it('deletes only audit entries older than the window', async () => {
    const report = await purgeExpiredRows({ auditDays: 365 });
    expect(report.auditEntriesDeleted).toBeGreaterThanOrEqual(1);
    expect(await count()).toBe(1);
  });
});
