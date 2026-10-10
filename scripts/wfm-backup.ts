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
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const EXIT_OK = 0;
export const EXIT_CHECK_FAILED = 1;
export const EXIT_TOOL_ERROR = 2;

export const MANIFEST_FORMAT = 1;

/** Tables whose exact row count is recorded, and compared after a restore. */
export const COUNTED_TABLES = [
  'organizations', 'users', 'projects', 'tests', 'api_tests', 'mobile_tests', 'test_plans',
  'test_plan_schedules', 'test_plan_executions', 'report_test_case_results', 'environments',
  'secrets', 'api_keys', 'audit_log', 'test_versions',
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
  database: { name: string; migrationsApplied: number; rlsTables: number; counts: Record<string, number> };
  artifactStore: 'local' | 's3';
  /** sha256 of the 32-byte key server/crypto.ts derives, first 16 hex characters. */
  encryptionKeyFingerprint: string | null;
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
}

export function parseArgs(argv: string[]): Options | { error: string } {
  const [command, ...rest] = argv;
  const options: Options = {
    command: 'help', out: 'backups', composeFiles: [], dbName: 'webflowmaster', dbUser: 'postgres',
    yes: false, ignoreKey: false,
  };
  if (!command || command === 'help' || command === '--help' || command === '-h') return options;
  if (command !== 'create' && command !== 'verify' && command !== 'restore') return { error: `Unknown command "${command}".` };
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
      else if (!arg.startsWith('-') && !options.dir) options.dir = arg;
      else return { error: `Unknown option "${arg}".` };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }
  if (options.command !== 'create' && !options.dir) return { error: `${options.command} needs the backup directory.` };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.dbName)) return { error: 'The database name may contain only letters, digits and underscores.' };
  return options;
}

/** The same 32 bytes server/crypto.ts derives from ENCRYPTION_KEY, fingerprinted. */
export function keyFingerprint(keyString: string | null | undefined): string | null {
  const key = keyString?.trim();
  if (!key) return null;
  const bytes = key.length === 64 && /^[0-9a-fA-F]+$/.test(key)
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
  actual: { migrationsApplied: number; rlsTables: number; counts: Record<string, number>; appUserCanRead: boolean },
): string[] {
  const problems: string[] = [];
  for (const [table, n] of Object.entries(expected.counts)) {
    if (actual.counts[table] !== n) problems.push(`${table}: ${n} rows backed up, ${actual.counts[table] ?? 'none'} restored.`);
  }
  if (actual.migrationsApplied !== expected.migrationsApplied) {
    problems.push(`Migrations: ${expected.migrationsApplied} applied when backed up, ${actual.migrationsApplied} in the restore.`);
  }
  if (actual.rlsTables !== expected.rlsTables) {
    problems.push(`Row-level security: on ${expected.rlsTables} tables when backed up, ${actual.rlsTables} in the restore — organizations would not be isolated.`);
  }
  if (!actual.appUserCanRead) problems.push('The app_user role has no grants in the restore: every request would fail.');
  return problems;
}

/** Why a restore must not go ahead, or null. */
export function restoreRefusal(
  manifest: Manifest,
  live: { keyFingerprint: string | null; migrationsKnown: number },
  ignoreKey: boolean,
): string | null {
  if (manifest.format !== MANIFEST_FORMAT) return `This backup has format ${manifest.format}; this tool reads format ${MANIFEST_FORMAT}.`;
  if (manifest.database.migrationsApplied > live.migrationsKnown) {
    return `The backup comes from a newer version (${manifest.database.migrationsApplied} migrations; this code has ${live.migrationsKnown}). Restore it with the version it was taken from.`;
  }
  if (!ignoreKey && manifest.encryptionKeyFingerprint && live.keyFingerprint !== manifest.encryptionKeyFingerprint) {
    return 'The running installation has a different ENCRYPTION_KEY from the one this backup was taken with: '
      + 'its saved secrets, tokens and login states would be unreadable. Start it with the original key, '
      + 'or pass --ignore-key to restore anyway and enter the secrets again.';
  }
  return null;
}

export function backupDirName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `wfm-backup-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

export function readManifest(dir: string): Manifest {
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error(`No manifest.json in ${dir}: not a backup made by this tool.`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
}

/** Files that are missing or no longer match their checksum. */
export async function checkFiles(dir: string, files: BackupFile[]): Promise<string[]> {
  const problems: string[] = [];
  for (const file of files) {
    const full = path.join(dir, file.name);
    if (!fs.existsSync(full)) { problems.push(`${file.name} is missing.`); continue; }
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(full).on('data', (c) => hash.update(c)).on('end', resolve).on('error', reject);
    });
    if (hash.digest('hex') !== file.sha256) problems.push(`${file.name} does not match its checksum: it changed or is damaged.`);
  }
  return problems;
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
  run(rest: string[], io: { stdinFile?: string; stdoutFile?: string; allowFail?: boolean } = {}): Promise<{ code: number; out: string; err: string; sha256?: string; bytes?: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', this.args(rest), { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      let bytes = 0;
      const hash = createHash('sha256');
      const sink = io.stdoutFile ? fs.createWriteStream(io.stdoutFile) : null;
      child.stdout.on('data', (chunk: Buffer) => {
        if (sink) { sink.write(chunk); hash.update(chunk); bytes += chunk.length; } else out += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });
      if (io.stdinFile) fs.createReadStream(io.stdinFile).pipe(child.stdin);
      else child.stdin.end();
      child.on('error', (e) => reject(new Error(`Could not run docker: ${e.message}`)));
      child.on('close', (code) => {
        const done = () => {
          const result = { code: code ?? 1, out, err, ...(sink ? { sha256: hash.digest('hex'), bytes } : {}) };
          if (result.code !== 0 && !io.allowFail) reject(new Error(`docker ${rest.slice(0, 3).join(' ')} failed: ${err.trim() || `exit ${code}`}`));
          else resolve(result);
        };
        if (sink) sink.end(done); else done();
      });
    });
  }

  psql(db: string, sqlText: string, allowFail = false) {
    return this.run(['exec', '-T', 'postgres', 'psql', '-U', this.options.dbUser, '-d', db, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sqlText], { allowFail });
  }
}

async function databaseFacts(compose: Compose, db: string) {
  const counts = parseCounts((await compose.psql(db, countsQuery())).out);
  const migrations = Number((await compose.psql(db, 'SELECT count(*) FROM "drizzle"."__drizzle_migrations";')).out.trim());
  const rls = Number((await compose.psql(db, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;")).out.trim());
  const grant = (await compose.psql(db, "SELECT has_table_privilege('app_user', 'public.tests', 'SELECT');", true)).out.trim();
  return { counts, migrationsApplied: migrations, rlsTables: rls, appUserCanRead: grant === 't' };
}

async function liveKeyFingerprint(compose: Compose): Promise<string | null> {
  const result = await compose.run(['exec', '-T', 'api', 'printenv', 'ENCRYPTION_KEY'], { allowFail: true });
  return result.code === 0 ? keyFingerprint(result.out) : null;
}

async function artifactStoreKind(compose: Compose): Promise<'local' | 's3'> {
  const result = await compose.run(['exec', '-T', 'api', 'printenv', 'ARTIFACT_STORE'], { allowFail: true });
  return result.out.trim() === 's3' ? 's3' : 'local';
}

function migrationsKnownByThisCode(): number {
  const journal = path.resolve('migrations', 'meta', '_journal.json');
  return (JSON.parse(fs.readFileSync(journal, 'utf8')).entries as unknown[]).length;
}

function productVersion(): string | null {
  try { return JSON.parse(fs.readFileSync('package.json', 'utf8')).version ?? null; } catch { return null; }
}

async function create(options: Options, log: (s: string) => void): Promise<number> {
  const compose = new Compose(options);
  const dir = path.resolve(options.out, backupDirName(new Date()));
  fs.mkdirSync(dir, { recursive: true });
  log(`Backing up into ${dir}`);

  const files: BackupFile[] = [];
  const facts = await databaseFacts(compose, options.dbName);
  const dump = await compose.run(
    ['exec', '-T', 'postgres', 'pg_dump', '-U', options.dbUser, '-d', options.dbName, '--format=custom', '--no-owner'],
    { stdoutFile: path.join(dir, 'database.dump') },
  );
  files.push({ name: 'database.dump', bytes: dump.bytes!, sha256: dump.sha256! });
  log(`  database          ${(dump.bytes! / 1e6).toFixed(1)} MB, ${facts.migrationsApplied} migrations, ${facts.counts.organizations ?? 0} organizations, ${facts.counts.test_plan_executions ?? 0} runs`);

  const store = await artifactStoreKind(compose);
  if (store === 'local') {
    for (const a of ARTIFACT_DIRS) {
      const tar = await compose.run(
        ['exec', '-T', 'api', 'sh', '-c', `mkdir -p /app/${a.container} && tar -C /app -cf - ${a.container}`],
        { stdoutFile: path.join(dir, a.file) },
      );
      files.push({ name: a.file, bytes: tar.bytes!, sha256: tar.sha256! });
      log(`  ${a.name.padEnd(17)} ${(tar.bytes! / 1e6).toFixed(1)} MB`);
    }
  } else {
    log('  artifacts     in the S3 bucket: back the bucket up with its own versioning or replication.');
  }

  const fingerprint = await liveKeyFingerprint(compose);
  const manifest: Manifest = {
    format: MANIFEST_FORMAT,
    createdAt: new Date().toISOString(),
    productVersion: productVersion(),
    database: { name: options.dbName, migrationsApplied: facts.migrationsApplied, rlsTables: facts.rlsTables, counts: facts.counts },
    artifactStore: store,
    encryptionKeyFingerprint: fingerprint,
    files,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  log('  manifest.json written.');
  log('');
  log('Keep ENCRYPTION_KEY in your secret manager, apart from this backup: it is not in it, and without it');
  log('the saved secrets cannot be read back.');
  if (fingerprint && fingerprint === EXAMPLE_KEY_FINGERPRINT) log('WARNING: this installation uses the example ENCRYPTION_KEY of docker-compose.yml.');
  if (!fingerprint) log('WARNING: could not read ENCRYPTION_KEY from the api container; a restore will not be able to check it.');
  log(`Next: npm run backup:verify -- ${path.relative(process.cwd(), dir).startsWith('..') ? dir : path.relative(process.cwd(), dir)}`);
  return EXIT_OK;
}

async function verify(options: Options, log: (s: string) => void): Promise<number> {
  const dir = path.resolve(options.dir!);
  const manifest = readManifest(dir);
  const compose = new Compose(options);
  log(`Verifying ${dir} (taken ${manifest.createdAt})`);

  const fileProblems = await checkFiles(dir, manifest.files);
  if (fileProblems.length) { fileProblems.forEach((p) => log(`  FAIL ${p}`)); return EXIT_CHECK_FAILED; }
  log(`  checksums     ${manifest.files.length} files match`);

  const scratch = `${options.dbName}_restore_check`;
  await compose.psql('postgres', `DROP DATABASE IF EXISTS "${scratch}";`);
  await compose.psql('postgres', `CREATE DATABASE "${scratch}";`);
  try {
    await ensureAppUser(compose);
    await compose.run(
      ['exec', '-T', 'postgres', 'pg_restore', '-U', options.dbUser, '-d', scratch, '--no-owner', '--exit-on-error'],
      { stdinFile: path.join(dir, 'database.dump') },
    );
    const problems = compareRestore(manifest.database, await databaseFacts(compose, scratch));
    if (problems.length) { problems.forEach((p) => log(`  FAIL ${p}`)); return EXIT_CHECK_FAILED; }
    log(`  database      restored into "${scratch}": row counts, ${manifest.database.migrationsApplied} migrations, row-level security on ${manifest.database.rlsTables} tables and app_user grants all match`);
  } finally {
    await compose.psql('postgres', `DROP DATABASE IF EXISTS "${scratch}";`, true);
  }

  const live = await liveKeyFingerprint(compose);
  if (manifest.encryptionKeyFingerprint && live && live !== manifest.encryptionKeyFingerprint) {
    log('  NOTE          the running installation has a different ENCRYPTION_KEY from this backup\'s.');
  } else if (manifest.encryptionKeyFingerprint && live) {
    log('  key           the running installation\'s ENCRYPTION_KEY is the backup\'s');
  }
  log('Restorable.');
  return EXIT_OK;
}

async function ensureAppUser(compose: Compose) {
  await compose.psql('postgres', "DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user NOLOGIN; END IF; END$$;");
}

async function restore(options: Options, log: (s: string) => void): Promise<number> {
  const dir = path.resolve(options.dir!);
  const manifest = readManifest(dir);
  const compose = new Compose(options);

  const fileProblems = await checkFiles(dir, manifest.files);
  if (fileProblems.length) { fileProblems.forEach((p) => log(`FAIL ${p}`)); return EXIT_CHECK_FAILED; }

  const refusal = restoreRefusal(manifest, { keyFingerprint: await liveKeyFingerprint(compose), migrationsKnown: migrationsKnownByThisCode() }, options.ignoreKey);
  if (refusal) { log(refusal); return EXIT_CHECK_FAILED; }

  if (!options.yes) {
    log(`This replaces the database "${options.dbName}" and the artifacts with the backup of ${manifest.createdAt}.`);
    log('Everything written since is lost. Run again with --yes to go ahead.');
    return EXIT_TOOL_ERROR;
  }

  log('Stopping the web process and the workers...');
  await compose.run(['stop', 'api', 'worker']);

  log(`Replacing the database "${options.dbName}"...`);
  await compose.psql('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${options.dbName}' AND pid <> pg_backend_pid();`);
  await compose.psql('postgres', `DROP DATABASE IF EXISTS "${options.dbName}";`);
  await compose.psql('postgres', `CREATE DATABASE "${options.dbName}";`);
  await ensureAppUser(compose);
  await compose.run(
    ['exec', '-T', 'postgres', 'pg_restore', '-U', options.dbUser, '-d', options.dbName, '--no-owner', '--exit-on-error'],
    { stdinFile: path.join(dir, 'database.dump') },
  );

  for (const a of ARTIFACT_DIRS) {
    if (!manifest.files.some((f) => f.name === a.file)) continue;
    log(`Restoring ${a.name}...`);
    await compose.run(
      ['run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh', 'api', '-c', `mkdir -p /app/${a.container} && find /app/${a.container} -mindepth 1 -delete && tar -C /app -xf -`],
      { stdinFile: path.join(dir, a.file) },
    );
  }

  log('Applying newer migrations, if any...');
  await compose.run(['run', '--rm', '-T', 'migrate']);
  log('Starting the web process and the workers...');
  await compose.run(['up', '-d', 'api', 'worker']);

  const problems = compareRestore(manifest.database, await databaseFacts(compose, options.dbName))
    .filter((p) => !p.startsWith('Migrations:') || manifest.database.migrationsApplied === migrationsKnownByThisCode());
  if (problems.length) { problems.forEach((p) => log(`FAIL ${p}`)); return EXIT_CHECK_FAILED; }
  log('Restored. Sessions in Redis still name the old users: people may have to sign in again.');
  log('Runs that were queued when the backup was taken stay queued: cancel them and start them again.');
  return EXIT_OK;
}

const HELP = `wfm-backup — back up, verify and restore a WebFlowMaster Docker Compose installation

  npm run backup:create  -- [--out backups]
  npm run backup:verify  -- <backup-dir>
  npm run backup:restore -- <backup-dir> --yes [--ignore-key]

Options (all commands):
  -p, --project <name>   the Compose project (as with docker compose -p)
  -f, --file <file>      a Compose file; repeat for several
  --db-name <name>       default webflowmaster
  --db-user <name>       default postgres

Exit codes: 0 done, 1 the check found a problem, 2 the command could not be carried out.`;

export async function main(argv: string[], log = (s: string) => console.log(s)): Promise<number> {
  const options = parseArgs(argv);
  if ('error' in options) { log(options.error); log(''); log(HELP); return EXIT_TOOL_ERROR; }
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
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
/* c8 ignore stop */
