import type { Pool } from 'pg';
import logger from './logger';

/**
 * pg emits `error` on the pool when an idle connection dies (database restart, failover, network
 * cut). Without a listener Node treats it as an uncaught exception and the process shuts down.
 * The pool discards the broken client by itself; we only log. Every `new Pool(` in
 * server/ must go through this (enforced by pool-errors.test.ts).
 */
export function attachPoolErrorHandler(pool: Pool, name: string): Pool {
  pool.on('error', (error: Error) => {
    logger.error(`PostgreSQL pool "${name}": idle connection error: ${error.message}`);
  });
  return pool;
}
