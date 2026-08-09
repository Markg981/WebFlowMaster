import { auditLog, type AuditAction } from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';
import { getTenantOrgId } from './middleware/tenancy';

export interface AuditEntry {
  action: AuditAction;
  /** Who did it. Null for something the system did on nobody's behalf. */
  actor?: { id: number; username: string } | null;
  targetType?: 'user' | 'invitation' | 'organization';
  /** Text because targets are variously serial ids and uuids. */
  targetId?: string | number;
  /**
   * Before/after values and anything else a reader needs to understand the entry.
   *
   * Never secrets, tokens or password hashes. This table is readable by every owner of the
   * organization and is deliberately impossible to redact afterwards, so anything put here is
   * there for good.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Appends one audit entry, inside the caller's transaction.
 *
 * Taking the transaction handle rather than opening its own is the whole design. An entry
 * written in a separate transaction would survive a change that then failed — a false record
 * of something that never happened — and a change that committed while its entry failed would
 * be an invisible one. Passing `tx` makes the entry and the change atomic with each other.
 *
 * That also means this must be called from inside `withTenantTransaction`: the organization
 * comes from the ambient tenant context, never from an argument, so an entry cannot be
 * attributed to an organization the caller is not currently acting as. RLS enforces the same
 * thing a second time through the policy's WITH CHECK.
 */
export async function recordAudit(tx: TenantTx, entry: AuditEntry): Promise<void> {
  const organizationId = getTenantOrgId();
  if (organizationId === undefined) {
    throw new Error(
      'recordAudit called with no tenant context. It must run inside withTenantTransaction, ' +
        'in the same transaction as the change it records.',
    );
  }

  await tx.insert(auditLog).values({
    organizationId,
    actorUserId: entry.actor?.id ?? null,
    actorUsername: entry.actor?.username ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId === undefined ? null : String(entry.targetId),
    metadata: entry.metadata ?? null,
  });
}
