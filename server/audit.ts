import type { Request } from 'express';
import { auditLog, type AuditAction } from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';
import { getTenantOrgId } from './middleware/tenancy';

/** Who did something, and how they came to be able to. */
export interface AuditActor {
  id: number;
  username: string;
  /** The key a request authenticated with, when it was not a session. */
  apiKeyId?: string | null;
  ipAddress?: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  /** Who did it. Null for something the system did on nobody's behalf. */
  actor?: AuditActor | null;
  targetType?:
    | 'user'
    | 'invitation'
    | 'organization'
    | 'api_key'
    | 'webhook'
    | 'test'
    | 'api_test'
    | 'test_plan'
    | 'schedule'
    | 'project'
    | 'run'
    | 'environment'
    | 'secret'
    | 'system_settings'
    | 'runner';
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
 * The actor of a request: its user, the key it came with if any, and its address.
 *
 * Every handler that records an entry passes this rather than `req.user`, so an entry made by a
 * pipeline says so. Without the key, "alice deleted the plan" cannot be told apart from "a job
 * holding one of alice's keys deleted it".
 */
export function auditActor(req: Request): AuditActor {
  const user = req.user as { id: number; username: string };
  return {
    id: user.id,
    username: user.username,
    apiKeyId: (req as Request & { apiKeyId?: string }).apiKeyId ?? null,
    ipAddress: req.ip ?? null,
  };
}

/**
 * The fields a change touched, by name.
 *
 * What an update entry records instead of the values: a test's steps and a plan's settings can
 * hold URLs with credentials, selectors naming customers, and more, and this table keeps
 * everything for ever. The name says what kind of change it was; the test's own version history
 * holds the values, under the test's own access rules.
 */
export function changedFields(body: Record<string, unknown>): string[] {
  return Object.keys(body).filter((key) => body[key] !== undefined).sort();
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
    apiKeyId: entry.actor?.apiKeyId ?? null,
    ipAddress: entry.actor?.ipAddress ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId === undefined ? null : String(entry.targetId),
    metadata: entry.metadata ?? null,
  });
}
