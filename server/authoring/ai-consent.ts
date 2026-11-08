import { and, eq, lt, sql } from 'drizzle-orm';
import { aiUsage, auditLog, organizations, AUDIT_ACTIONS } from '@shared/schema';
import { privilegedDb } from '../platform/db';
import { withTenantTransaction, type TenantTx } from '../platform/middleware/tenancy';
import type { AuditActor } from '../tenancy/audit';

export const AI_NOT_ENABLED =
  'AI features are not enabled for this organization. An owner can enable them in the organization settings.';

export const AI_QUOTA_REACHED =
  'This organization reached its daily limit of AI calls. It resets at midnight UTC.';

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

const DEFAULT_DAILY_LIMIT = 200;

/** AI_DAILY_CALL_LIMIT: provider calls per organization and UTC day (default 200). Invalid or non-positive: the default. */
export function aiDailyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.AI_DAILY_CALL_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

export type AiCallDecision = { ok: true } | { ok: false; reason: 'consent' | 'quota' };

/** Why a call was not made, in the words a run log or a response carries. */
export function aiSkipMessage(reason: 'consent' | 'quota'): string {
  return reason === 'consent'
    ? 'skipped: AI is not enabled for this organization'
    : 'skipped: the organization reached its daily AI call limit';
}

/**
 * The one gate before any call to the external AI provider: the organization's consent, then its
 * daily cap. A call that passes is counted. Every module that imports the Gemini client must go
 * through this (server/tests/architecture.test.ts checks it), so a new caller cannot miss either.
 */
export async function reserveAiCall(
  organizationId: number,
  now: Date = new Date(),
): Promise<AiCallDecision> {
  const day = now.toISOString().slice(0, 10);
  const limit = aiDailyLimit();
  return withTenantTransaction(async (tx) => {
    if (!(await aiEnabled(tx, organizationId))) return { ok: false, reason: 'consent' } as const;
    // One statement: the row is created at 1, or counted only while under the cap.
    const counted = await tx
      .insert(aiUsage)
      .values({ organizationId, day, count: 1 })
      .onConflictDoUpdate({
        target: [aiUsage.organizationId, aiUsage.day],
        set: { count: sql`${aiUsage.count} + 1` },
        setWhere: and(eq(aiUsage.organizationId, organizationId), lt(aiUsage.count, limit)),
      })
      .returning();
    return counted.length > 0 ? ({ ok: true } as const) : ({ ok: false, reason: 'quota' } as const);
  });
}
