import { Pool } from 'pg';
import logger from './logger';

/**
 * Cross-replica coordination for periodic sweeps and the migrator. Session-level advisory locks,
 * taken and released on the SAME dedicated connection (never the query pool, whose connections
 * are shared between statements). Namespace 7305 keeps keys apart from the per-org locks
 * (7301-7304, which use (namespace, organizationId)).
 *
 * PGlite (tests, local) is a single process: an in-process set gives the same semantics.
 */
const NAMESPACE = 7305;

/** Stable keys: one integer per job. Never renumber. */
export const ADVISORY_KEYS = {
  artifactRetention: 1,
  runRecovery: 2,
  migrator: 3,
} as const;

const localHeld = new Set<number>();
let lockPool: Pool | undefined;

function isPostgres(): boolean {
  const url = process.env.DATABASE_URL ?? '';
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

function pool(): Pool {
  lockPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return lockPool;
}

/** Runs fn only if the lock is free; otherwise returns { ran: false } without waiting. */
export async function withAdvisoryLock<T>(
  key: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  if (!isPostgres()) {
    if (localHeld.has(key)) {
      logger.debug({ message: 'Advisory lock busy, skipping', key });
      return { ran: false };
    }
    localHeld.add(key);
    try {
      return { ran: true, value: await fn() };
    } finally {
      localHeld.delete(key);
    }
  }
  const client = await pool().connect();
  let locked = false;
  let destroy = false;
  try {
    const res = await client.query('SELECT pg_try_advisory_lock($1,$2) AS ok', [NAMESPACE, key]);
    locked = res.rows[0]?.ok === true;
    if (!locked) {
      logger.debug({ message: 'Advisory lock busy, skipping', key });
      return { ran: false };
    }
    return { ran: true, value: await fn() };
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1,$2)', [NAMESPACE, key]);
      } catch {
        destroy = true; // Closing the session releases the lock.
      }
    }
    client.release(destroy);
  }
}

/** Waits for the lock (migrator: parallel rollouts serialize). */
export async function withBlockingAdvisoryLock<T>(
  key: number,
  connectionString: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!connectionString || !/^postgres(ql)?:\/\//.test(connectionString)) return fn();
  const { Client } = await import('pg');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1,$2)', [NAMESPACE, key]);
    return await fn();
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1,$2)', [NAMESPACE, key]);
    } catch {
      /* the session ending releases it */
    }
    await client.end().catch(() => undefined);
  }
}
