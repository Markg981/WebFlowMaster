import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';

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

/**
 * Creates a user in the given organization and returns its id.
 *
 * Same reasoning as createTestOrganization for using the privileged handle: fixtures run
 * before any tenant context exists, and establishing one would make the test depend on the
 * isolation it is trying to exercise. `username` must be unique per call site when a test
 * seeds more than one user (e.g. one per organization).
 */
export async function createTestUser(organizationId: number, username = 'fixture_user'): Promise<number> {
  const rows = await privilegedDb.execute(
    sql`INSERT INTO users (username, password, organization_id) VALUES (${username}, 'fixture_password', ${organizationId}) RETURNING id`,
  );
  return Number((rows.rows[0] as { id: number }).id);
}
