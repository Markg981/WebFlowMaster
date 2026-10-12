import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * The master keys and the AES-256-GCM primitives under every stored secret.
 *
 * Nothing here touches the database: this is the pure layer that server/platform/organization-keys.ts
 * (the per-organization data keys) and server/platform/crypto.ts (what the rest of the server calls) are
 * built on. A master key comes from ENCRYPTION_KEY, exactly as it always has — a 64-character hex
 * string is the key, anything else is hashed into one — and ENCRYPTION_KEY_PREVIOUS lists the
 * master keys an installation rotated away from, so what they wrapped or encrypted still reads.
 */

const ALGORITHM = 'aes-256-gcm';
/** 16 bytes, as every value stored since the first migration; GCM's 12 would also do. */
const IV_BYTES = 16;
const TAG_BYTES = 16;
export const DATA_KEY_BYTES = 32;

export interface MasterKey {
  /** sha256 of the key, first 16 hex characters: what the backup manifest calls its fingerprint. */
  id: string;
  key: Buffer;
}

export interface MasterKeys {
  current: MasterKey;
  /** Oldest last, in the order ENCRYPTION_KEY_PREVIOUS lists them. Never includes the current key. */
  previous: MasterKey[];
}

/** The 32 bytes a configured value stands for. */
export function deriveMasterKey(keyString: string): Buffer {
  if (keyString.length === 64 && /^[0-9a-fA-F]+$/.test(keyString)) {
    return Buffer.from(keyString, 'hex');
  }
  return createHash('sha256').update(keyString).digest();
}

export function masterKeyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export class MasterKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MasterKeyError';
  }
}

let cached: { signature: string; keys: MasterKeys } | undefined;

/**
 * The configured master keys. Memoised on the two variables' values, so a process that changes
 * its environment (the test suite does) sees the change and everything else pays for the hashing
 * once.
 */
export function masterKeys(env: NodeJS.ProcessEnv = process.env): MasterKeys {
  const currentString = env.ENCRYPTION_KEY;
  if (!currentString) {
    throw new MasterKeyError(
      'ENCRYPTION_KEY is missing in environment variables. Please add a 32-byte hex string to .env',
    );
  }
  const previousString = env.ENCRYPTION_KEY_PREVIOUS ?? '';
  const signature = `${currentString}\u0000${previousString}`;
  if (cached?.signature === signature) return cached.keys;

  const currentKey = deriveMasterKey(currentString);
  const current: MasterKey = { id: masterKeyId(currentKey), key: currentKey };
  const previous: MasterKey[] = [];
  for (const entry of previousString.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const key = deriveMasterKey(trimmed);
    const id = masterKeyId(key);
    if (id === current.id || previous.some((p) => p.id === id)) continue;
    previous.push({ id, key });
  }
  cached = { signature, keys: { current, previous } };
  return cached.keys;
}

/** The master key with this fingerprint among the configured ones, or undefined. */
export function masterKeyById(id: string, keys: MasterKeys = masterKeys()): MasterKey | undefined {
  if (keys.current.id === id) return keys.current;
  return keys.previous.find((key) => key.id === id);
}

export interface Sealed {
  encryptedValue: string;
  iv: string;
  authTag: string;
}

/** AES-256-GCM, hex in and out, the three-column shape every encrypted row has. */
export function seal(text: string, key: Buffer, aad?: string): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    encryptedValue: encrypted,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

/** The inverse of seal; throws when the key, the data or the authenticated data do not match. */
export function open(
  encryptedValue: string,
  ivHex: string,
  authTagHex: string,
  key: Buffer,
  aad?: string,
): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedValue, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * The authenticated data that binds a wrapped key, and every value encrypted with it, to one
 * organization and one key version: a row copied between organizations, or a key moved to another
 * version, fails to open instead of opening in the wrong place.
 */
export function keyWrapAad(organizationId: number, version: number): string {
  return `wfm-organization-key:${organizationId}:${version}`;
}

export function secretAad(organizationId: number, version: number): string {
  return `wfm-secret:${organizationId}:${version}`;
}

export function newDataKey(): Buffer {
  return randomBytes(DATA_KEY_BYTES);
}

/**
 * A data key encrypted under a master key, as one hex string: the 16-byte IV, the 16-byte
 * authentication tag, then the 32 encrypted bytes.
 */
export function wrapDataKey(
  dataKey: Buffer,
  master: MasterKey,
  organizationId: number,
  version: number,
): string {
  if (dataKey.length !== DATA_KEY_BYTES) throw new MasterKeyError('A data key is 32 bytes.');
  const sealed = seal(dataKey.toString('hex'), master.key, keyWrapAad(organizationId, version));
  // The plaintext is hex, so the ciphertext is twice the key's length; stored as is.
  return sealed.iv + sealed.authTag + sealed.encryptedValue;
}

export function unwrapDataKey(
  wrapped: string,
  master: MasterKey,
  organizationId: number,
  version: number,
): Buffer {
  const ivEnd = IV_BYTES * 2;
  const tagEnd = ivEnd + TAG_BYTES * 2;
  if (!/^[0-9a-f]+$/i.test(wrapped) || wrapped.length <= tagEnd) {
    throw new MasterKeyError(
      `The wrapped key of organization ${organizationId}, version ${version}, is not in the stored format.`,
    );
  }
  let keyHex: string;
  try {
    keyHex = open(
      wrapped.slice(tagEnd),
      wrapped.slice(0, ivEnd),
      wrapped.slice(ivEnd, tagEnd),
      master.key,
      keyWrapAad(organizationId, version),
    );
  } catch {
    throw new MasterKeyError(
      `The wrapped key of organization ${organizationId}, version ${version}, does not open with master key ${master.id}: it was tampered with, or wrapped by a key that is not configured.`,
    );
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== DATA_KEY_BYTES) {
    throw new MasterKeyError(
      `The wrapped key of organization ${organizationId}, version ${version}, is not a 32-byte key.`,
    );
  }
  return key;
}
