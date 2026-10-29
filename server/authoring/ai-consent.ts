import { eq } from 'drizzle-orm';
import { auditLog, organizations, AUDIT_ACTIONS } from '@shared/schema';
import { privilegedDb } from '../platform/db';
import type { TenantTx } from '../platform/middleware/tenancy';
import type { AuditActor } from '../tenancy/audit';

export const AI_NOT_ENABLED =
  'AI features are not enabled for this organization. An owner can enable them in the organization settings.';

/**
 * Whether this organization allows its data to go to the external AI provider. The installation
 * holds one key; the consent is the organization's, and it is off until an owner turns it on.
 */
export async function aiEnabled(tx: TenantTx, organizationId: number): Promise<boolean> {
  const [row] = await tx
    .select({ enabled: organizations.aiEnabled })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.enabled ?? false;
}

/** Privileged because app_user may only read organizations; the id is the owner's own. */
export async function setAiEnabled(
  organizationId: number,
  actor: AuditActor,
  enabled: boolean,
): Promise<void> {
  await privilegedDb.transaction(async (tx) => {
    await tx
      .update(organizations)
      .set({ aiEnabled: enabled })
      .where(eq(organizations.id, organizationId));
    await tx.insert(auditLog).values({
      organizationId,
      actorUserId: actor.id,
      actorUsername: actor.username,
      apiKeyId: actor.apiKeyId ?? null,
      ipAddress: actor.ipAddress ?? null,
      action: AUDIT_ACTIONS.AI_POLICY_CHANGED,
      targetType: 'organization',
      targetId: String(organizationId),
      metadata: { enabled },
    });
  });
}
