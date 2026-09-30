/**
 * The `queryDatabase` step: a SQL statement against the application's database, from inside a
 * web test.
 *
 * What a screen cannot show — the order row the checkout wrote, the flag an admin page set — or
 * what a test must prepare or clean up without clicking through ten screens. The connection is
 * an environment variable, `db.url` (or `db.<name>.url` for a second database), so each
 * environment points at its own database and the password is an encrypted secret like any
 * other. The scheme picks the driver: postgres://, mysql:// (or mariadb://), sqlserver://.
 *
 * The query runs from the WebFlowMaster runner, not from the browser: the runner has to reach
 * the database, also for a run on a local agent. Whatever the statement does, it does with the
 * rights of the user in the address; a read-only user is the safe choice where only reads are
 * needed.
 */

export type DatabaseKind = 'postgres' | 'mysql' | 'sqlserver';

export interface DatabaseResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** Rows returned by a query, or changed by an INSERT, UPDATE or DELETE. */
  rowCount: number;
}

/** Runs one statement. A field so a test can stand in for the real drivers. */
export type DatabaseRunner = (kind: DatabaseKind, url: string, sql: string, timeoutMs: number) => Promise<DatabaseResult>;

export const DATABASE_TIMEOUT_MS = 30_000;
/** Rows kept from a result. A step reads a value or a few rows, never a table. */
export const MAX_ROWS = 1000;
/** Rows written into {{db.json}}. */
export const JSON_ROWS = 100;

export interface DatabaseQuery {
  /** The connection's name, from "@name SELECT…"; null for db.url. */
  connection: string | null;
  sql: string;
}

/** "SELECT …" or "@orders SELECT …". */
export function parseDatabaseQuery(value: string): DatabaseQuery | { error: string } {
  const text = value.trim();
  const named = /^@([A-Za-z][\w-]*)\s+([\s\S]+)$/.exec(text);
  const query = named ? { connection: named[1], sql: named[2].trim() } : { connection: null, sql: text };
  if (query.sql === '' || query.sql.startsWith('@')) {
    return { error: `"${value}" is not a SQL statement. Write the statement, or @name and the statement for the database in db.name.url.` };
  }
  return query;
}

/** The variable that holds the address of a connection. */
export function connectionVariable(connection: string | null): string {
  return connection ? `db.${connection}.url` : 'db.url';
}

export function databaseKind(url: string): DatabaseKind | null {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url.trim())?.[1]?.toLowerCase();
  if (scheme === 'postgres' || scheme === 'postgresql') return 'postgres';
  if (scheme === 'mysql' || scheme === 'mariadb') return 'mysql';
  if (scheme === 'sqlserver' || scheme === 'mssql') return 'sqlserver';
  return null;
}

/** The address with its password replaced, for a message: the password is a secret. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(the address in the environment)';
  }
}

/** A driver's error without the password, should the driver quote the address back. */
export function redactMessage(message: string, url: string): string {
  let out = message;
  try {
    const password = decodeURIComponent(new URL(url).password);
    if (password) out = out.split(password).join('***');
  } catch {
    // Not a URL: nothing of it to hide beyond what the driver said.
  }
  return out;
}

/** A cell as the text a later step types or compares. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (typeof value === 'object') return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));
  return String(value);
}

/**
 * The variables a result sets: {{db.rowCount}}, {{db.value}} (the first column of the first
 * row), {{db.<column>}} for each column of the first row, and {{db.json}} with the rows.
 */
export function resultVariables(result: DatabaseResult): Record<string, string> {
  const first = result.rows[0];
  const vars: Record<string, string> = {
    'db.rowCount': String(result.rowCount),
    'db.value': first && result.columns.length ? cellText(first[result.columns[0]]) : '',
    'db.json': JSON.stringify(
      result.rows.slice(0, JSON_ROWS).map((row) => Object.fromEntries(result.columns.map((c) => [c, row[c] === undefined ? null : row[c]]))),
      (_key, v) => (typeof v === 'bigint' ? String(v) : Buffer.isBuffer(v) ? v.toString('hex') : v),
    ),
  };
  for (const column of result.columns) {
    // A name a placeholder can hold: letters, digits, _ and . — "count(*)" becomes "count___".
    const name = column.replace(/[^\w.]/g, '_');
    if (name && !(`db.${name}` in vars)) vars[`db.${name}`] = first ? cellText(first[column]) : '';
  }
  return vars;
}

const runPostgres = async (url: string, sql: string, timeoutMs: number): Promise<DatabaseResult> => {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs, statement_timeout: timeoutMs, query_timeout: timeoutMs });
  await client.connect();
  try {
    const result = await client.query(sql);
    // Several statements give one result each; the last is the one a test asks about.
    const last = Array.isArray(result) ? result[result.length - 1] : result;
    const columns = (last.fields ?? []).map((f: { name: string }) => f.name);
    return { columns, rows: (last.rows ?? []).slice(0, MAX_ROWS), rowCount: last.rowCount ?? last.rows?.length ?? 0 };
  } finally {
    await client.end().catch(() => {});
  }
};

const runMysql = async (url: string, sql: string, timeoutMs: number): Promise<DatabaseResult> => {
  const mysql = await import('mysql2/promise');
  const connection = await mysql.createConnection({ uri: url.replace(/^mariadb:/i, 'mysql:'), connectTimeout: timeoutMs });
  try {
    const [result, fields] = await connection.query({ sql, timeout: timeoutMs });
    if (Array.isArray(result)) {
      const rows = result as Array<Record<string, unknown>>;
      const columns = (fields ?? []).map((f) => f.name);
      return { columns, rows: rows.slice(0, MAX_ROWS), rowCount: rows.length };
    }
    return { columns: [], rows: [], rowCount: (result as { affectedRows?: number }).affectedRows ?? 0 };
  } finally {
    await connection.end().catch(() => {});
  }
};

/**
 * sqlserver://user:password@host:1433/database, the URL form of an ADO.NET connection string.
 * `?encrypt=false` for a server without TLS; `trustServerCertificate=true` for a self-signed one.
 */
export function sqlServerConfig(url: string, timeoutMs: number) {
  const parsed = new URL(url);
  const flag = (name: string, fallback: boolean) => {
    const raw = parsed.searchParams.get(name);
    return raw === null ? fallback : /^(true|1|yes)$/i.test(raw);
  };
  const [server, instanceName] = decodeURIComponent(parsed.hostname).split('\\');
  return {
    server,
    port: parsed.port ? Number(parsed.port) : undefined,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || undefined,
    connectionTimeout: timeoutMs,
    requestTimeout: timeoutMs,
    options: {
      encrypt: flag('encrypt', true),
      trustServerCertificate: flag('trustServerCertificate', false),
      ...(instanceName ? { instanceName } : {}),
    },
  };
}

const runSqlServer = async (url: string, sql: string, timeoutMs: number): Promise<DatabaseResult> => {
  const { default: mssql } = await import('mssql');
  const pool = new mssql.ConnectionPool(sqlServerConfig(url, timeoutMs));
  await pool.connect();
  try {
    const result = await pool.request().query(sql);
    const sets = result.recordsets as unknown as Array<Array<Record<string, unknown>> & { columns?: Record<string, unknown> }>;
    const last = sets.length ? sets[sets.length - 1] : null;
    if (last) {
      const columns = last.columns ? Object.keys(last.columns) : Object.keys(last[0] ?? {});
      return { columns, rows: last.slice(0, MAX_ROWS), rowCount: last.length };
    }
    return { columns: [], rows: [], rowCount: result.rowsAffected.reduce((sum, n) => sum + n, 0) };
  } finally {
    await pool.close().catch(() => {});
  }
};

export const runDatabaseQuery: DatabaseRunner = (kind, url, sql, timeoutMs) => {
  const run = kind === 'postgres' ? runPostgres : kind === 'mysql' ? runMysql : runSqlServer;
  // Every driver has its own timeouts, and each covers only part of the way; this covers it all.
  return Promise.race([
    run(url, sql, timeoutMs),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`No answer within ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs + 1000).unref()),
  ]);
};
