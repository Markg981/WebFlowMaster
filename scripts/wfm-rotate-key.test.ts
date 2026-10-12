import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';
import { privilegedDb } from '../server/platform/db';
import { createTestOrganization, createTestUser } from '../server/tests/factories';
import { decryptSecret, encryptWithMasterKey, parseEnvelope } from '../server/platform/crypto';
import { forgetCachedKeys, listStoredKeys } from '../server/platform/organization-keys';
import { deriveMasterKey, seal } from '../server/platform/master-keys';
import { ENCRYPTED_COLUMNS, parseArgs, rotateKeys } from './wfm-rotate-key';

const FIRST_KEY = '0'.repeat(64);
const SECOND_KEY = 'b'.repeat(64);

let org: number;
let other: number;
let userId: number;
let environmentId: number;

async function legacySecret(organizationId: number, keyName: string, value: string) {
  const sealed = encryptWithMasterKey(value);
  await privilegedDb.execute(
    sql`INSERT INTO secrets (environment_id, key_name, encrypted_value, iv, auth_tag, user_id, organization_id)
        VALUES (${environmentId}, ${keyName}, ${sealed.encryptedValue}, ${sealed.iv}, ${sealed.authTag}, ${userId}, ${organizationId})`,
  );
}

async function secretRows(organizationId: number) {
  const rows = await privilegedDb.execute(
    sql`SELECT key_name, encrypted_value, iv, auth_tag FROM secrets WHERE organization_id = ${organizationId} ORDER BY key_name`,
  );
  return rows.rows as { key_name: string; encrypted_value: string; iv: string; auth_tag: string }[];
}

beforeAll(async () => {
  org = await createTestOrganization('Rotate Org');
  other = await createTestOrganization('Other Rotate Org');
  userId = await createTestUser(org);
  const otherUser = await createTestUser(other);
  const [env] = (
    await privilegedDb.execute(
      sql`INSERT INTO environments (name, user_id, organization_id) VALUES ('Staging', ${userId}, ${org}) RETURNING id`,
    )
  ).rows as { id: number }[];
  environmentId = Number(env.id);
  await legacySecret(org, 'password', 'hunter2');
  const [otherEnv] = (
    await privilegedDb.execute(
      sql`INSERT INTO environments (name, user_id, organization_id) VALUES ('Theirs', ${otherUser}, ${other}) RETURNING id`,
    )
  ).rows as { id: number }[];
  const theirs = encryptWithMasterKey('theirs');
  await privilegedDb.execute(
    sql`INSERT INTO secrets (environment_id, key_name, encrypted_value, iv, auth_tag, user_id, organization_id)
        VALUES (${Number(otherEnv.id)}, 'password', ${theirs.encryptedValue}, ${theirs.iv}, ${theirs.authTag}, ${otherUser}, ${other})`,
  );
  const token = encryptWithMasterKey('jira-token');
  await privilegedDb.execute(
    sql`INSERT INTO issue_trackers (id, organization_id, name, provider, base_url, project_key, encrypted_token, token_iv, token_auth_tag)
        VALUES ('tracker-1', ${org}, 'Jira', 'jira', 'https://acme.atlassian.net', 'SHOP', ${token.encryptedValue}, ${token.iv}, ${token.authTag})`,
  );
  const totp = encryptWithMasterKey('JBSWY3DPEHPK3PXP');
  await privilegedDb.execute(
    sql`INSERT INTO user_mfa (user_id, secret_encrypted, secret_iv, secret_auth_tag, enabled_at)
        VALUES (${userId}, ${totp.encryptedValue}, ${totp.iv}, ${totp.authTag}, now())`,
  );
  const signing = encryptWithMasterKey('whsec_123');
  await privilegedDb.execute(
    sql`INSERT INTO organization_mail_settings (organization_id, provider, signing_secret)
        VALUES (${org}, 'generic', ${JSON.stringify(signing)}::jsonb)`,
  );
});

afterEach(() => {
  process.env.ENCRYPTION_KEY = FIRST_KEY;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  forgetCachedKeys();
});

describe('ENCRYPTED_COLUMNS', () => {
  it('names every encrypted column the schema declares', () => {
    const declared: string[] = [];
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      for (const column of Object.values(getTableColumns(value))) {
        if (column.name.endsWith('_auth_tag'))
          declared.push(`${getTableName(value)}.${column.name}`);
      }
    }
    expect(declared.length).toBeGreaterThan(5);
    const covered = ENCRYPTED_COLUMNS.filter((c) => !c.json).map((c) => `${c.table}.${c.tag}`);
    for (const name of declared) expect(covered, `${name} is not rotated`).toContain(name);
    expect(ENCRYPTED_COLUMNS.filter((c) => c.json).map((c) => `${c.table}.${c.value}`)).toEqual([
      'organization_mail_settings.smtp_password',
      'organization_mail_settings.signing_secret',
    ]);
  });
});

describe('rotateKeys', () => {
  it('moves values encrypted with the master key to their organization key, once', async () => {
    const first = await rotateKeys();
    expect(first.unreadable).toEqual([]);
    expect(first.keysRewrapped).toBe(0);
    expect(first.reencrypted).toEqual({
      'secrets.encrypted_value': 2,
      'issue_trackers.encrypted_token': 1,
      'user_mfa.secret_encrypted': 1,
      'organization_mail_settings.signing_secret': 1,
    });

    const [password] = await secretRows(org);
    expect(parseEnvelope(password.encrypted_value)).toMatchObject({ version: 1 });
    expect(await decryptSecret(password.encrypted_value, password.iv, password.auth_tag, org)).toBe(
      'hunter2',
    );
    const [mail] = (
      await privilegedDb.execute(
        sql`SELECT signing_secret FROM organization_mail_settings WHERE organization_id = ${org}`,
      )
    ).rows as { signing_secret: { encryptedValue: string; iv: string; authTag: string } }[];
    expect(mail.signing_secret.encryptedValue).toMatch(/^v2:1:/);
    expect(
      await decryptSecret(
        mail.signing_secret.encryptedValue,
        mail.signing_secret.iv,
        mail.signing_secret.authTag,
        org,
      ),
    ).toBe('whsec_123');

    const second = await rotateKeys();
    expect(second.reencrypted).toEqual({});
    expect(second.unchanged).toBe(5);
    expect(second.keysRewrapped).toBe(0);
  });

  it('re-wraps every organization key under a new master key, reading with the previous one', async () => {
    await legacySecret(org, 'late', 'written-under-the-old-key');
    process.env.ENCRYPTION_KEY = SECOND_KEY;
    process.env.ENCRYPTION_KEY_PREVIOUS = FIRST_KEY;
    forgetCachedKeys();

    const report = await rotateKeys();
    expect(report.unreadable).toEqual([]);
    expect(report.keysRewrapped).toBe(2);
    expect(report.reencrypted).toEqual({ 'secrets.encrypted_value': 1 });

    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    forgetCachedKeys();
    const again = await rotateKeys();
    expect(again.keysRewrapped).toBe(0);
    expect(again.reencrypted).toEqual({});
    const late = (await secretRows(org)).find((r) => r.key_name === 'late')!;
    expect(await decryptSecret(late.encrypted_value, late.iv, late.auth_tag, org)).toBe(
      'written-under-the-old-key',
    );

    // Back under the suite's key, so the tests below start from it.
    process.env.ENCRYPTION_KEY = FIRST_KEY;
    process.env.ENCRYPTION_KEY_PREVIOUS = SECOND_KEY;
    forgetCachedKeys();
    expect((await rotateKeys()).keysRewrapped).toBe(2);
  });

  it("rotates one organization's key, re-encrypts only its values and prunes the retired version", async () => {
    const report = await rotateKeys({ organizationId: org, prune: true });
    expect(report.keyCreated).toEqual({ organizationId: org, version: 2 });
    expect(report.keysRetired).toBe(1);
    expect(report.keysPruned).toBe(1);
    expect(report.reencrypted).toEqual({
      'secrets.encrypted_value': 2,
      'issue_trackers.encrypted_token': 1,
      'user_mfa.secret_encrypted': 1,
      'organization_mail_settings.signing_secret': 1,
    });
    expect(await listStoredKeys(org)).toMatchObject([{ keyVersion: 2, retiredAt: null }]);
    for (const row of await secretRows(org)) {
      expect(row.encrypted_value).toMatch(/^v2:2:/);
      await expect(
        decryptSecret(row.encrypted_value, row.iv, row.auth_tag, org),
      ).resolves.toBeTruthy();
    }
    // The other organization was not touched.
    const [theirs] = await secretRows(other);
    expect(theirs.encrypted_value).toMatch(/^v2:1:/);
    expect(await listStoredKeys(other)).toMatchObject([{ keyVersion: 1, retiredAt: null }]);
  });

  it('writes nothing on a dry run', async () => {
    const report = await rotateKeys({ organizationId: org, dryRun: true, prune: true });
    expect(report.dryRun).toBe(true);
    expect(report.keyCreated).toEqual({ organizationId: org, version: 3 });
    expect(Object.values(report.reencrypted).reduce((a, b) => a + b, 0)).toBe(5);
    expect(await listStoredKeys(org)).toMatchObject([{ keyVersion: 2, retiredAt: null }]);
    for (const row of await secretRows(org)) expect(row.encrypted_value).toMatch(/^v2:2:/);
  });

  it('reports a value no configured key opens and leaves it as it is', async () => {
    const foreign = seal('lost', deriveMasterKey('some-key-nobody-configured'));
    await privilegedDb.execute(
      sql`INSERT INTO secrets (environment_id, key_name, encrypted_value, iv, auth_tag, user_id, organization_id)
          VALUES (${environmentId}, 'orphan', ${foreign.encryptedValue}, ${foreign.iv}, ${foreign.authTag}, ${userId}, ${org})`,
    );
    const report = await rotateKeys();
    expect(report.unreadable).toHaveLength(1);
    expect(report.unreadable[0]).toMatch(/^secrets\.encrypted_value \(id=\d+\)/);
    const orphan = (await secretRows(org)).find((r) => r.key_name === 'orphan')!;
    expect(orphan.encrypted_value).toBe(foreign.encryptedValue);
    await privilegedDb.execute(sql`DELETE FROM secrets WHERE key_name = 'orphan'`);
  });
});

describe('parseArgs', () => {
  it('reads the organization, prune and dry-run flags', () => {
    expect(parseArgs(['--organization', '7', '--prune', '--dry-run'])).toEqual({
      organizationId: 7,
      prune: true,
      dryRun: true,
      help: false,
    });
    expect(parseArgs([])).toEqual({ prune: false, dryRun: false, help: false });
  });

  it('refuses a bad organization id and unknown arguments', () => {
    expect(() => parseArgs(['--organization', 'acme'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--all'])).toThrow(/Unknown argument/);
  });
});
