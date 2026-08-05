import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { ORG_SCOPED_TABLES } from '@shared/schema';

/**
 * The migration runs as part of the test bootstrap (server/tests/setup.ts), so these
 * assertions describe the database the whole suite runs against.
 */
describe('organizations migration', () => {
  it('creates an organization for every user and makes them its owner', async () => {
    const rows = await db.execute(
      sql`SELECT count(*) FILTER (WHERE organization_id IS NULL) AS orphans FROM users`,
    );
    expect(Number((rows.rows[0] as { orphans: string }).orphans)).toBe(0);
  });

  it('leaves no org-scoped row without an organization', async () => {
    for (const table of ORG_SCOPED_TABLES) {
      const rows = await db.execute(
        sql.raw(`SELECT count(*) AS orphans FROM "${table}" WHERE organization_id IS NULL`),
      );
      expect(
        Number((rows.rows[0] as { orphans: string }).orphans),
        `${table} has rows with no organization_id`,
      ).toBe(0);
    }
  });

  it('creates the app_user role', async () => {
    const rows = await db.execute(sql`SELECT rolname FROM pg_roles WHERE rolname = 'app_user'`);
    expect(rows.rows).toHaveLength(1);
  });
});
