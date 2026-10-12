import { activeDataKey, dataKey, type KeyExecutor } from './organization-keys';
import { masterKeys, open, seal, secretAad } from './master-keys';

/**
 * Encryption of stored secrets: environment secrets, tracker and source-host tokens, grid keys,
 * SMTP passwords, single sign-on client secrets, second-factor secrets, saved login states.
 *
 * Two formats live in the same three columns (value, IV, authentication tag):
 *
 *   - `v2:<key version>:<hex>` — encrypted with the organization's data key of that version, bound
 *     to the organization through the authenticated data. Everything written since migration 0084.
 *   - `<hex>` with no prefix — encrypted directly with the master key, as every value was before.
 *     Still read, with ENCRYPTION_KEY or one of ENCRYPTION_KEY_PREVIOUS; never written any more.
 *     scripts/wfm-rotate-key.ts moves them to the organization's key in one go.
 *
 * Decrypting needs the organization id for the first format, so the row's organization is passed
 * alongside the value: a secret copied to another organization's row stops being readable there,
 * which is the isolation the per-organization keys are for. See server/organization-keys.ts for
 * where the keys come from and why a lookup inside a transaction must go through it.
 */

export const ENVELOPE_PREFIX = 'v2:';

export interface EncryptedSecret {
  encryptedValue: string;
  iv: string;
  authTag: string;
}

export interface CryptoOptions {
  /**
   * The transaction the caller is inside, when it is a privileged one: the key lookup runs
   * through it. A tenant transaction is found on its own (server/middleware/tenancy.ts).
   */
  tx?: KeyExecutor;
}

const ENVELOPE = /^v2:(\d+):([0-9a-fA-F]*)$/;

/** The key version and ciphertext of an envelope value, or null for a master-key value. */
export function parseEnvelope(
  encryptedValue: string,
): { version: number; ciphertext: string } | null {
  const match = ENVELOPE.exec(encryptedValue);
  if (!match) return null;
  return { version: Number(match[1]), ciphertext: match[2] };
}

/** Encrypts with the organization's active data key. */
export async function encryptSecret(
  text: string,
  organizationId: number,
  options: CryptoOptions = {},
): Promise<EncryptedSecret> {
  const key = await activeDataKey(organizationId, options.tx);
  const sealed = seal(text, key.key, secretAad(organizationId, key.version));
  return { ...sealed, encryptedValue: `${ENVELOPE_PREFIX}${key.version}:${sealed.encryptedValue}` };
}

/**
 * Decrypts a stored value: with the organization's key of the version the value names, or with
 * the master keys for a value from before migration 0084, for which the organization is not
 * needed. Throws when the value belongs to another organization, was tampered with, or was
 * encrypted with a master key no longer configured.
 */
export async function decryptSecret(
  encryptedValue: string,
  iv: string,
  authTag: string,
  organizationId?: number,
  options: CryptoOptions = {},
): Promise<string> {
  const envelope = parseEnvelope(encryptedValue);
  if (!envelope) return decryptWithMasterKey(encryptedValue, iv, authTag);
  if (organizationId === undefined) {
    throw new Error(
      'This value is encrypted with an organization key: decrypting it needs the organization id.',
    );
  }
  const key = await dataKey(organizationId, envelope.version, options.tx);
  return open(
    envelope.ciphertext,
    iv,
    authTag,
    key.key,
    secretAad(organizationId, envelope.version),
  );
}

/**
 * The format from before migration 0084, directly under ENCRYPTION_KEY. Nothing in the server
 * writes it any more; tests use it to stand up such rows, and the rotation script's test to
 * check they are moved.
 */
export function encryptWithMasterKey(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): EncryptedSecret {
  return seal(text, masterKeys(env).current.key);
}

/** Reads a master-key value with ENCRYPTION_KEY, then with each of ENCRYPTION_KEY_PREVIOUS. */
export function decryptWithMasterKey(
  encryptedValue: string,
  iv: string,
  authTag: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const { current, previous } = masterKeys(env);
  let lastError: unknown;
  for (const master of [current, ...previous]) {
    try {
      return open(encryptedValue, iv, authTag, master.key);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not decrypt the value.');
}
