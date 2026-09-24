import { DrizzleQueryError } from 'drizzle-orm';
import { PgPreparedQuery } from 'drizzle-orm/pg-core';

/**
 * Database errors reach the application as the driver raised them.
 *
 * drizzle-orm 0.45 wraps every failed query in a DrizzleQueryError whose message is
 * "Failed query: <the SQL> params: <the values>", with the driver's error as its cause. Two things
 * broke with it. Every place that told a duplicate from a missing reference by the error — a 409
 * for a name already taken, a 400 for a project that does not exist — saw a message with neither
 * and answered 500. And every log line and error answer that carried `error.message` would now
 * carry the query's parameters: password hashes, encrypted secrets, test data.
 *
 * Rather than teach dozens of call sites to look through `.cause`, and hope the next one is
 * written that way too, the wrapper is taken off where it is put on: the one method every Postgres
 * query of both drivers (node-postgres and PGlite) goes through. What the application sees is what
 * it saw before the upgrade — the Postgres error, with its SQLSTATE `code` and its own message.
 *
 * It is drizzle's internal method, so this checks that it is still there and refuses to start if
 * not: an upgrade that moves it must fail here, not quietly bring the SQL back into the logs.
 * db-errors.test.ts holds both properties to account.
 */
export function unwrapDrizzleQueryErrors(): void {
  const prototype = PgPreparedQuery.prototype as unknown as {
    queryWithCache?: (...args: unknown[]) => Promise<unknown>;
    __unwrapsQueryErrors?: boolean;
  };
  if (prototype.__unwrapsQueryErrors) return;
  const original = prototype.queryWithCache;
  if (typeof original !== 'function') {
    throw new Error(
      'drizzle-orm no longer has PgPreparedQuery.prototype.queryWithCache, which server/db-errors.ts relies on to ' +
        'keep SQL and parameters out of error messages. Update server/db-errors.ts for this drizzle-orm version.',
    );
  }
  prototype.queryWithCache = async function queryWithCacheUnwrapped(this: unknown, ...args: unknown[]) {
    try {
      return await original.apply(this, args);
    } catch (error) {
      if (error instanceof DrizzleQueryError && error.cause) throw error.cause;
      throw error;
    }
  };
  prototype.__unwrapsQueryErrors = true;
}

/** The SQLSTATE of a database error, when it is one: '23505' unique, '23503' foreign key, '42501' privilege. */
export function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
