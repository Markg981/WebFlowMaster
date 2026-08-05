import { sql } from 'drizzle-orm';
// TODO(Task 2): server/db.ts renames this export to `privilegedDb`. Switch this import
// (and the reference below) when that rename lands.
import { db as privilegedDb } from '../db';

/**
 * Creates an organization and returns its id.
 *
 * Uses the privileged handle deliberately: fixtures run before any tenant context exists,
 * and setting one up would make every test depend on the very isolation it is trying to
 * exercise.
 */
export async function createTestOrganization(name = 'Test Organization'): Promise<number> {
  const rows = await privilegedDb.execute(
    sql`INSERT INTO organizations (name) VALUES (${name}) RETURNING id`,
  );
  return Number((rows.rows[0] as { id: number }).id);
}
