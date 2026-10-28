import type { Pool } from 'pg';

/**
 * pg emits `error` on the pool when an idle connection dies (database restart, failover, network
 * cut). Without a listener Node treats it as an uncaught exception and the process shuts down.
 * The pool discards the broken client by itself; we only log. Every `new Pool(` in
 * server/ must go through this (enforced by pool-errors.test.ts). The caller passes its logger:
 * importing logger.ts here would close a cycle through db.ts.
 */
export function attachPoolErrorHandler(
  pool: Pool,
  name: string,
  logError: (message: string) => void,
): Pool {
  pool.on('error', (error: Error) => {
    logError(`PostgreSQL pool "${name}": idle connection error: ${error.message}`);
  });
  return pool;
}
