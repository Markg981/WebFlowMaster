import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { passwordResets } from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';

/**
 * One-time links to choose a new password.
 *
 * Nobody could change a password: not their own, and not an owner for a member who forgot theirs.
 * The application sends no e-mail, so "forgot my password" cannot be a form that mails a link;
 * someone who can already vouch for the person has to hand it over. That is an owner, from
 * Settings > Members, or — for the last owner of an organization — the operator, from the command
 * line (scripts/password-reset-link.ts).
 *
 * A link carries 32 random bytes, stored only as their SHA-256 like an API key, lasts a day and
 * works once. Issuing another for the same person replaces the one before. Redeeming it happens
 * before anyone is signed in, in server/storage.ts.
 */

export const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Where the person goes: the sign-in page, which offers the new-password form. */
export function passwordResetLink(origin: string, reset: { token: string; username: string }): string {
  const query = new URLSearchParams({ reset: reset.token, username: reset.username });
  return `${origin.replace(/\/+$/, '')}/auth?${query.toString()}`;
}

export interface IssuedReset {
  id: string;
  token: string;
  expiresAt: Date;
}

/**
 * Issues a reset for `userId`, inside the caller's tenant transaction, replacing any unused one.
 * The caller checks that the user is a person in this organization.
 */
export async function issuePasswordReset(
  tx: TenantTx,
  input: { organizationId: number; userId: number; createdBy: number | null },
  now = new Date(),
): Promise<IssuedReset> {
  await tx
    .delete(passwordResets)
    .where(and(eq(passwordResets.userId, input.userId), eq(passwordResets.organizationId, input.organizationId), isNull(passwordResets.usedAt)));

  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  await tx.insert(passwordResets).values({
    id,
    organizationId: input.organizationId,
    userId: input.userId,
    tokenHash: hashResetToken(token),
    createdBy: input.createdBy,
    expiresAt,
  });
  return { id, token, expiresAt };
}
