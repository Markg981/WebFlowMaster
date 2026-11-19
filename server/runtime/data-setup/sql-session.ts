/**
 * One connection to the application's database for the length of a data fixture, in the three
 * dialects the `queryDatabase` step speaks (server/runtime/database-step.ts, whose drivers,
 * egress vetting and timeouts this reuses).
 *
 * A fixture needs more than a statement: its values bound as parameters, its script in a
 * transaction so a failure halfway leaves nothing behind, and a lock so two lanes of a plan
 * asking for the same data at the same moment do not both create it. Each dialect has its own
 * spelling of each, and this is the only place that knows them.
 */

import { createHash } from 'node:crypto';
import {
  connectMysql,
  connectPostgres,
  connectSqlServer,
  mysqlResult,
  postgresResult,
  sqlServerResult,
  type DatabaseKind,
  type DatabaseResult,
  type DatabaseTarget,
} from '../database-step';
import type { BoundSql } from '@shared/sql-template';

/** Which database a connection reached, for the identity guard. */
export interface DatabaseIdentity {
  database: string;
  server: string;
}

export interface SqlSession {
  readonly kind: DatabaseKind;
  query(bound: BoundSql): Promise<DatabaseResult>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /**
   * Waits for an exclusive lock on `key` that lasts until the transaction ends. Call it inside
   * begin(): a lock outside a transaction would outlive the work it protects.
   */
  lock(key: string, timeoutMs: number): Promise<void>;
  identity(): Promise<DatabaseIdentity>;
  close(): Promise<void>;
}

/** Opens a session. A field so tests can stand in for the real drivers. */
export type SqlSessionFactory = (
  kind: DatabaseKind,
  url: string,
  timeoutMs: number,
  target?: DatabaseTarget,
) => Promise<SqlSession>;

/** The lock name, short and the same for the same key everywhere. */
export function lockName(key: string): string {
  return `wfm:${createHash('sha256').update(key).digest('hex').slice(0, 40)}`;
}

/** A 64-bit key for pg_advisory_xact_lock, from the same hash. */
function advisoryKey(key: string): string {
  return BigInt.asIntN(64, BigInt(`0x${lockName(key).slice(4, 20)}`)).toString();
}

const text = (bound: string): BoundSql => ({ text: bound, values: [], names: [] });

async function postgresSession(
  url: string,
  timeoutMs: number,
  target?: DatabaseTarget,
): Promise<SqlSession> {
  const client = await connectPostgres(url, timeoutMs, target);
  const run = async (bound: BoundSql) =>
    postgresResult(
      bound.values.length
        ? await client.query(bound.text, bound.values)
        : await client.query(bound.text),
    );
  return {
    kind: 'postgres',
    query: run,
    begin: async () => void (await client.query('BEGIN')),
    commit: async () => void (await client.query('COMMIT')),
    rollback: async () => void (await client.query('ROLLBACK').catch(() => {})),
    lock: async (key, lockTimeoutMs) => {
      await client.query(`SET LOCAL lock_timeout = ${Math.max(1, Math.round(lockTimeoutMs))}`);
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [advisoryKey(key)]);
    },
    identity: async () => {
      const row = (
        await client.query(
          `SELECT current_database() AS database, coalesce(inet_server_addr()::text, '') AS server`,
        )
      ).rows[0] as { database: string; server: string };
      return { database: row.database, server: row.server };
    },
    close: () => client.end().catch(() => {}),
  };
}

async function mysqlSession(
  url: string,
  timeoutMs: number,
  target?: DatabaseTarget,
): Promise<SqlSession> {
  const connection = await connectMysql(url, timeoutMs, target);
  // GET_LOCK is not transactional: released by hand when the transaction ends.
  let held: string | null = null;
  const release = async () => {
    if (!held) return;
    const name = held;
    held = null;
    await connection.query({ sql: 'SELECT RELEASE_LOCK(?)', values: [name] }).catch(() => {});
  };
  const run = async (bound: BoundSql) => {
    const [result, fields] = await connection.query({
      sql: bound.text,
      values: bound.values,
      timeout: timeoutMs,
    });
    return mysqlResult(result, fields);
  };
  return {
    kind: 'mysql',
    query: run,
    begin: async () => void (await connection.query('START TRANSACTION')),
    commit: async () => {
      await connection.query('COMMIT');
      await release();
    },
    rollback: async () => {
      await connection.query('ROLLBACK').catch(() => {});
      await release();
    },
    lock: async (key, lockTimeoutMs) => {
      const name = lockName(key);
      const [rows] = await connection.query({
        sql: 'SELECT GET_LOCK(?, ?) AS got',
        values: [name, Math.max(1, Math.ceil(lockTimeoutMs / 1000))],
      });
      if ((rows as Array<{ got: number | null }>)[0]?.got !== 1)
        throw new Error('Another run holds the lock for this fixture; it did not end in time.');
      held = name;
    },
    identity: async () => {
      const [rows] = await connection.query(
        'SELECT DATABASE() AS `database`, @@hostname AS `server`',
      );
      const row = (rows as Array<{ database: string | null; server: string }>)[0];
      return { database: row?.database ?? '', server: row?.server ?? '' };
    },
    close: async () => {
      await release();
      await connection.end().catch(() => {});
    },
  };
}

async function sqlServerSession(
  url: string,
  timeoutMs: number,
  target?: DatabaseTarget,
): Promise<SqlSession> {
  const { default: mssql } = await import('mssql');
  const pool = await connectSqlServer(url, timeoutMs, target);
  let transaction: InstanceType<typeof mssql.Transaction> | null = null;
  const request = () => (transaction ? new mssql.Request(transaction) : pool.request());
  const run = async (bound: BoundSql) => {
    const req = request();
    bound.names.forEach((name, i) => req.input(name, bound.values[i] as never));
    return sqlServerResult(await req.query(bound.text));
  };
  return {
    kind: 'sqlserver',
    query: run,
    begin: async () => {
      transaction = new mssql.Transaction(pool);
      await transaction.begin();
    },
    commit: async () => {
      const current = transaction;
      transaction = null;
      await current?.commit();
    },
    rollback: async () => {
      const current = transaction;
      transaction = null;
      await current?.rollback().catch(() => {});
    },
    lock: async (key, lockTimeoutMs) => {
      const result = await run({
        text:
          'DECLARE @result int; ' +
          "EXEC @result = sp_getapplock @Resource = @wfm0, @LockMode = 'Exclusive', " +
          "@LockOwner = 'Transaction', @LockTimeout = @wfm1; SELECT @result AS result",
        values: [lockName(key), Math.max(1, Math.round(lockTimeoutMs))],
        names: ['wfm0', 'wfm1'],
      });
      const code = Number(result.rows[0]?.result);
      // 0 granted, 1 granted after waiting; negative: timeout, deadlock, cancelled, error.
      if (!(code >= 0))
        throw new Error('Another run holds the lock for this fixture; it did not end in time.');
    },
    identity: async () => {
      const result = await run(text('SELECT DB_NAME() AS [database], @@SERVERNAME AS [server]'));
      const row = result.rows[0] as { database?: string; server?: string } | undefined;
      return { database: row?.database ?? '', server: row?.server ?? '' };
    },
    close: async () => {
      if (transaction) await transaction.rollback().catch(() => {});
      transaction = null;
      await pool.close().catch(() => {});
    },
  };
}

export const openSqlSession: SqlSessionFactory = (kind, url, timeoutMs, target) =>
  kind === 'postgres'
    ? postgresSession(url, timeoutMs, target)
    : kind === 'mysql'
      ? mysqlSession(url, timeoutMs, target)
      : sqlServerSession(url, timeoutMs, target);
