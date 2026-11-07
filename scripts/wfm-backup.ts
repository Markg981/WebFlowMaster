/**
 * Backing up an installation, checking that a backup can be restored, and restoring it.
 *
 * The operations guide listed what to back up — the database, the artifacts, the encryption key
 * kept apart — and left the doing to each operator. That is the part that goes wrong: a dump that
 * was never restored, a restore onto a server without the `app_user` role, a database brought back
 * with a different ENCRYPTION_KEY so that every saved secret is noise, discovered on the first run
 * that needs one. This tool does the three things in one way, for the Docker Compose installation
 * the repository ships:
 *
 *   create   database dump + artifact archives + a manifest (sizes, checksums, row counts, the
 *            number of applied migrations and a fingerprint of the encryption key — never the key)
 *   verify   checks the checksums, restores the dump into a scratch database next to the live one,
 *            compares the row counts and the security setup with the manifest, and drops it again.
 *            Touches nothing the installation uses: it is the restore drill, safe to schedule.
 *   restore  stops the web process and the workers, replaces the database and the artifacts with
 *            the backup's, applies newer migrations and starts them again. Refuses when the running
 *            installation has a different encryption key or knows fewer migrations than the backup.
 *
 * Everything runs through `docker compose`: pg_dump and pg_restore inside the postgres container,
 * tar inside the api container, so the operator's machine needs only Docker and Node.
 *
 * Exit codes: 0 done, 1 the check found a problem, 2 the command could not be carried out.
 */
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localDir } from './local-dir.mjs';

export const EXIT_OK = 0;
export const EXIT_CHECK_FAILED = 1;
export const EXIT_TOOL_ERROR = 2;

export const MANIFEST_FORMAT = 1;

/** Tables whose exact row count is recorded, and compared after a restore. */
export const COUNTED_TABLES = [
  'organizations',
  'users',
  'projects',
  'tests',
  'api_tests',
  'mobile_tests',
  'test_plans',
  'test_plan_schedules',
  'test_plan_executions',
  'report_test_case_results',
  'environments',
  'secrets',
  'api_keys',
  'audit_log',
  'test_versions',
] as const;

/** Where the api container keeps what the artifact store writes when it is local. */
export const ARTIFACT_DIRS = [
  { name: 'results', container: 'results', file: 'results.tar' },
  { name: 'visual-baselines', container: 'data/visual-baselines', file: 'visual-baselines.tar' },
] as const;

export interface BackupFile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  createdAt: string;
  productVersion: string | null;
  database: {
    name: string;
    migrationsApplied: number;
    rlsTables: number;
    counts: Record<string, number>;
  };
  artifactStore: 'local' | 's3';
  /** sha256 of the 32-byte key server/platform/crypto.ts derives, first 16 hex characters. */
  encryptionKeyFingerprint: string | null;
  /** present when the dump is encrypted (create --encrypt) */
  encryption?: EncryptionInfo;
  files: BackupFile[];
}

export interface Options {
  command: 'create' | 'verify' | 'restore' | 'help';
  dir?: string;
  out: string;
  project?: string;
  composeFiles: string[];
  dbName: string;
  dbUser: string;
  yes: boolean;
  ignoreKey: boolean;
  encrypt: boolean;
  inPlace: boolean;
  understand: boolean;
}

export function parseArgs(argv: string[]): Options | { error: string } {
  const [command, ...rest] = argv;
  const options: Options = {
    command: 'help',
    out: path.relative(process.cwd(), localDir('backups')) || '.',
    composeFiles: [],
    dbName: 'webflowmaster',
    dbUser: 'postgres',
    yes: false,
    ignoreKey: false,
    encrypt: false,
    inPlace: false,
    understand: false,
  };
  if (!command || command === 'help' || command === '--help' || command === '-h') return options;
  if (command !== 'create' && command !== 'verify' && command !== 'restore')
    return { error: `Unknown command "${command}".` };
  options.command = command;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = () => {
      const next = rest[++i];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value.`);
      return next;
    };
    try {
      if (arg === '--out') options.out = value();
      else if (arg === '--project' || arg === '-p') options.project = value();
      else if (arg === '--file' || arg === '-f') options.composeFiles.push(value());
      else if (arg === '--db-name') options.dbName = value();
      else if (arg === '--db-user') options.dbUser = value();
      else if (arg === '--yes') options.yes = true;
      else if (arg === '--ignore-key') options.ignoreKey = true;
      else if (arg === '--encrypt') options.encrypt = true;
      else if (arg === '--in-place') options.inPlace = true;
      else if (arg === '--i-understand') options.understand = true;
      else if (!arg.startsWith('-') && !options.dir) options.dir = arg;
      else return { error: `Unknown option "${arg}".` };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }
  if (options.command !== 'create' && !options.dir)
    return { error: `${options.command} needs the backup directory.` };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.dbName))
    return { error: 'The database name may contain only letters, digits and underscores.' };
  if (options.inPlace && !options.understand)
    return { error: '--in-place drops the live database first: add --i-understand to confirm.' };
  if (options.encrypt && options.command !== 'create')
    return { error: '--encrypt applies to create only; restore reads the manifest.' };
  return options;
}

/** The same 32 bytes server/platform/crypto.ts derives from ENCRYPTION_KEY, fingerprinted. */
export function keyFingerprint(keyString: string | null | undefined): string | null {
  const key = keyString?.trim();
  if (!key) return null;
  const bytes =
    key.length === 64 && /^[0-9a-fA-F]+$/.test(key)
      ? Buffer.from(key, 'hex')
      : createHash('sha256').update(key).digest();
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/** The all-zero key docker-compose.yml shipped before it required one; production now refuses it. */
export const EXAMPLE_KEY_FINGERPRINT = keyFingerprint('0'.repeat(64));

/** `organizations|3` lines from psql into counts. */
export function parseCounts(output: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of output.split(/\r?\n/)) {
    const [table, n] = line.trim().split('|');
    if (table && n !== undefined && /^\d+$/.test(n)) counts[table] = Number(n);
  }
  return counts;
}

export function countsQuery(): string {
  return COUNTED_TABLES.map((t) => `SELECT '${t}', count(*) FROM "${t}"`).join(' UNION ALL ') + ';';
}

/** Differences between what was backed up and what a restore produced, as sentences. */
export function compareRestore(
  expected: Manifest['database'],
  actual: {
    migrationsApplied: number;
    rlsTables: number;
    counts: Record<string, number>;
    appUserCanRead: boolean;
  },
): string[] {
  const problems: string[] = [];
  for (const [table, n] of Object.entries(expected.counts)) {
    if (actual.counts[table] !== n)
      problems.push(`${table}: ${n} rows backed up, ${actual.counts[table] ?? 'none'} restored.`);
  }
  if (actual.migrationsApplied !== expected.migrationsApplied) {
    problems.push(
      `Migrations: ${expected.migrationsApplied} applied when backed up, ${actual.migrationsApplied} in the restore.`,
    );
  }
  if (actual.rlsTables !== expected.rlsTables) {
    problems.push(
      `Row-level security: on ${expected.rlsTables} tables when backed up, ${actual.rlsTables} in the restore — organizations would not be isolated.`,
    );
  }
  if (!actual.appUserCanRead)
    problems.push('The app_user role has no grants in the restore: every request would fail.');
  return problems;
}

/** Why a restore must not go ahead, or null. */
export function restoreRefusal(
  manifest: Manifest,
  live: { keyFingerprint: string | null; migrationsKnown: number },
  ignoreKey: boolean,
): string | null {
  if (manifest.format !== MANIFEST_FORMAT)
    return `This backup has format ${manifest.format}; this tool reads format ${MANIFEST_FORMAT}.`;
  if (manifest.database.migrationsApplied > live.migrationsKnown) {
    return `The backup comes from a newer version (${manifest.database.migrationsApplied} migrations; this code has ${live.migrationsKnown}). Restore it with the version it was taken from.`;
  }
  if (
    !ignoreKey &&
    manifest.encryptionKeyFingerprint &&
    live.keyFingerprint !== manifest.encryptionKeyFingerprint
  ) {
    return (
      'The running installation has a different ENCRYPTION_KEY from the one this backup was taken with: ' +
      'its saved secrets, tokens and login states would be unreadable. Start it with the original key, ' +
      'or pass --ignore-key to restore anyway and enter the secrets again.'
    );
  }
  return null;
}

export function backupDirName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `wfm-backup-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

export function readManifest(dir: string): Manifest {
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file))
    throw new Error(`No manifest.json in ${dir}: not a backup made by this tool.`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
}

/** Files that are missing or no longer match their checksum. */
export async function checkFiles(dir: string, files: BackupFile[]): Promise<string[]> {
  const problems: string[] = [];
  for (const file of files) {
    const full = path.join(dir, file.name);
    if (!fs.existsSync(full)) {
      problems.push(`${file.name} is missing.`);
      continue;
    }
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(full)
        .on('data', (c) => hash.update(c))
        .on('end', resolve)
        .on('error', reject);
    });
    if (hash.digest('hex') !== file.sha256)
      problems.push(`${file.name} does not match its checksum: it changed or is damaged.`);
  }
  return problems;
}

/* ---- encryption at rest ---- */

export const DUMP_NAME = 'database.dump';
export const DUMP_ENCRYPTED_NAME = 'database.dump.enc';
const GCM_TAG_BYTES = 16;

export interface EncryptionInfo {
  cipher: 'aes-256-gcm';
  kdf: 'raw' | 'scrypt';
  /** hex; present when kdf is scrypt */
  salt?: string;
  /** hex, 12 bytes */
  iv: string;
  /** sha256 of the plaintext dump, so a restore can check it after decrypting */
  plaintextSha256: string;
  /** the file holding the dump: ciphertext followed by the 16-byte GCM tag */
  file: string;
}

/**
 * The 32-byte key from BACKUP_ENCRYPTION_KEY (64 hex characters or base64 of 32 bytes), or derived
 * with scrypt from BACKUP_PASSPHRASE. Throws a message that never contains the secret.
 */
export function resolveBackupKey(
  env: Record<string, string | undefined>,
  salt?: Buffer,
): { key: Buffer; kdf: 'raw' | 'scrypt'; salt?: Buffer } {
  const raw = env.BACKUP_ENCRYPTION_KEY?.trim();
  if (raw) {
    const key = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
    if (key.length !== 32)
      throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or base64.');
    return { key, kdf: 'raw' };
  }
  const pass = env.BACKUP_PASSPHRASE;
  if (pass) {
    const s = salt ?? randomBytes(16);
    return { key: scryptSync(pass, s, 32), kdf: 'scrypt', salt: s };
  }
  throw new Error('Set BACKUP_ENCRYPTION_KEY (32 bytes, hex or base64) or BACKUP_PASSPHRASE.');
}

function endStream(out: fs.WriteStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    out.once('error', reject);
    out.end(() => resolve());
  });
}

/** Encrypts `input` into `output` (ciphertext + tag); returns what the manifest records. */
export async function encryptFile(
  input: string,
  output: string,
  env: Record<string, string | undefined>,
): Promise<EncryptionInfo> {
  const { key, kdf, salt } = resolveBackupKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = createHash('sha256');
  const out = fs.createWriteStream(output, { mode: 0o600 });
  for await (const chunk of fs.createReadStream(input) as AsyncIterable<Buffer>) {
    plain.update(chunk);
    if (!out.write(cipher.update(chunk))) await new Promise((r) => out.once('drain', r));
  }
  out.write(cipher.final());
  out.write(cipher.getAuthTag());
  await endStream(out);
  return {
    cipher: 'aes-256-gcm',
    kdf,
    ...(salt ? { salt: salt.toString('hex') } : {}),
    iv: iv.toString('hex'),
    plaintextSha256: plain.digest('hex'),
    file: path.basename(output),
  };
}

/** Decrypts into `output`, checking the GCM tag and the plaintext checksum. Throws on any mismatch. */
export async function decryptFile(
  input: string,
  output: string,
  info: EncryptionInfo,
  env: Record<string, string | undefined>,
): Promise<void> {
  if (info.cipher !== 'aes-256-gcm') throw new Error(`Unknown cipher "${info.cipher}".`);
  const size = fs.statSync(input).size;
  if (size < GCM_TAG_BYTES) throw new Error('The encrypted dump is truncated.');
  const fd = fs.openSync(input, 'r');
  const tag = Buffer.alloc(GCM_TAG_BYTES);
  fs.readSync(fd, tag, 0, GCM_TAG_BYTES, size - GCM_TAG_BYTES);
  fs.closeSync(fd);
  const { key } = resolveBackupKey(env, info.salt ? Buffer.from(info.salt, 'hex') : undefined);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(info.iv, 'hex'));
  decipher.setAuthTag(tag);
  const plain = createHash('sha256');
  const out = fs.createWriteStream(output, { mode: 0o600 });
  try {
    if (size > GCM_TAG_BYTES) {
      const body = fs.createReadStream(input, { start: 0, end: size - GCM_TAG_BYTES - 1 });
      for await (const chunk of body as AsyncIterable<Buffer>) {
        const p = decipher.update(chunk);
        plain.update(p);
        if (!out.write(p)) await new Promise((r) => out.once('drain', r));
      }
    }
    const last = decipher.final();
    plain.update(last);
    out.write(last);
  } catch {
    out.on('error', () => undefined);
    out.destroy();
    fs.rmSync(output, { force: true });
    throw new Error(
      'Could not decrypt the dump: wrong key or passphrase, or the file was altered.',
    );
  }
  await endStream(out);
  if (plain.digest('hex') !== info.plaintextSha256) {
    fs.rmSync(output, { force: true });
    throw new Error('The decrypted dump does not match the checksum in the manifest.');
  }
}

/* ---- safe restore: temporary database, verify, then swap ---- */

export interface RestoreDriver {
  /** All of these run against the server's maintenance database. */
  createDatabase(name: string): Promise<void>;
  dropDatabase(name: string): Promise<void>;
  terminateConnections(name: string): Promise<void>;
  renameDatabase(from: string, to: string): Promise<void>;
  ensureAppUser(): Promise<void>;
  /** pg_restore of the dump into `name`; rejects on a non-zero exit. */
  loadDump(name: string): Promise<void>;
  facts(name: string): Promise<{
    migrationsApplied: number;
    rlsTables: number;
    counts: Record<string, number>;
    appUserCanRead: boolean;
  }>;
  /** Stop the web process and the workers; called once, after verification and before the swap. */
  stopServices(): Promise<void>;
}

export function restoreStamp(now: Date): string {
  return backupDirName(now).replace('wfm-backup-', '');
}

export interface SafeRestoreResult {
  ok: boolean;
  problems: string[];
  previousDatabase?: string;
}

/**
 * Restores into `<db>_restore_<stamp>`, verifies it against the manifest and only then touches the
 * live database: stop services, terminate connections, rename live to `<db>_prev_<stamp>`, rename
 * the temporary one to `<db>`. The live database is never dropped. A failed verification drops the
 * temporary database and leaves everything else untouched.
 */
export async function safeRestoreDatabase(
  driver: RestoreDriver,
  opts: { dbName: string; manifest: Manifest; now: Date },
  log: (s: string) => void,
): Promise<SafeRestoreResult> {
  const stamp = restoreStamp(opts.now);
  const temp = `${opts.dbName}_restore_${stamp}`;
  const prev = `${opts.dbName}_prev_${stamp}`;
  log(`Restoring into the temporary database "${temp}" (the live one is not touched yet)...`);
  await driver.createDatabase(temp);
  try {
    await driver.ensureAppUser();
    await driver.loadDump(temp);
    const problems = compareRestore(opts.manifest.database, await driver.facts(temp));
    if (problems.length) {
      await driver.dropDatabase(temp);
      return { ok: false, problems };
    }
  } catch (error) {
    await driver.dropDatabase(temp).catch(() => undefined);
    throw error;
  }
  log('Verified: the dump is readable and matches the manifest. Swapping databases...');
  await driver.stopServices();
  await driver.terminateConnections(opts.dbName);
  await driver.terminateConnections(temp);
  await driver.renameDatabase(opts.dbName, prev);
  try {
    await driver.renameDatabase(temp, opts.dbName);
  } catch (error) {
    await driver.renameDatabase(prev, opts.dbName);
    throw error;
  }
  return { ok: true, problems: [], previousDatabase: prev };
}

/** Warning printed when artifacts live in S3, which the backup does not contain. */
export const S3_WARNING =
  'WARNING: ARTIFACT_STORE is s3. Screenshots, videos, traces and reports in the bucket are NOT in ' +
  'this backup. Enable bucket versioning or cross-region replication to protect them. ' +
  '--include-s3 is not implemented by this tool (no S3 client runs outside the api container).';

/** sha256 and size of a file. */
export async function checkFilesHash(file: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const c of fs.createReadStream(file) as AsyncIterable<Buffer>) {
    hash.update(c);
    bytes += c.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

/** Path of a readable plain dump: the dump itself, or a decrypted temporary copy. */
export async function preparePlainDump(
  dir: string,
  manifest: Manifest,
  env: Record<string, string | undefined>,
): Promise<{ file: string; cleanup: () => void }> {
  if (!manifest.encryption) return { file: path.join(dir, DUMP_NAME), cleanup: () => undefined };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-restore-'));
  const file = path.join(tmpDir, DUMP_NAME);
  const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });
  try {
    await decryptFile(path.join(dir, manifest.encryption.file), file, manifest.encryption, env);
  } catch (error) {
    cleanup();
    throw error;
  }
  return { file, cleanup };
}

/* c8 ignore start — the rest drives Docker, and is exercised against a real stack */

class Compose {
  constructor(private readonly options: Options) {}

  private args(rest: string[]): string[] {
    const base = ['compose'];
    if (this.options.project) base.push('-p', this.options.project);
    for (const f of this.options.composeFiles) base.push('-f', f);
    return [...base, ...rest];
  }

  /** Runs and returns stdout; stdin and stdout can be files. */
  run(
    rest: string[],
    io: { stdinFile?: string; stdoutFile?: string; allowFail?: boolean } = {},
  ): Promise<{ code: number; out: string; err: string; sha256?: string; bytes?: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', this.args(rest), { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      let bytes = 0;
      const hash = createHash('sha256');
      const sink = io.stdoutFile ? fs.createWriteStream(io.stdoutFile) : null;
      child.stdout.on('data', (chunk: Buffer) => {
        if (sink) {
          sink.write(chunk);
          hash.update(chunk);
          bytes += chunk.length;
        } else out += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        err += chunk.toString();
      });
      if (io.stdinFile) fs.createReadStream(io.stdinFile).pipe(child.stdin);
      else child.stdin.end();
      child.on('error', (e) => reject(new Error(`Could not run docker: ${e.message}`)));
      child.on('close', (code) => {
        const done = () => {
          const result = {
            code: code ?? 1,
            out,
            err,
            ...(sink ? { sha256: hash.digest('hex'), bytes } : {}),
          };
          if (result.code !== 0 && !io.allowFail)
            reject(
              new Error(
                `docker ${rest.slice(0, 3).join(' ')} failed: ${err.trim() || `exit ${code}`}`,
              ),
            );
          else resolve(result);
        };
        if (sink) sink.end(done);
        else done();
      });
    });
  }

  psql(db: string, sqlText: string, allowFail = false) {
    return this.run(
      [
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        this.options.dbUser,
        '-d',
        db,
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
        '-c',
        sqlText,
      ],
      { allowFail },
    );
  }
}

async function databaseFacts(compose: Compose, db: string) {
  const counts = parseCounts((await compose.psql(db, countsQuery())).out);
  const migrations = Number(
    (await compose.psql(db, 'SELECT count(*) FROM "drizzle"."__drizzle_migrations";')).out.trim(),
  );
  const rls = Number(
    (
      await compose.psql(
        db,
        "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;",
      )
    ).out.trim(),
  );
  const grant = (
    await compose.psql(
      db,
      "SELECT has_table_privilege('app_user', 'public.tests', 'SELECT');",
      true,
    )
  ).out.trim();
  return { counts, migrationsApplied: migrations, rlsTables: rls, appUserCanRead: grant === 't' };
}

async function liveKeyFingerprint(compose: Compose): Promise<string | null> {
  const result = await compose.run(['exec', '-T', 'api', 'printenv', 'ENCRYPTION_KEY'], {
    allowFail: true,
  });
  return result.code === 0 ? keyFingerprint(result.out) : null;
}

async function artifactStoreKind(compose: Compose): Promise<'local' | 's3'> {
  const result = await compose.run(['exec', '-T', 'api', 'printenv', 'ARTIFACT_STORE'], {
    allowFail: true,
  });
  return result.out.trim() === 's3' ? 's3' : 'local';
}

function migrationsKnownByThisCode(): number {
  const journal = path.resolve('migrations', 'meta', '_journal.json');
  return (JSON.parse(fs.readFileSync(journal, 'utf8')).entries as unknown[]).length;
}

function productVersion(): string | null {
  try {
    return JSON.parse(fs.readFileSync('package.json', 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

async function create(options: Options, log: (s: string) => void): Promise<number> {
  const compose = new Compose(options);
  const dir = path.resolve(options.out, backupDirName(new Date()));
  fs.mkdirSync(dir, { recursive: true });
  log(`Backing up into ${dir}`);

  const files: BackupFile[] = [];
  const facts = await databaseFacts(compose, options.dbName);
  const dump = await compose.run(
    [
      'exec',
      '-T',
      'postgres',
      'pg_dump',
      '-U',
      options.dbUser,
      '-d',
      options.dbName,
      '--format=custom',
      '--no-owner',
    ],
    { stdoutFile: path.join(dir, DUMP_NAME) },
  );
  let encryption: EncryptionInfo | undefined;
  if (options.encrypt) {
    // Fail on a missing key before the dump is written, then replace the clear file.
    resolveBackupKey(process.env);
    const encPath = path.join(dir, DUMP_ENCRYPTED_NAME);
    encryption = await encryptFile(path.join(dir, DUMP_NAME), encPath, process.env);
    fs.rmSync(path.join(dir, DUMP_NAME), { force: true });
    const enc = await checkFilesHash(encPath);
    files.push({ name: DUMP_ENCRYPTED_NAME, bytes: enc.bytes, sha256: enc.sha256 });
  } else {
    files.push({ name: DUMP_NAME, bytes: dump.bytes!, sha256: dump.sha256! });
    log(
      '  WARNING       the dump is stored in clear: use --encrypt (BACKUP_ENCRYPTION_KEY) for a backup at rest.',
    );
  }
  log(
    `  database          ${(dump.bytes! / 1e6).toFixed(1)} MB, ${facts.migrationsApplied} migrations, ${facts.counts.organizations ?? 0} organizations, ${facts.counts.test_plan_executions ?? 0} runs`,
  );

  const store = await artifactStoreKind(compose);
  if (store === 'local') {
    for (const a of ARTIFACT_DIRS) {
      const tar = await compose.run(
        [
          'exec',
          '-T',
          'api',
          'sh',
          '-c',
          `mkdir -p /app/${a.container} && tar -C /app -cf - ${a.container}`,
        ],
        { stdoutFile: path.join(dir, a.file) },
      );
      files.push({ name: a.file, bytes: tar.bytes!, sha256: tar.sha256! });
      log(`  ${a.name.padEnd(17)} ${(tar.bytes! / 1e6).toFixed(1)} MB`);
    }
  } else {
    log(`  ${S3_WARNING}`);
  }

  const fingerprint = await liveKeyFingerprint(compose);
  const manifest: Manifest = {
    format: MANIFEST_FORMAT,
    createdAt: new Date().toISOString(),
    productVersion: productVersion(),
    database: {
      name: options.dbName,
      migrationsApplied: facts.migrationsApplied,
      rlsTables: facts.rlsTables,
      counts: facts.counts,
    },
    artifactStore: store,
    encryptionKeyFingerprint: fingerprint,
    ...(encryption ? { encryption } : {}),
    files,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  log('  manifest.json written.');
  log('');
  log(
    'Keep ENCRYPTION_KEY in your secret manager, apart from this backup: it is not in it, and without it',
  );
  log('the saved secrets cannot be read back.');
  if (fingerprint && fingerprint === EXAMPLE_KEY_FINGERPRINT)
    log('WARNING: this installation uses the example ENCRYPTION_KEY of docker-compose.yml.');
  if (!fingerprint)
    log(
      'WARNING: could not read ENCRYPTION_KEY from the api container; a restore will not be able to check it.',
    );
  log(
    `Next: npm run backup:verify -- ${path.relative(process.cwd(), dir).startsWith('..') ? dir : path.relative(process.cwd(), dir)}`,
  );
  return EXIT_OK;
}

async function verify(options: Options, log: (s: string) => void): Promise<number> {
  const dir = path.resolve(options.dir!);
  const manifest = readManifest(dir);
  const compose = new Compose(options);
  log(`Verifying ${dir} (taken ${manifest.createdAt})`);

  const fileProblems = await checkFiles(dir, manifest.files);
  if (fileProblems.length) {
    fileProblems.forEach((p) => log(`  FAIL ${p}`));
    return EXIT_CHECK_FAILED;
  }
  log(`  checksums     ${manifest.files.length} files match`);

  const plain = await preparePlainDump(dir, manifest, process.env);
  const scratch = `${options.dbName}_restore_check`;
  await compose.psql('postgres', `DROP DATABASE IF EXISTS "${scratch}";`);
  await compose.psql('postgres', `CREATE DATABASE "${scratch}";`);
  try {
    await ensureAppUser(compose);
    await compose.run(
      [
        'exec',
        '-T',
        'postgres',
        'pg_restore',
        '-U',
        options.dbUser,
        '-d',
        scratch,
        '--no-owner',
        '--exit-on-error',
      ],
      { stdinFile: plain.file },
    );
    const problems = compareRestore(manifest.database, await databaseFacts(compose, scratch));
    if (problems.length) {
      problems.forEach((p) => log(`  FAIL ${p}`));
      return EXIT_CHECK_FAILED;
    }
    log(
      `  database      restored into "${scratch}": row counts, ${manifest.database.migrationsApplied} migrations, row-level security on ${manifest.database.rlsTables} tables and app_user grants all match`,
    );
  } finally {
    plain.cleanup();
    await compose.psql('postgres', `DROP DATABASE IF EXISTS "${scratch}";`, true);
  }

  const live = await liveKeyFingerprint(compose);
  if (manifest.encryptionKeyFingerprint && live && live !== manifest.encryptionKeyFingerprint) {
    log(
      "  NOTE          the running installation has a different ENCRYPTION_KEY from this backup's.",
    );
  } else if (manifest.encryptionKeyFingerprint && live) {
    log("  key           the running installation's ENCRYPTION_KEY is the backup's");
  }
  log('Restorable.');
  return EXIT_OK;
}

async function ensureAppUser(compose: Compose) {
  await compose.psql(
    'postgres',
    "DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user NOLOGIN; END IF; END$$;",
  );
}

async function restore(options: Options, log: (s: string) => void): Promise<number> {
  const dir = path.resolve(options.dir!);
  const manifest = readManifest(dir);
  const compose = new Compose(options);

  const fileProblems = await checkFiles(dir, manifest.files);
  if (fileProblems.length) {
    fileProblems.forEach((p) => log(`FAIL ${p}`));
    return EXIT_CHECK_FAILED;
  }

  let previous: string | undefined;
  const refusal = restoreRefusal(
    manifest,
    {
      keyFingerprint: await liveKeyFingerprint(compose),
      migrationsKnown: migrationsKnownByThisCode(),
    },
    options.ignoreKey,
  );
  if (refusal) {
    log(refusal);
    return EXIT_CHECK_FAILED;
  }

  if (!options.yes) {
    log(
      `This replaces the database "${options.dbName}" and the artifacts with the backup of ${manifest.createdAt}.`,
    );
    log(
      'The database is restored aside, verified and swapped in; the old one is kept as <name>_prev_<time>.',
    );
    log('Artifacts written since are lost. Run again with --yes to go ahead.');
    return EXIT_TOOL_ERROR;
  }

  const plain = await preparePlainDump(dir, manifest, process.env);
  const pgRestore = (db: string) =>
    compose.run(
      [
        'exec',
        '-T',
        'postgres',
        'pg_restore',
        '-U',
        options.dbUser,
        '-d',
        db,
        '--no-owner',
        '--exit-on-error',
      ],
      { stdinFile: plain.file },
    );
  const stopServices = async () => {
    log('Stopping the web process and the workers...');
    await compose.run(['stop', 'api', 'worker']);
  };
  const terminate = (db: string) =>
    compose
      .psql(
        'postgres',
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid();`,
      )
      .then(() => undefined);

  try {
    if (options.inPlace) {
      log(
        'WARNING: --in-place drops the live database BEFORE the dump is restored. If the restore fails, the data is gone.',
      );
      await stopServices();
      await terminate(options.dbName);
      await compose.psql('postgres', `DROP DATABASE IF EXISTS "${options.dbName}";`);
      await compose.psql('postgres', `CREATE DATABASE "${options.dbName}";`);
      await ensureAppUser(compose);
      await pgRestore(options.dbName);
    } else {
      const result = await safeRestoreDatabase(
        {
          createDatabase: (n) =>
            compose.psql('postgres', `CREATE DATABASE "${n}";`).then(() => undefined),
          dropDatabase: (n) =>
            compose.psql('postgres', `DROP DATABASE IF EXISTS "${n}";`).then(() => undefined),
          terminateConnections: terminate,
          renameDatabase: (from, to) =>
            compose
              .psql('postgres', `ALTER DATABASE "${from}" RENAME TO "${to}";`)
              .then(() => undefined),
          ensureAppUser: () => ensureAppUser(compose),
          loadDump: (n) => pgRestore(n).then(() => undefined),
          facts: (n) => databaseFacts(compose, n),
          stopServices,
        },
        { dbName: options.dbName, manifest, now: new Date() },
        log,
      );
      if (!result.ok) {
        result.problems.forEach((p) => log(`FAIL ${p}`));
        log('The live database was not touched; the temporary database was dropped.');
        return EXIT_CHECK_FAILED;
      }
      previous = result.previousDatabase;
    }
  } finally {
    plain.cleanup();
  }

  for (const a of ARTIFACT_DIRS) {
    if (!manifest.files.some((f) => f.name === a.file)) continue;
    log(`Restoring ${a.name}...`);
    await compose.run(
      [
        'run',
        '--rm',
        '--no-deps',
        '-T',
        '--entrypoint',
        'sh',
        'api',
        '-c',
        `mkdir -p /app/${a.container} && find /app/${a.container} -mindepth 1 -delete && tar -C /app -xf -`,
      ],
      { stdinFile: path.join(dir, a.file) },
    );
  }

  log('Applying newer migrations, if any...');
  await compose.run(['run', '--rm', '-T', 'migrate']);
  log('Starting the web process and the workers...');
  await compose.run(['up', '-d', 'api', 'worker']);

  const problems = compareRestore(
    manifest.database,
    await databaseFacts(compose, options.dbName),
  ).filter(
    (p) =>
      !p.startsWith('Migrations:') ||
      manifest.database.migrationsApplied === migrationsKnownByThisCode(),
  );
  if (problems.length) {
    problems.forEach((p) => log(`FAIL ${p}`));
    return EXIT_CHECK_FAILED;
  }
  if (previous) {
    log(`The previous database is kept as "${previous}". Once you are satisfied, delete it with:`);
    log(
      `  docker compose exec postgres psql -U ${options.dbUser} -d postgres -c 'DROP DATABASE "${previous}";'`,
    );
  }
  log('Restored. Sessions in Redis still name the old users: people may have to sign in again.');
  log(
    'Runs that were queued when the backup was taken stay queued: cancel them and start them again.',
  );
  return EXIT_OK;
}

const HELP = `wfm-backup — back up, verify and restore a WebFlowMaster Docker Compose installation

  npm run backup:create  -- [--out .local/backups] [--encrypt]   (key: BACKUP_ENCRYPTION_KEY hex/base64, or BACKUP_PASSPHRASE)
  npm run backup:verify  -- <backup-dir>
  npm run backup:restore -- <backup-dir> --yes [--ignore-key] [--in-place --i-understand]
    (restore decrypts with the same env var; --in-place skips the temporary database and drops the live one first)

Options (all commands):
  -p, --project <name>   the Compose project (as with docker compose -p)
  -f, --file <file>      a Compose file; repeat for several
  --db-name <name>       default webflowmaster
  --db-user <name>       default postgres

Exit codes: 0 done, 1 the check found a problem, 2 the command could not be carried out.`;

export async function main(argv: string[], log = (s: string) => console.log(s)): Promise<number> {
  const options = parseArgs(argv);
  if ('error' in options) {
    log(options.error);
    log('');
    log(HELP);
    return EXIT_TOOL_ERROR;
  }
  try {
    if (options.command === 'create') return await create(options, log);
    if (options.command === 'verify') return await verify(options, log);
    if (options.command === 'restore') return await restore(options, log);
    log(HELP);
    return EXIT_OK;
  } catch (error) {
    log(`Error: ${(error as Error).message}`);
    return EXIT_TOOL_ERROR;
  }
}

if (process.argv[1] && /wfm-backup(\.m?[tj]s)?$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
/* c8 ignore stop */
