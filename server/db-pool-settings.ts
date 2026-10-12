/**
 * How the PostgreSQL connection pool is sized and when it gives up.
 *
 * The pool used to run on node-postgres's defaults: ten connections, a wait for a free one that
 * never times out, and no limit on how long a statement or an open transaction may take. With a
 * worker at high concurrency and the API on the same database the ten run out, and every later
 * request queues behind them with nothing to say it has waited too long; one slow query holds its
 * connection for as long as it likes. Each limit below turns one of those silent waits into an
 * error that names it.
 *
 * Every value comes from the environment, so an installation can size the pool to its database's
 * max_connections (shared with the worker processes and the migrator) without a release. Zero
 * turns a timeout off, as it does in PostgreSQL.
 */
export interface PoolSettings {
  /** Connections this process may hold at once. */
  max: number;
  /** How long a caller waits for a free connection before the pool fails it. */
  connectionTimeoutMillis: number;
  /** How long an unused connection stays open before the pool closes it. */
  idleTimeoutMillis: number;
  /** PostgreSQL cancels any single statement that runs longer than this. */
  statementTimeoutMs: number;
  /**
   * PostgreSQL ends a session that sits inside an open transaction doing nothing for this long,
   * so a transaction a crashed callback left open gives its connection and its locks back.
   */
  idleInTransactionTimeoutMs: number;
}

export const DEFAULT_POOL_SETTINGS: PoolSettings = {
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statementTimeoutMs: 30_000,
  idleInTransactionTimeoutMs: 60_000,
};

const ENV_NAMES: Record<keyof PoolSettings, string> = {
  max: 'PG_POOL_MAX',
  connectionTimeoutMillis: 'PG_CONNECTION_TIMEOUT_MS',
  idleTimeoutMillis: 'PG_IDLE_TIMEOUT_MS',
  statementTimeoutMs: 'PG_STATEMENT_TIMEOUT_MS',
  idleInTransactionTimeoutMs: 'PG_IDLE_IN_TRANSACTION_TIMEOUT_MS',
};

/**
 * Reads the settings from the environment. A value that is not a whole number is refused at
 * startup rather than ignored: a typo in a timeout would otherwise quietly mean the default.
 */
export function readPoolSettings(env: NodeJS.ProcessEnv = process.env): PoolSettings {
  const settings = { ...DEFAULT_POOL_SETTINGS };
  for (const key of Object.keys(ENV_NAMES) as (keyof PoolSettings)[]) {
    const name = ENV_NAMES[key];
    const raw = env[name]?.trim();
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    const minimum = key === 'max' ? 1 : 0;
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`${name} must be a whole number of at least ${minimum}, not "${raw}".`);
    }
    settings[key] = value;
  }
  return settings;
}

/**
 * The statements each new connection runs before the pool hands it out.
 *
 * Statements rather than startup parameters (`options=-c statement_timeout=...`), for the same
 * reason as the time zone in db.ts: some connection poolers refuse or drop startup parameters,
 * and an ordinary SET is understood by all of them. The values are integers checked by
 * readPoolSettings, so writing them into the statement is safe.
 */
export function sessionSetupStatements(settings: PoolSettings, timeZone: string): string {
  return [
    `SET TIME ZONE '${timeZone}'`,
    `SET statement_timeout = ${settings.statementTimeoutMs}`,
    `SET idle_in_transaction_session_timeout = ${settings.idleInTransactionTimeoutMs}`,
  ].join('; ');
}
