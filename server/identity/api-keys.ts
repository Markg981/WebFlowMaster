import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Minting and recognising the credential a pipeline uses.
 *
 * Deliberately not the password machinery in server/auth.ts. A password is short, chosen by a
 * person and therefore guessable, so it is stretched with scrypt to make each guess expensive.
 * A key is 32 random bytes: there is nothing to guess, stretching would buy nothing, and it
 * would cost a scrypt per request on a path a CI job hits in a loop. A single SHA-256 is the
 * right primitive for a high-entropy secret, and it is what makes the lookup a single indexed
 * query rather than a scan that hashes every row.
 */

/** Marks the string as ours in logs, in secret stores and in a pasted screenshot. */
export const API_KEY_PREFIX = 'wfm';

/** Enough of the key to tell two of them apart in a list, and far too little to use. */
const VISIBLE_PREFIX_LENGTH = 12;

export interface GeneratedApiKey {
  /** The whole key. Returned once, at creation, and never stored anywhere. */
  key: string;
  /** SHA-256 of the key, which is what the row holds and what a request is matched against. */
  hashedKey: string;
  /** `wfm_a1b2c3d4`, shown in listings. */
  prefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  // base64url rather than hex: the same 256 bits in a third fewer characters, and nothing in
  // it needs escaping in a shell, a YAML file or an HTTP header.
  const key = `${API_KEY_PREFIX}_${randomBytes(32).toString('base64url')}`;
  return { key, hashedKey: hashApiKey(key), prefix: key.slice(0, VISIBLE_PREFIX_LENGTH) };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Compares two hashes without leaking, through timing, how far they matched. */
export function hashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The key a request carries, or null when it carries none.
 *
 * Both spellings are accepted because both are what people already have in their pipelines:
 * `Authorization: Bearer …` is what an HTTP client does by default, and `X-API-Key` is what
 * most CI examples paste. Anything else — a Basic header, a query parameter — is not a key;
 * a key in a URL ends up in access logs and browser history.
 */
export function apiKeyFromRequest(headers: {
  authorization?: string | string[];
  'x-api-key'?: string | string[];
}): string | null {
  const explicit = firstValue(headers['x-api-key']);
  if (explicit) return explicit.trim() || null;

  const authorization = firstValue(headers.authorization);
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return null;
  const candidate = match[1].trim();
  // A session cookie is how a browser authenticates; a Bearer token that is not one of ours
  // is somebody else's scheme, and guessing at it would turn an unrelated header into a
  // failed login.
  return candidate.startsWith(`${API_KEY_PREFIX}_`) ? candidate : null;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Why a key was refused. The caller is told only that it was — see the middleware. */
export type ApiKeyRejection = 'unknown' | 'revoked' | 'expired';

export function rejectionFor(
  row: { revokedAt?: Date | null; expiresAt?: Date | null } | undefined,
  now: Date = new Date(),
): ApiKeyRejection | null {
  if (!row) return 'unknown';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return null;
}
