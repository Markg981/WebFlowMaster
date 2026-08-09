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

let fixtureUserCounter = 0;

/**
 * Creates a user in the given organization and returns its id.
 *
 * Same reasoning as createTestOrganization for using the privileged handle: fixtures run
 * before any tenant context exists, and establishing one would make the test depend on the
 * isolation it is trying to exercise. The default username is suffixed with a counter because
 * `users.username` has a unique constraint: a second defaulted call in the same test run would
 * otherwise collide and surface as an opaque unique-violation error.
 */
export async function createTestUser(organizationId: number, username?: string): Promise<number> {
  const resolvedUsername = username ?? `fixture_user_${++fixtureUserCounter}`;
  const rows = await privilegedDb.execute(
    sql`INSERT INTO users (username, password, organization_id) VALUES (${resolvedUsername}, 'fixture_password', ${organizationId}) RETURNING id`,
  );
  return Number((rows.rows[0] as { id: number }).id);
}
