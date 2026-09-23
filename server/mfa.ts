import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { AUDIT_ACTIONS, auditLog, organizations, userMfa, type AuditAction } from '@shared/schema';
import { privilegedDb } from './db';
import { decryptSecret, encryptSecret } from './crypto';
import type { AuditActor } from './audit';

/**
 * The second factor: TOTP codes from an authenticator app (RFC 6238), and recovery codes.
 *
 * Written against node's crypto rather than a library because the algorithm is twenty lines
 * and every line of it is security-relevant; a dependency would be more code to trust, not less.
 *
 * Everything here runs on the privileged handle, for one user at a time, named by the id of the
 * user the request authenticated as. user_mfa has no RLS and app_user has no grant on it: it is
 * not organization data, and nothing in a tenant transaction has any business reading a secret.
 * Each change and its audit entry are written in one transaction, so they cannot disagree.
 */

/** Seconds per code. Every authenticator app assumes 30. */
const STEP_SECONDS = 30;
const DIGITS = 6;
/** Steps either side of now that still count: a phone a little fast or slow, a slow typist. */
const DRIFT_STEPS = 1;
const RECOVERY_CODE_COUNT = 10;
const ISSUER = process.env.MFA_ISSUER?.trim() || 'WebFlowMaster';

// ─── TOTP ─────────────────────────────────────────────────────────────────────

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for one 30-second step. */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function currentStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The step a code belongs to, within the allowed drift, or null. */
export function matchingStep(secret: string, code: string, now: number = Date.now()): number | null {
  const candidate = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return null;
  const step = currentStep(now);
  for (let delta = -DRIFT_STEPS; delta <= DRIFT_STEPS; delta++) {
    if (sameCode(totpAt(secret, step + delta), candidate)) return step + delta;
  }
  return null;
}

export function otpauthUri(secret: string, account: string): string {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ─── Recovery codes ───────────────────────────────────────────────────────────

/** Lower case, no separators, so "ABCDE-FGHIJ", "abcde fghij" and "abcdefghij" are one code. */
function normaliseRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}

function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}

function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

// ─── Storage ──────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof privilegedDb.transaction>[0]>[0];

/**
 * The one statement here that names an organization's table: the entry for a change made in
 * the same transaction. The organization is the actor's own, from their session.
 */
async function audit(tx: Tx, organizationId: number, actor: AuditActor, action: AuditAction, metadata?: Record<string, unknown>) {
  await tx.insert(auditLog).values({ organizationId, actorUserId: actor.id, actorUsername: actor.username, apiKeyId: actor.apiKeyId ?? null, ipAddress: actor.ipAddress ?? null, action, targetType: 'user', targetId: String(actor.id), metadata: metadata ?? null });
}

export interface MfaStatus {
  enabled: boolean;
  enabledAt: Date | null;
  recoveryCodesLeft: number;
  /** Whether the organization requires every member to have it. */
  required: boolean;
}

export async function mfaStatus(userId: number, organizationId: number): Promise<MfaStatus> {
  const [row] = await privilegedDb
    .select({ required: organizations.mfaRequired, enabledAt: userMfa.enabledAt, recoveryCodes: userMfa.recoveryCodes })
    .from(organizations)
    .leftJoin(userMfa, eq(userMfa.userId, userId))
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return {
    enabled: Boolean(row?.enabledAt),
    enabledAt: row?.enabledAt ?? null,
    recoveryCodesLeft: row?.enabledAt ? (row.recoveryCodes ?? []).length : 0,
    required: row?.required ?? false,
  };
}

export async function isMfaEnabled(userId: number): Promise<boolean> {
  const [row] = await privilegedDb.select({ enabledAt: userMfa.enabledAt }).from(userMfa).where(eq(userMfa.userId, userId)).limit(1);
  return Boolean(row?.enabledAt);
}

/**
 * Starts enrolling: a new secret, kept as pending until a code from it is confirmed.
 *
 * Returns null when MFA is already on — changing phones means turning it off first, with a
 * code from the old one, so a stolen session cannot quietly move somebody's second factor to
 * the thief's phone.
 */
export async function beginEnrollment(userId: number, account: string): Promise<{ secret: string; otpauthUri: string; qrDataUrl: string } | null> {
  if (await isMfaEnabled(userId)) return null;
  const secret = base32Encode(randomBytes(20));
  const { encryptedValue, iv, authTag } = encryptSecret(secret);
  await privilegedDb
    .insert(userMfa)
    .values({ userId, pendingSecretEncrypted: encryptedValue, pendingSecretIv: iv, pendingSecretAuthTag: authTag })
    .onConflictDoUpdate({
      target: userMfa.userId,
      set: { pendingSecretEncrypted: encryptedValue, pendingSecretIv: iv, pendingSecretAuthTag: authTag, updatedAt: new Date() },
    });
  const uri = otpauthUri(secret, account);
  return { secret, otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

/**
 * Finishes enrolling, if the code comes from the pending secret. Returns the recovery codes —
 * shown once, like an API key — or null for a wrong code or nothing pending.
 */
export async function confirmEnrollment(userId: number, organizationId: number, actor: AuditActor, code: string): Promise<string[] | null> {
  return privilegedDb.transaction(async (tx) => {
    const [row] = await tx.select().from(userMfa).where(eq(userMfa.userId, userId)).limit(1);
    if (!row || row.enabledAt || !row.pendingSecretEncrypted || !row.pendingSecretIv || !row.pendingSecretAuthTag) return null;
    const secret = decryptSecret(row.pendingSecretEncrypted, row.pendingSecretIv, row.pendingSecretAuthTag);
    const step = matchingStep(secret, code);
    if (step === null) return null;

    const { codes, hashes } = newRecoveryCodes();
    await tx
      .update(userMfa)
      .set({
        secretEncrypted: row.pendingSecretEncrypted,
        secretIv: row.pendingSecretIv,
        secretAuthTag: row.pendingSecretAuthTag,
        pendingSecretEncrypted: null,
        pendingSecretIv: null,
        pendingSecretAuthTag: null,
        enabledAt: new Date(),
        // The confirming code is spent: it cannot also be the first sign-in's.
        lastUsedStep: step,
        recoveryCodes: hashes,
        updatedAt: new Date(),
      })
      .where(eq(userMfa.userId, userId));
    await audit(tx, organizationId, actor, AUDIT_ACTIONS.MFA_ENABLED);
    return codes;
  });
}

export type SecondFactorMethod = 'totp' | 'recovery_code';

/**
 * Checks a code at sign-in or before a sensitive change: six digits from the app, or one of the
 * recovery codes. A TOTP code is accepted once — a later step than the last one accepted, set
 * with a conditional update so two requests racing with the same code cannot both pass. A
 * recovery code is removed as it is used, the same way.
 */
export async function verifySecondFactor(userId: number, organizationId: number, actor: AuditActor, input: string): Promise<SecondFactorMethod | null> {
  const [row] = await privilegedDb.select().from(userMfa).where(eq(userMfa.userId, userId)).limit(1);
  if (!row?.enabledAt || !row.secretEncrypted || !row.secretIv || !row.secretAuthTag) return null;

  const trimmed = input.trim();
  if (/^\d[\d\s]*$/.test(trimmed)) {
    const secret = decryptSecret(row.secretEncrypted, row.secretIv, row.secretAuthTag);
    const step = matchingStep(secret, trimmed);
    if (step === null) return null;
    const accepted = await privilegedDb
      .update(userMfa)
      .set({ lastUsedStep: step })
      .where(and(eq(userMfa.userId, userId), sql`(${userMfa.lastUsedStep} is null or ${userMfa.lastUsedStep} < ${step})`))
      .returning();
    return accepted.length > 0 ? 'totp' : null;
  }

  const hash = hashRecoveryCode(trimmed);
  return privilegedDb.transaction(async (tx) => {
    const consumed = await tx
      .update(userMfa)
      .set({ recoveryCodes: sql`${userMfa.recoveryCodes} - ${hash}::text`, updatedAt: new Date() })
      .where(and(eq(userMfa.userId, userId), sql`${userMfa.recoveryCodes} ? ${hash}::text`))
      .returning();
    if (consumed.length === 0) return null;
    // Worth knowing: a recovery code in use usually means a lost phone, or somebody else.
    await audit(tx, organizationId, actor, AUDIT_ACTIONS.MFA_RECOVERY_CODE_USED, { recoveryCodesLeft: consumed[0].recoveryCodes.length });
    return 'recovery_code' as const;
  });
}

/** A fresh set of recovery codes, replacing the old ones entirely. */
export async function regenerateRecoveryCodes(userId: number, organizationId: number, actor: AuditActor): Promise<string[] | null> {
  return privilegedDb.transaction(async (tx) => {
    const { codes, hashes } = newRecoveryCodes();
    const updated = await tx
      .update(userMfa)
      .set({ recoveryCodes: hashes, updatedAt: new Date() })
      .where(and(eq(userMfa.userId, userId), sql`${userMfa.enabledAt} is not null`))
      .returning();
    if (updated.length === 0) return null;
    await audit(tx, organizationId, actor, AUDIT_ACTIONS.MFA_RECOVERY_CODES_REGENERATED);
    return codes;
  });
}

export async function disableMfa(userId: number, organizationId: number, actor: AuditActor, disabledBy: 'self' | 'owner' = 'self'): Promise<boolean> {
  return privilegedDb.transaction(async (tx) => {
    const removed = await tx.delete(userMfa).where(eq(userMfa.userId, userId)).returning();
    if (removed.length === 0) return false;
    await audit(tx, organizationId, actor, AUDIT_ACTIONS.MFA_DISABLED, disabledBy === 'owner' ? { by: 'owner', userId } : undefined);
    return true;
  });
}

/**
 * Requires, or stops requiring, a second factor of the organization's members.
 *
 * Privileged because app_user may only read organizations; the id is the caller's own
 * organization, from their session, and the route allows owners only.
 */
export async function setMfaRequired(organizationId: number, actor: AuditActor, required: boolean): Promise<void> {
  await privilegedDb.transaction(async (tx) => {
    await tx.update(organizations).set({ mfaRequired: required }).where(eq(organizations.id, organizationId));
    await audit(tx, organizationId, actor, AUDIT_ACTIONS.MFA_POLICY_CHANGED, { required });
  });
}

/**
 * Whether a session must enrol before it can do anything else: its organization requires a
 * second factor and this user has none. One indexed query — it runs on every request of a
 * signed-in session, next to the one that loads the session's user.
 */
export async function mustEnrol(userId: number, organizationId: number): Promise<boolean> {
  const [row] = await privilegedDb
    .select({ required: organizations.mfaRequired, enabledAt: userMfa.enabledAt })
    .from(organizations)
    .leftJoin(userMfa, eq(userMfa.userId, userId))
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return Boolean(row?.required) && !row?.enabledAt;
}
