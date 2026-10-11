/**
 * Rotating the encryption keys of an installation.
 *
 *   npm run key:rotate                          after changing ENCRYPTION_KEY (the old one in
 *                                               ENCRYPTION_KEY_PREVIOUS): re-wraps every
 *                                               organization key under the new master key and moves
 *                                               every value still encrypted directly with a master
 *                                               key (from before migration 0084) to its
 *                                               organization's key. Idempotent: a second run
 *                                               changes nothing and says so.
 *   npm run key:rotate -- --organization <id>   gives that organization a new key version,
 *                                               re-encrypts its values with it and retires the old
 *                                               version; with --prune, deletes retired versions
 *                                               nothing names any more.
 *   npm run key:rotate -- --dry-run             reports what would change, writes nothing.
 *
 * Run it on a machine with the installation's environment (DATABASE_URL, ENCRYPTION_KEY and,
 * during a master key change, ENCRYPTION_KEY_PREVIOUS), with the web process and the workers
 * either stopped or started with the same two variables: a process that only knows the new key
 * cannot read what the old one wrapped until this has run, and one that only knows the old key
 * cannot read what this writes.
 *
 * Exit codes: 0 done, 1 some value could not be read with the configured keys (everything else
 * was done; the report names each one), 2 the command could not be carried out.
 */
import { sql, type SQL } from 'drizzle-orm';
import { closeDb, privilegedDb } from '../server/db';
import {
  decryptSecret,
  encryptSecret,
  parseEnvelope,
  type EncryptedSecret,
} from '../server/crypto';
import { masterKeys } from '../server/master-keys';
import {
  activeDataKey,
  dataKey,
  deleteStoredKey,
  forgetCachedKeys,
  listStoredKeys,
  rewrapStoredKey,
  rotateOrganizationKey,
} from '../server/organization-keys';

export const EXIT_OK = 0;
export const EXIT_UNREADABLE = 1;
export const EXIT_TOOL_ERROR = 2;

/** Where an encrypted value lives: three text columns, or one jsonb column holding the three. */
export interface EncryptedColumn {
  table: string;
  /** The columns that identify a row. */
  key: string[];
  /** An SQL expression for the row's organization, in the table's own scope. */
  organization: string;
  /** The value column; for `json`, the jsonb column holding {encryptedValue, iv, authTag}. */
  value: string;
  iv?: string;
  tag?: string;
  json?: boolean;
}

const threeColumns = (
  table: string,
  value: string,
  iv: string,
  tag: string,
  key: string[] = ['id'],
  organization = 'organization_id',
): EncryptedColumn => ({ table, key, organization, value, iv, tag });

/**
 * Every encrypted column the schema has. scripts/wfm-rotate-key.test.ts checks this list against
 * shared/schema/, so a column added there without an entry here fails the suite rather than
 * staying under a retired key.
 */
export const ENCRYPTED_COLUMNS: readonly EncryptedColumn[] = [
  threeColumns('secrets', 'encrypted_value', 'iv', 'auth_tag'),
  threeColumns('environments', 'login_state', 'login_state_iv', 'login_state_auth_tag'),
  threeColumns('browser_grids', 'encrypted_key', 'key_iv', 'key_auth_tag'),
  threeColumns('source_hosts', 'encrypted_token', 'token_iv', 'token_auth_tag'),
  threeColumns('issue_trackers', 'encrypted_token', 'token_iv', 'token_auth_tag'),
  threeColumns('test_management_connections', 'encrypted_token', 'token_iv', 'token_auth_tag'),
  threeColumns(
    'organization_sso',
    'client_secret_encrypted',
    'client_secret_iv',
    'client_secret_auth_tag',
    ['organization_id'],
  ),
  threeColumns(
    'organization_sso',
    'saml_sp_private_key_encrypted',
    'saml_sp_private_key_iv',
    'saml_sp_private_key_auth_tag',
    ['organization_id'],
  ),
  // A second factor is a person's, and a person is in exactly one organization.
  threeColumns(
    'user_mfa',
    'secret_encrypted',
    'secret_iv',
    'secret_auth_tag',
    ['user_id'],
    '(SELECT organization_id FROM users WHERE users.id = user_mfa.user_id)',
  ),
  threeColumns(
    'user_mfa',
    'pending_secret_encrypted',
    'pending_secret_iv',
    'pending_secret_auth_tag',
    ['user_id'],
    '(SELECT organization_id FROM users WHERE users.id = user_mfa.user_id)',
  ),
  {
    table: 'organization_mail_settings',
    key: ['organization_id'],
    organization: 'organization_id',
    value: 'smtp_password',
    json: true,
  },
  {
    table: 'organization_mail_settings',
    key: ['organization_id'],
    organization: 'organization_id',
    value: 'signing_secret',
    json: true,
  },
];

export interface RotationOptions {
  /** Rotate this organization's key: a new version, its values re-encrypted, the old retired. */
  organizationId?: number;
  /** Delete retired key versions that no stored value names any more. */
  prune?: boolean;
  /** Report what would change; write nothing. */
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface RotationReport {
  masterKeyId: string;
  dryRun: boolean;
  /** Organization keys wrapped by a previous master key, now (or, dry, to be) under the current one. */
  keysRewrapped: number;
  /** The version given to --organization, if any. */
  keyCreated: { organizationId: number; version: number } | null;
  keysRetired: number;
  keysPruned: number;
  /** "table.column" → values re-encrypted with their organization's active key. */
  reencrypted: Record<string, number>;
  /** Values already under their organization's active key. */
  unchanged: number;
  /** Values and keys no configured key opens, each described; left as they were. */
  unreadable: string[];
}

type Row = Record<string, unknown>;

const column = (name: string): SQL => sql`${sql.identifier(name)}`;

function rowPredicate(spec: EncryptedColumn, row: Row): SQL {
  return sql.join(
    spec.key.map((k) => sql`${column(k)} = ${row[k]}`),
    sql` AND `,
  );
}

function storedValue(
  spec: EncryptedColumn,
  row: Row,
): { encryptedValue: string; iv: string; authTag: string } | null {
  if (spec.json) {
    const raw = row[spec.value];
    const parsed = (
      typeof raw === 'string' ? JSON.parse(raw) : raw
    ) as Partial<EncryptedSecret> | null;
    if (!parsed?.encryptedValue || !parsed.iv || !parsed.authTag) return null;
    return { encryptedValue: parsed.encryptedValue, iv: parsed.iv, authTag: parsed.authTag };
  }
  const encryptedValue = row[spec.value];
  const iv = row[spec.iv!];
  const authTag = row[spec.tag!];
  if (typeof encryptedValue !== 'string' || typeof iv !== 'string' || typeof authTag !== 'string')
    return null;
  return { encryptedValue, iv, authTag };
}

async function writeValue(spec: EncryptedColumn, row: Row, sealed: EncryptedSecret): Promise<void> {
  const where = rowPredicate(spec, row);
  if (spec.json) {
    await privilegedDb.execute(
      sql`UPDATE ${column(spec.table)} SET ${column(spec.value)} = ${JSON.stringify(sealed)}::jsonb WHERE ${where}`,
    );
    return;
  }
  await privilegedDb.execute(
    sql`UPDATE ${column(spec.table)} SET ${column(spec.value)} = ${sealed.encryptedValue}, ${column(spec.iv!)} = ${sealed.iv}, ${column(spec.tag!)} = ${sealed.authTag} WHERE ${where}`,
  );
}

function describeRow(spec: EncryptedColumn, row: Row): string {
  const id = spec.key.map((k) => `${k}=${String(row[k])}`).join(', ');
  return `${spec.table}.${spec.value} (${id})`;
}

/**
 * The whole rotation, as the command runs it. Keys first, then values, then the pruning, so a
 * value is never re-encrypted with a key that could not be re-wrapped.
 */
export async function rotateKeys(options: RotationOptions = {}): Promise<RotationReport> {
  const env = options.env ?? process.env;
  const masters = masterKeys(env);
  const dryRun = options.dryRun === true;
  const report: RotationReport = {
    masterKeyId: masters.current.id,
    dryRun,
    keysRewrapped: 0,
    keyCreated: null,
    keysRetired: 0,
    keysPruned: 0,
    reencrypted: {},
    unchanged: 0,
    unreadable: [],
  };
  forgetCachedKeys();

  // 1. Every stored key opens with a configured master key, and is wrapped by the current one.
  const unreadableKeys = new Set<string>();
  for (const stored of await listStoredKeys(options.organizationId)) {
    try {
      await dataKey(stored.organizationId, stored.keyVersion);
    } catch (error) {
      unreadableKeys.add(`${stored.organizationId}:${stored.keyVersion}`);
      report.unreadable.push(
        `organization ${stored.organizationId} key version ${stored.keyVersion}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (stored.masterKeyId === masters.current.id) continue;
    if (!dryRun) await rewrapStoredKey(stored);
    report.keysRewrapped += 1;
  }

  // 2. A new version for the organization being rotated.
  if (options.organizationId !== undefined) {
    const active = (await listStoredKeys(options.organizationId)).filter(
      (k) => k.retiredAt === null && !unreadableKeys.has(`${k.organizationId}:${k.keyVersion}`),
    );
    if (dryRun) {
      const latest = Math.max(
        0,
        ...(await listStoredKeys(options.organizationId)).map((k) => k.keyVersion),
      );
      report.keyCreated = { organizationId: options.organizationId, version: latest + 1 };
    } else {
      const created = await rotateOrganizationKey(options.organizationId);
      report.keyCreated = { organizationId: created.organizationId, version: created.version };
    }
    report.keysRetired = active.length;
  }

  // 3. Every value under its organization's active key.
  const referenced = new Set<string>();
  for (const spec of ENCRYPTED_COLUMNS) {
    const selected = sql.join(
      [...spec.key, spec.value, ...(spec.json ? [] : [spec.iv!, spec.tag!])].map(column),
      sql`, `,
    );
    const organization = sql.raw(spec.organization);
    const scope =
      options.organizationId === undefined
        ? sql``
        : sql` AND ${organization} = ${options.organizationId}`;
    const result = await privilegedDb.execute(
      sql`SELECT ${selected}, ${organization} AS wfm_organization_id FROM ${column(spec.table)} WHERE ${column(spec.value)} IS NOT NULL${scope}`,
    );
    for (const row of result.rows as Row[]) {
      const value = storedValue(spec, row);
      const organizationId = Number(row.wfm_organization_id);
      if (!value || !Number.isSafeInteger(organizationId) || organizationId <= 0) continue;
      const envelope = parseEnvelope(value.encryptedValue);
      if (envelope && unreadableKeys.has(`${organizationId}:${envelope.version}`)) {
        referenced.add(`${organizationId}:${envelope.version}`);
        report.unreadable.push(
          `${describeRow(spec, row)}: its key version ${envelope.version} cannot be opened`,
        );
        continue;
      }
      const target =
        dryRun && options.organizationId === organizationId
          ? { version: report.keyCreated!.version }
          : await activeDataKey(organizationId);
      if (envelope?.version === target.version) {
        referenced.add(`${organizationId}:${envelope.version}`);
        report.unchanged += 1;
        continue;
      }
      let plain: string;
      try {
        plain = await decryptSecret(value.encryptedValue, value.iv, value.authTag, organizationId);
      } catch (error) {
        if (envelope) referenced.add(`${organizationId}:${envelope.version}`);
        report.unreadable.push(
          `${describeRow(spec, row)}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (!dryRun) await writeValue(spec, row, await encryptSecret(plain, organizationId));
      const name = `${spec.table}.${spec.value}`;
      report.reencrypted[name] = (report.reencrypted[name] ?? 0) + 1;
    }
  }

  // 4. Retired versions nothing names any more.
  if (options.prune) {
    for (const stored of await listStoredKeys(options.organizationId)) {
      if (stored.retiredAt === null) continue;
      if (referenced.has(`${stored.organizationId}:${stored.keyVersion}`)) continue;
      if (!dryRun) await deleteStoredKey(stored.id);
      report.keysPruned += 1;
    }
  }

  forgetCachedKeys();
  return report;
}

export interface CliOptions {
  organizationId?: number;
  prune: boolean;
  dryRun: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { prune: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--organization' || arg === '-o') {
      const id = Number(argv[i + 1]);
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new Error('--organization needs the organization id, a positive integer.');
      options.organizationId = id;
      i += 1;
    } else if (arg === '--prune') options.prune = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function usage(): string {
  return [
    'Usage: wfm-rotate-key [--organization <id>] [--prune] [--dry-run]',
    '',
    '  (no option)           re-wrap every organization key under ENCRYPTION_KEY and move values',
    '                        still encrypted with a master key to their organization key',
    '  --organization <id>   give the organization a new key version and re-encrypt its values',
    '  --prune               delete retired key versions no value names any more',
    '  --dry-run             report what would change without writing',
  ].join('\n');
}

export function formatReport(report: RotationReport): string {
  const lines = [
    `${report.dryRun ? 'Would use' : 'Using'} master key ${report.masterKeyId}.`,
    `Organization keys re-wrapped under it: ${report.keysRewrapped}`,
  ];
  if (report.keyCreated)
    lines.push(
      `Organization ${report.keyCreated.organizationId}: ${report.dryRun ? 'would get' : 'has'} key version ${report.keyCreated.version}; versions retired: ${report.keysRetired}`,
    );
  const total = Object.values(report.reencrypted).reduce((a, b) => a + b, 0);
  lines.push(
    `Values ${report.dryRun ? 'to re-encrypt' : 're-encrypted'}: ${total} (already current: ${report.unchanged})`,
  );
  for (const [name, count] of Object.entries(report.reencrypted)) lines.push(`  ${name}: ${count}`);
  lines.push(
    `Retired key versions ${report.dryRun ? 'to delete' : 'deleted'}: ${report.keysPruned}`,
  );
  if (report.unreadable.length > 0) {
    lines.push(`Could not be read with the configured keys (${report.unreadable.length}):`);
    for (const item of report.unreadable) lines.push(`  - ${item}`);
    lines.push(
      'Add the master key they were written under to ENCRYPTION_KEY_PREVIOUS and run again, or replace the values.',
    );
  }
  return lines.join('\n');
}

async function main(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    return EXIT_TOOL_ERROR;
  }
  if (options.help) {
    console.log(usage());
    return EXIT_OK;
  }
  try {
    const report = await rotateKeys(options);
    console.log(formatReport(report));
    return report.unreadable.length > 0 ? EXIT_UNREADABLE : EXIT_OK;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return EXIT_TOOL_ERROR;
  } finally {
    await closeDb();
  }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('/wfm-rotate-key.ts') ?? false;
if (isDirectRun) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
