import { and, eq, isNull, sql } from 'drizzle-orm';
import { organizationKeys } from '@shared/schema';
import { privilegedDb } from './db';
import type { TenantTx } from './middleware/tenancy';
import { tenantTransactionInScope } from './middleware/tenancy';
import {
  MasterKeyError,
  masterKeyById,
  masterKeys,
  newDataKey,
  unwrapDataKey,
  wrapDataKey,
  type MasterKeys,
} from './master-keys';

/**
 * The per-organization data keys: envelope encryption over the one master key.
 *
 * Every stored secret used to be encrypted directly with ENCRYPTION_KEY. Now each organization
 * has a data key of its own, generated the first time it stores a secret, kept in
 * organization_keys wrapped by the master key, and that is what its secrets are encrypted with.
 * What it buys is not protection from a stolen master key — whoever holds it can unwrap every
 * data key — but isolation of key material and cheap rotation: one organization's key can be
 * replaced by re-encrypting that organization's rows alone, and the master key can be replaced by
 * re-wrapping a few dozen rows instead of every secret (scripts/wfm-rotate-key.ts).
 *
 * Where the rows are read from matters, because PGlite has one connection: a query sent while a
 * transaction is open on it waits for that transaction, which waits for the query. So a lookup
 * goes through the transaction already open when there is one — the ambient tenant transaction,
 * or the one a caller inside a privileged transaction passes — and through the privileged handle
 * only outside any. Only the latter fills the cache: a key created inside a transaction that then
 * rolls back must not survive it in memory, or the next value would be encrypted with a key that
 * exists nowhere else.
 */

export interface DataKey {
  organizationId: number;
  version: number;
  key: Buffer;
}

/** A transaction handle or the privileged handle: wherever the lookup must run. */
export type KeyExecutor = TenantTx | typeof privilegedDb;

const keys = new Map<string, DataKey>();
const activeVersions = new Map<number, { version: number; until: number }>();
/**
 * How long a process keeps using the version it last saw as active. A rotation by the script
 * retires it in the database; other processes notice within this, without a restart.
 */
const ACTIVE_VERSION_TTL_MS = 60_000;

const cacheKey = (organizationId: number, version: number) => `${organizationId}:${version}`;

/** Drops everything remembered: for tests that change the environment or rotate keys. */
export function forgetCachedKeys(): void {
  keys.clear();
  activeVersions.clear();
}

function assertOrganizationId(organizationId: number): void {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error(`Not an organization id: ${organizationId}`);
  }
}

interface KeyRow {
  organizationId: number;
  keyVersion: number;
  wrappedKey: string;
  masterKeyId: string;
}

function unwrapRow(row: KeyRow, masters: MasterKeys = masterKeys()): DataKey {
  const master = masterKeyById(row.masterKeyId, masters);
  if (!master) {
    throw new MasterKeyError(
      `The key of organization ${row.organizationId}, version ${row.keyVersion}, was wrapped by master key ${row.masterKeyId}, which is neither ENCRYPTION_KEY nor listed in ENCRYPTION_KEY_PREVIOUS.`,
    );
  }
  return {
    organizationId: row.organizationId,
    version: row.keyVersion,
    key: unwrapDataKey(row.wrappedKey, master, row.organizationId, row.keyVersion),
  };
}

/**
 * The organization's active key, created if it has none. Through `tx` when given, else through
 * the ambient tenant transaction, else through the privileged handle (and then cached).
 */
export async function activeDataKey(organizationId: number, tx?: KeyExecutor): Promise<DataKey> {
  assertOrganizationId(organizationId);
  const executor = tx ?? tenantTransactionInScope();
  if (!executor) {
    const remembered = activeVersions.get(organizationId);
    const cachedKey =
      remembered && remembered.until > Date.now()
        ? keys.get(cacheKey(organizationId, remembered.version))
        : undefined;
    if (cachedKey) return cachedKey;
  }
  const dataKey = await loadOrCreateActive(organizationId, executor ?? privilegedDb);
  if (!executor) remember(dataKey, true);
  return dataKey;
}

/** The key one stored value names; it may be retired. Throws when the organization never had it. */
export async function dataKey(
  organizationId: number,
  version: number,
  tx?: KeyExecutor,
): Promise<DataKey> {
  assertOrganizationId(organizationId);
  const executor = tx ?? tenantTransactionInScope();
  if (!executor) {
    const cachedKey = keys.get(cacheKey(organizationId, version));
    if (cachedKey) return cachedKey;
  }
  const [row] = await (executor ?? privilegedDb)
    .select()
    .from(organizationKeys)
    .where(
      and(
        eq(organizationKeys.organizationId, organizationId),
        eq(organizationKeys.keyVersion, version),
      ),
    )
    .limit(1);
  if (!row) {
    throw new MasterKeyError(
      `Organization ${organizationId} has no encryption key version ${version}: the value belongs to another organization, or the version was deleted while something still used it.`,
    );
  }
  const unwrapped = unwrapRow(row);
  if (!executor) remember(unwrapped, false);
  return unwrapped;
}

function remember(dataKey: DataKey, active: boolean): void {
  keys.set(cacheKey(dataKey.organizationId, dataKey.version), dataKey);
  if (active) {
    activeVersions.set(dataKey.organizationId, {
      version: dataKey.version,
      until: Date.now() + ACTIVE_VERSION_TTL_MS,
    });
  }
}

async function loadOrCreateActive(organizationId: number, executor: KeyExecutor): Promise<DataKey> {
  const [existing] = await executor
    .select()
    .from(organizationKeys)
    .where(
      and(eq(organizationKeys.organizationId, organizationId), isNull(organizationKeys.retiredAt)),
    )
    .limit(1);
  if (existing) return unwrapRow(existing);

  // Two processes storing the organization's first secret at once both get here; the unique
  // active-version index lets one row in, and the other reads it back below.
  await executor
    .insert(organizationKeys)
    .values(newVersionRow(organizationId, 1))
    .onConflictDoNothing();
  const [created] = await executor
    .select()
    .from(organizationKeys)
    .where(
      and(eq(organizationKeys.organizationId, organizationId), isNull(organizationKeys.retiredAt)),
    )
    .limit(1);
  if (!created) {
    throw new MasterKeyError(
      `Could not create an encryption key for organization ${organizationId}: does the organization exist?`,
    );
  }
  return unwrapRow(created);
}

function newVersionRow(organizationId: number, version: number) {
  const { current } = masterKeys();
  return {
    organizationId,
    keyVersion: version,
    wrappedKey: wrapDataKey(newDataKey(), current, organizationId, version),
    masterKeyId: current.id,
  };
}

/**
 * Gives the organization a new active key and retires the one it had. Its secrets still name
 * the old version and keep decrypting until the rotation script re-encrypts them, which is what
 * the script does right after calling this. Privileged: a tenant transaction may not retire keys.
 */
export async function rotateOrganizationKey(organizationId: number): Promise<DataKey> {
  assertOrganizationId(organizationId);
  const created = await privilegedDb.transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: sql<number>`coalesce(max(${organizationKeys.keyVersion}), 0)` })
      .from(organizationKeys)
      .where(eq(organizationKeys.organizationId, organizationId));
    await tx
      .update(organizationKeys)
      .set({ retiredAt: new Date() })
      .where(
        and(
          eq(organizationKeys.organizationId, organizationId),
          isNull(organizationKeys.retiredAt),
        ),
      );
    const [row] = await tx
      .insert(organizationKeys)
      .values(newVersionRow(organizationId, Number(latest?.version ?? 0) + 1))
      .returning();
    return row;
  });
  activeVersions.delete(organizationId);
  const unwrapped = unwrapRow(created);
  remember(unwrapped, true);
  return unwrapped;
}

export interface StoredKey {
  id: number;
  organizationId: number;
  keyVersion: number;
  masterKeyId: string;
  retiredAt: Date | null;
}

/** Every stored key, or one organization's, as the rotation script and the startup check see them. */
export async function listStoredKeys(organizationId?: number): Promise<StoredKey[]> {
  const rows = await privilegedDb
    .select({
      id: organizationKeys.id,
      organizationId: organizationKeys.organizationId,
      keyVersion: organizationKeys.keyVersion,
      masterKeyId: organizationKeys.masterKeyId,
      retiredAt: organizationKeys.retiredAt,
    })
    .from(organizationKeys)
    .where(
      organizationId === undefined
        ? undefined
        : eq(organizationKeys.organizationId, organizationId),
    )
    .orderBy(organizationKeys.organizationId, organizationKeys.keyVersion);
  return rows;
}

/**
 * Re-wraps one stored key under the current master key, if it was wrapped by another. Returns
 * whether the row changed. Throws when no configured master key opens it.
 */
export async function rewrapStoredKey(stored: StoredKey): Promise<boolean> {
  const masters = masterKeys();
  if (stored.masterKeyId === masters.current.id) return false;
  const [row] = await privilegedDb
    .select()
    .from(organizationKeys)
    .where(eq(organizationKeys.id, stored.id))
    .limit(1);
  if (!row) return false;
  const unwrapped = unwrapRow(row, masters);
  await privilegedDb
    .update(organizationKeys)
    .set({
      wrappedKey: wrapDataKey(unwrapped.key, masters.current, row.organizationId, row.keyVersion),
      masterKeyId: masters.current.id,
    })
    .where(eq(organizationKeys.id, row.id));
  return true;
}

/** Deletes a retired version. The caller has checked that nothing names it any more. */
export async function deleteStoredKey(id: number): Promise<void> {
  await privilegedDb
    .delete(organizationKeys)
    .where(and(eq(organizationKeys.id, id), sql`${organizationKeys.retiredAt} is not null`));
  forgetCachedKeys();
}

/**
 * Refuses to start when a stored key cannot be opened with the configured master keys, naming
 * each one and the master key it needs, in the manner of server/startup-config.ts: an
 * ENCRYPTION_KEY changed without ENCRYPTION_KEY_PREVIOUS would otherwise be discovered on the
 * first run that needs a secret, as a failed step. Every key that opens is cached on the way.
 */
export async function assertOrganizationKeysReadable(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const masters = masterKeys(env);
  const rows = await privilegedDb.select().from(organizationKeys);
  const problems: string[] = [];
  for (const row of rows) {
    try {
      const unwrapped = unwrapRow(row, masters);
      remember(unwrapped, row.retiredAt === null);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start: ${problems.length} stored encryption key(s) cannot be opened with ENCRYPTION_KEY or ENCRYPTION_KEY_PREVIOUS (current master key ${masters.current.id}).\n  - ${problems.join('\n  - ')}\nRestore the master key that wrapped them in ENCRYPTION_KEY_PREVIOUS, then run npm run key:rotate to re-wrap them under the current one.`,
    );
  }
}
