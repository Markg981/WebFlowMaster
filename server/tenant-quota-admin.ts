import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import { auditLog, organizations } from '@shared/schema';
import type { OrganizationQuotaSummary, QuotaOverrides } from '@shared/tenant-quotas';
import { privilegedDb, withArtifactLock } from './db';
import { runDetachedForOrganization, withTenantTransaction } from './middleware/tenancy';
import { defaultQuotas, liveRunCounts, quotaUsage, quotasFor } from './tenant-quotas';
import { reconcileOrganizationArtifacts } from './artifact-metering';
import { artifactStore } from './artifact-store';
import type { AuditActor } from './audit';

type Organization = typeof organizations.$inferSelect;
export class QuotaAdminError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function overrides(row: Organization): QuotaOverrides {
  return { mode: row.quotaMode, maxConcurrentRuns: row.maxConcurrentRuns, maxQueuedRuns: row.maxQueuedRuns,
    maxTests: row.maxTests, maxArtifactBytes: row.maxArtifactBytes, maxMonthlyExecutionMinutes: row.maxMonthlyExecutionMinutes };
}
async function summary(row: Organization): Promise<OrganizationQuotaSummary> {
  return runDetachedForOrganization(row.id, () => withTenantTransaction(async tx => {
    const [quotas, usage, runs] = await Promise.all([quotasFor(tx, row.id), quotaUsage(tx, row.id), liveRunCounts(tx, row.id)]);
    return { organizationId: row.id, name: row.name, revision: row.quotaRevision, quotas, overrides: overrides(row), usage: { ...usage, ...runs } };
  }));
}

/** Installation overview, called only by the installation-admin routes. */
export async function listOrganizationQuotas(search: string, limit: number, offset: number) {
  const filter = search ? ilike(organizations.name, `%${search.replace(/[\\%_]/g, '\\$&')}%`) : undefined;
  const rows = await privilegedDb.select().from(organizations).where(filter).orderBy(asc(organizations.id)).limit(limit).offset(offset);
  const [total] = await privilegedDb.select({ count: sql<number>`count(*)::int` }).from(organizations).where(filter);
  const items: OrganizationQuotaSummary[] = [];
  for (const row of rows) items.push(await summary(row));
  return { items, total: total?.count ?? 0, limit, offset };
}

export async function updateOrganizationQuotas(organizationId: number, revision: number, patch: Partial<QuotaOverrides>, actor: AuditActor): Promise<OrganizationQuotaSummary> {
  const updated = await withArtifactLock(organizationId, () => privilegedDb.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7301,${organizationId}),pg_advisory_xact_lock(7302,${organizationId})`);
    const [row] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).for('update');
    if (!row) throw new QuotaAdminError(404, 'organization_not_found', 'Organization not found.');
    if (row.quotaRevision !== revision) throw new QuotaAdminError(409, 'quota_revision_conflict', 'Quotas changed. Refresh before saving.');
    const next = { ...overrides(row), ...patch };
    const defaults = defaultQuotas();
    if ((next.mode ?? defaults.mode) === 'enforce' && (next.maxArtifactBytes ?? defaults.maxArtifactBytes) > 0 && !row.artifactsReconciledAt)
      throw new QuotaAdminError(409, 'artifact_inventory_required', 'Reconcile artifact storage before enforcing a finite storage limit.');
    const [changed] = await tx.update(organizations).set({ quotaMode: next.mode, maxConcurrentRuns: next.maxConcurrentRuns,
      maxQueuedRuns: next.maxQueuedRuns, maxTests: next.maxTests, maxArtifactBytes: next.maxArtifactBytes,
      maxMonthlyExecutionMinutes: next.maxMonthlyExecutionMinutes, quotaRevision: row.quotaRevision + 1 })
      .where(and(eq(organizations.id, organizationId), eq(organizations.quotaRevision, revision))).returning();
    await tx.insert(auditLog).values({ organizationId, actorUserId: actor.id, actorUsername: actor.username,
      apiKeyId: actor.apiKeyId, ipAddress: actor.ipAddress, action: 'organization.quotas_updated', targetType: 'organization', targetId: String(organizationId),
      metadata: { revision: changed.quotaRevision, before: overrides(row), after: next } });
    return changed;
  }));
  return summary(updated);
}

export async function reconcileQuotaArtifacts(organizationId: number, actor: AuditActor): Promise<OrganizationQuotaSummary> {
  const [row] = await privilegedDb.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!row) throw new QuotaAdminError(404, 'organization_not_found', 'Organization not found.');
  await reconcileOrganizationArtifacts(organizationId, artifactStore());
  await privilegedDb.insert(auditLog).values({ organizationId, actorUserId: actor.id, actorUsername: actor.username,
    action: 'organization.artifacts_reconciled', targetType: 'organization', targetId: String(organizationId), metadata: { completed: true } });
  const [refreshed] = await privilegedDb.select().from(organizations).where(eq(organizations.id, organizationId));
  return summary(refreshed);
}
