import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { organizationKeys } from '@shared/schema';
import { privilegedDb } from './db';
import { createTestOrganization } from '../tests/factories';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import {
  decryptSecret,
  decryptWithMasterKey,
  encryptSecret,
  encryptWithMasterKey,
  parseEnvelope,
} from './crypto';
import {
  assertOrganizationKeysReadable,
  forgetCachedKeys,
  listStoredKeys,
  rewrapStoredKey,
  rotateOrganizationKey,
} from './organization-keys';
import {
  deriveMasterKey,
  masterKeyId,
  masterKeys,
  newDataKey,
  unwrapDataKey,
  wrapDataKey,
} from './master-keys';

/** What vitest.config.ts configures: the key every row of this file starts under. */
const FIRST_KEY = '0'.repeat(64);
const SECOND_KEY = 'a'.repeat(64);
const idOf = (keyString: string) => masterKeyId(deriveMasterKey(keyString));

let orgA: number;
let orgB: number;

beforeAll(async () => {
  orgA = await createTestOrganization('Crypto A');
  orgB = await createTestOrganization('Crypto B');
});

afterEach(() => {
  process.env.ENCRYPTION_KEY = FIRST_KEY;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  forgetCachedKeys();
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips under the organization key and names the key version', async () => {
    const sealed = await encryptSecret('hunter2', orgA);
    expect(sealed.encryptedValue).toMatch(/^v2:1:[0-9a-f]+$/);
    expect(sealed.iv).toMatch(/^[0-9a-f]{32}$/);
    expect(sealed.authTag).toMatch(/^[0-9a-f]{32}$/);
    expect(parseEnvelope(sealed.encryptedValue)).toMatchObject({ version: 1 });
    expect(await decryptSecret(sealed.encryptedValue, sealed.iv, sealed.authTag, orgA)).toBe(
      'hunter2',
    );
  });

  it('creates one active key for the organization on first use and reuses it', async () => {
    await encryptSecret('one', orgA);
    await encryptSecret('two', orgA);
    const stored = await listStoredKeys(orgA);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      keyVersion: 1,
      masterKeyId: idOf(FIRST_KEY),
      retiredAt: null,
    });
  });

  it('still reads a value encrypted directly with the master key, with or without an organization', async () => {
    const legacy = encryptWithMasterKey('old-token');
    expect(parseEnvelope(legacy.encryptedValue)).toBeNull();
    expect(await decryptSecret(legacy.encryptedValue, legacy.iv, legacy.authTag)).toBe('old-token');
    expect(await decryptSecret(legacy.encryptedValue, legacy.iv, legacy.authTag, orgB)).toBe(
      'old-token',
    );
  });

  it("does not decrypt one organization's value for another, nor without an organization", async () => {
    const sealed = await encryptSecret('only-for-a', orgA);
    // B has a key of its own at the same version: the wrong key, not a missing one.
    await encryptSecret('b-has-keys-too', orgB);
    await expect(
      decryptSecret(sealed.encryptedValue, sealed.iv, sealed.authTag, orgB),
    ).rejects.toThrow();
    await expect(decryptSecret(sealed.encryptedValue, sealed.iv, sealed.authTag)).rejects.toThrow(
      /needs the organization id/,
    );
  });

  it('detects a tampered wrapped key instead of decrypting with garbage', async () => {
    const sealed = await encryptSecret('intact', orgA);
    const [row] = await privilegedDb
      .select()
      .from(organizationKeys)
      .where(eq(organizationKeys.organizationId, orgA));
    const flipped = (row.wrappedKey[70] === '0' ? '1' : '0') + '';
    const tampered = row.wrappedKey.slice(0, 70) + flipped + row.wrappedKey.slice(71);
    await privilegedDb
      .update(organizationKeys)
      .set({ wrappedKey: tampered })
      .where(eq(organizationKeys.id, row.id));
    forgetCachedKeys();
    await expect(
      decryptSecret(sealed.encryptedValue, sealed.iv, sealed.authTag, orgA),
    ).rejects.toThrow(/tampered with/);
    await expect(assertOrganizationKeysReadable()).rejects.toThrow(/Refusing to start/);
    await privilegedDb
      .update(organizationKeys)
      .set({ wrappedKey: row.wrappedKey })
      .where(eq(organizationKeys.id, row.id));
  });

  it('binds a wrapped key to its organization and version', () => {
    const key = newDataKey();
    const { current } = masterKeys();
    const wrapped = wrapDataKey(key, current, 7, 1);
    expect(unwrapDataKey(wrapped, current, 7, 1).equals(key)).toBe(true);
    expect(() => unwrapDataKey(wrapped, current, 8, 1)).toThrow(/does not open/);
    expect(() => unwrapDataKey(wrapped, current, 7, 2)).toThrow(/does not open/);
  });

  it('works inside a tenant transaction and inside a privileged one it is told about', async () => {
    const inTenant = await runWithTenant(orgA, () =>
      withTenantTransaction(async () => {
        const sealed = await encryptSecret('in-tx', orgA);
        return decryptSecret(sealed.encryptedValue, sealed.iv, sealed.authTag, orgA);
      }),
    );
    expect(inTenant).toBe('in-tx');
    const inPrivileged = await privilegedDb.transaction(async (tx) => {
      const sealed = await encryptSecret('in-privileged-tx', orgB, { tx });
      return decryptSecret(sealed.encryptedValue, sealed.iv, sealed.authTag, orgB, { tx });
    });
    expect(inPrivileged).toBe('in-privileged-tx');
  });
});

describe('master key rotation', () => {
  it('reads keys wrapped by a previous master key, and re-wraps them under the current one', async () => {
    const sealed = await encryptSecret('survives', orgA);
    const legacy = encryptWithMasterKey('legacy-survives');

    process.env.ENCRYPTION_KEY = SECOND_KEY;
    forgetCachedKeys();
    await expect(assertOrganizationKeysReadable()).rejects.toThrow(
      new RegExp(`wrapped by master key ${idOf(FIRST_KEY)}`),
    );
    await expect(
      decryptSecret(sealed.encryptedValue, sealed.iv, sealed.authTag, orgA),
    ).rejects.toThrow(/neither ENCRYPTION_KEY nor listed in ENCRYPTION_KEY_PREVIOUS/);
    expect(() => decryptWithMasterKey(legacy.encryptedValue, legacy.iv, legacy.authTag)).toThrow();

    process.env.ENCRYPTION_KEY_PREVIOUS = ` ${FIRST_KEY} ,`;
    forgetCachedKeys();
    await expect(assertOrganizationKeysReadable()).resolves.toBeUndefined();
    expect(await decryptSecret(sealed.encryptedValue, sealed.iv, sealed.authTag, orgA)).toBe(
      'survives',
    );
    expect(decryptWithMasterKey(legacy.encryptedValue, legacy.iv, legacy.authTag)).toBe(
      'legacy-survives',
    );
    // A key made from here on is wrapped under the current master key.
    const orgC = await createTestOrganization('Crypto C');
    const fresh = await encryptSecret('fresh', orgC);
    expect((await listStoredKeys(orgC)).at(-1)?.masterKeyId).toBe(idOf(SECOND_KEY));

    for (const stored of await listStoredKeys()) await rewrapStoredKey(stored);
    expect((await listStoredKeys()).every((k) => k.masterKeyId === idOf(SECOND_KEY))).toBe(true);

    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    forgetCachedKeys();
    expect(await decryptSecret(sealed.encryptedValue, sealed.iv, sealed.authTag, orgA)).toBe(
      'survives',
    );
    expect(await decryptSecret(fresh.encryptedValue, fresh.iv, fresh.authTag, orgC)).toBe('fresh');

    // Back to the suite's key for the other tests: wrap everything under it again.
    process.env.ENCRYPTION_KEY = FIRST_KEY;
    process.env.ENCRYPTION_KEY_PREVIOUS = SECOND_KEY;
    forgetCachedKeys();
    for (const stored of await listStoredKeys()) await rewrapStoredKey(stored);
  });
});

describe('organization key rotation', () => {
  it('gives the organization a new version, keeps the retired one for old values', async () => {
    const before = await encryptSecret('before-rotation', orgA);
    const rotated = await rotateOrganizationKey(orgA);
    const stored = await listStoredKeys(orgA);
    expect(rotated.version).toBe(stored.length);
    expect(stored.filter((k) => k.retiredAt === null)).toHaveLength(1);
    expect(stored.find((k) => k.keyVersion === rotated.version)?.retiredAt).toBeNull();
    expect(stored.find((k) => k.keyVersion === 1)?.retiredAt).not.toBeNull();

    const after = await encryptSecret('after-rotation', orgA);
    expect(after.encryptedValue.startsWith(`v2:${rotated.version}:`)).toBe(true);
    expect(await decryptSecret(before.encryptedValue, before.iv, before.authTag, orgA)).toBe(
      'before-rotation',
    );
    expect(await decryptSecret(after.encryptedValue, after.iv, after.authTag, orgA)).toBe(
      'after-rotation',
    );
    // Another process, with nothing cached, reads the same.
    forgetCachedKeys();
    expect(await decryptSecret(before.encryptedValue, before.iv, before.authTag, orgA)).toBe(
      'before-rotation',
    );
  });

  it('refuses a version the organization never had', async () => {
    const sealed = await encryptSecret('x', orgB);
    const forged = sealed.encryptedValue.replace(/^v2:\d+:/, 'v2:99:');
    await expect(decryptSecret(forged, sealed.iv, sealed.authTag, orgB)).rejects.toThrow(
      /no encryption key version 99/,
    );
  });

  it('is policed by row-level security like every other organization table', async () => {
    const rows = await privilegedDb.execute(sql`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'organization_keys'
    `);
    expect(rows.rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
