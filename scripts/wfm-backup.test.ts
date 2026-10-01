import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  COUNTED_TABLES,
  EXAMPLE_KEY_FINGERPRINT,
  MANIFEST_FORMAT,
  backupDirName,
  checkFiles,
  compareRestore,
  countsQuery,
  keyFingerprint,
  parseArgs,
  parseCounts,
  restoreRefusal,
  type Manifest,
} from './wfm-backup';

const database: Manifest['database'] = { name: 'webflowmaster', migrationsApplied: 59, rlsTables: 44, counts: { organizations: 2, tests: 10 } };
const manifest = (overrides: Partial<Manifest> = {}): Manifest => ({
  format: MANIFEST_FORMAT, createdAt: '2026-10-01T00:00:00Z', productVersion: '1.0.0', database,
  artifactStore: 'local', encryptionKeyFingerprint: keyFingerprint('a'.repeat(64)), files: [], ...overrides,
});

describe('parseArgs', () => {
  it('reads a restore with its directory, Compose project and files', () => {
    const o = parseArgs(['restore', 'backups/x', '-p', 'wfm-collaudo', '-f', 'a.yml', '-f', 'b.yml', '--yes']);
    expect(o).toMatchObject({ command: 'restore', dir: 'backups/x', project: 'wfm-collaudo', composeFiles: ['a.yml', 'b.yml'], yes: true });
  });

  it('needs a directory to verify or restore, but not to create', () => {
    expect(parseArgs(['verify'])).toEqual({ error: 'verify needs the backup directory.' });
    expect(parseArgs(['create'])).toMatchObject({ command: 'create', out: 'backups' });
  });

  it('refuses a database name that would have to be quoted into SQL', () => {
    expect(parseArgs(['create', '--db-name', 'x"; DROP'])).toHaveProperty('error');
  });

  it('refuses unknown commands and options in words', () => {
    expect(parseArgs(['backup'])).toEqual({ error: 'Unknown command "backup".' });
    expect(parseArgs(['create', '--force'])).toEqual({ error: 'Unknown option "--force".' });
    expect(parseArgs(['create', '--out'])).toEqual({ error: '--out needs a value.' });
  });
});

describe('keyFingerprint', () => {
  it('fingerprints the key server/crypto.ts derives, not the string', () => {
    const hex = 'ab'.repeat(32);
    const expected = createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex').slice(0, 16);
    expect(keyFingerprint(hex)).toBe(expected);
    // A passphrase is hashed to 32 bytes first, as crypto.ts does.
    const derived = createHash('sha256').update('a passphrase').digest();
    expect(keyFingerprint('a passphrase')).toBe(createHash('sha256').update(derived).digest('hex').slice(0, 16));
  });

  it('ignores the newline printenv adds, and has nothing for an empty key', () => {
    expect(keyFingerprint('ab'.repeat(32) + '\n')).toBe(keyFingerprint('ab'.repeat(32)));
    expect(keyFingerprint('')).toBeNull();
    expect(keyFingerprint(undefined)).toBeNull();
  });

  it('never contains the key', () => {
    const key = 'cd'.repeat(32);
    expect(key).not.toContain(keyFingerprint(key)!);
    expect(EXAMPLE_KEY_FINGERPRINT).toHaveLength(16);
  });
});

describe('row counts', () => {
  it('asks for every counted table and reads psql\'s unaligned output', () => {
    for (const t of COUNTED_TABLES) expect(countsQuery()).toContain(`FROM "${t}"`);
    expect(parseCounts('organizations|2\r\ntests|10\n\n')).toEqual({ organizations: 2, tests: 10 });
  });
});

describe('compareRestore', () => {
  const good = { migrationsApplied: 59, rlsTables: 44, counts: { organizations: 2, tests: 10 }, appUserCanRead: true };

  it('finds nothing when the restore matches the backup', () => {
    expect(compareRestore(database, good)).toEqual([]);
  });

  it('names every difference, the security ones in terms of what they break', () => {
    const problems = compareRestore(database, { migrationsApplied: 58, rlsTables: 0, counts: { organizations: 2 }, appUserCanRead: false });
    expect(problems).toEqual([
      'tests: 10 rows backed up, none restored.',
      'Migrations: 59 applied when backed up, 58 in the restore.',
      'Row-level security: on 44 tables when backed up, 0 in the restore — organizations would not be isolated.',
      'The app_user role has no grants in the restore: every request would fail.',
    ]);
  });
});

describe('restoreRefusal', () => {
  const live = { keyFingerprint: keyFingerprint('a'.repeat(64)), migrationsKnown: 59 };

  it('lets a backup taken with the same key and an older or equal schema through', () => {
    expect(restoreRefusal(manifest(), live, false)).toBeNull();
    expect(restoreRefusal(manifest(), { ...live, migrationsKnown: 61 }, false)).toBeNull();
  });

  it('refuses a different encryption key unless told to go ahead', () => {
    const other = { ...live, keyFingerprint: keyFingerprint('b'.repeat(64)) };
    expect(restoreRefusal(manifest(), other, false)).toMatch(/different ENCRYPTION_KEY/);
    expect(restoreRefusal(manifest(), other, true)).toBeNull();
  });

  it('refuses a backup from a newer version than the code', () => {
    expect(restoreRefusal(manifest(), { ...live, migrationsKnown: 58 }, false)).toMatch(/newer version \(59 migrations; this code has 58\)/);
  });

  it('refuses a manifest format it does not know', () => {
    expect(restoreRefusal(manifest({ format: 2 as never }), live, false)).toMatch(/format 2/);
  });
});

describe('files', () => {
  it('names the backup after the UTC time it was taken', () => {
    expect(backupDirName(new Date('2026-10-01T07:05:09Z'))).toBe('wfm-backup-20261001-070509');
  });

  it('reports a missing file and one whose content changed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-backup-'));
    fs.writeFileSync(path.join(dir, 'database.dump'), 'dump');
    const sha = createHash('sha256').update('dump').digest('hex');
    expect(await checkFiles(dir, [{ name: 'database.dump', bytes: 4, sha256: sha }])).toEqual([]);
    fs.writeFileSync(path.join(dir, 'database.dump'), 'dumq');
    expect(await checkFiles(dir, [
      { name: 'database.dump', bytes: 4, sha256: sha },
      { name: 'results.tar', bytes: 1, sha256: sha },
    ])).toEqual([
      'database.dump does not match its checksum: it changed or is damaged.',
      'results.tar is missing.',
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
