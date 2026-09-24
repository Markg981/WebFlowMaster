import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from './db';
import { sqlState } from './db-errors';

/**
 * A failed query reaches the application as the database's own error (server/db-errors.ts).
 *
 * If a drizzle-orm upgrade brings its wrapper back, these fail: duplicates and missing references
 * would turn into 500s, and the SQL with its parameters would reach logs and answers.
 */
describe('database errors', () => {
  it('keep their SQLSTATE and the database’s own message', async () => {
    const error = await privilegedDb
      .execute(sql`INSERT INTO organizations (id, name) VALUES (-1, 'a'), (-1, 'b')`)
      .catch((caught: unknown) => caught);

    expect(sqlState(error)).toBe('23505');
    expect((error as Error).message).toMatch(/duplicate key/i);
  });

  it('never carry the query or its parameters in their message', async () => {
    const secret = 'do-not-log-this-value';
    const error = await privilegedDb
      .execute(sql`SELECT * FROM no_such_table WHERE value = ${secret}`)
      .catch((caught: unknown) => caught);

    const message = (error as Error).message;
    expect(message).not.toMatch(/Failed query/);
    expect(message).not.toContain(secret);
    expect(sqlState(error)).toBe('42P01');
  });

  it('come out of a transaction the same way', async () => {
    const error = await privilegedDb
      .transaction((tx) => tx.execute(sql`SELECT 1/0`))
      .catch((caught: unknown) => caught);

    expect(sqlState(error)).toBe('22012');
    expect((error as Error).message).not.toMatch(/Failed query/);
  });
});
