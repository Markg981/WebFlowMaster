import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { organizations, users, userSettings } from '../../shared/schema';
import { privilegedDb } from '../platform/db';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { getOrCreateUserSettings, saveUserSettings } from './user-settings';

/**
 * Called straight rather than through supertest: the HTTP round trips space the requests out
 * enough that the old select-then-insert never collided, while these calls interleave the way
 * the client's simultaneous first-login reads do.
 */

let organizationId: number;
let userId: number;

beforeAll(async () => {
  organizationId = await createTestOrganization('User settings');
  userId = await createTestUser(organizationId, 'user-settings-race');
});

afterAll(async () => {
  // user_settings goes with the user (ON DELETE CASCADE).
  await privilegedDb.delete(users).where(eq(users.id, userId));
  await privilegedDb.delete(organizations).where(eq(organizations.id, organizationId));
});

async function rowsFor(id: number) {
  return privilegedDb.select().from(userSettings).where(eq(userSettings.userId, id));
}

describe('user settings', () => {
  it('creates one row for concurrent first reads, and every read gets it', async () => {
    await privilegedDb.delete(userSettings).where(eq(userSettings.userId, userId));

    const read = await Promise.all(
      Array.from({ length: 5 }, () => getOrCreateUserSettings(userId)),
    );

    for (const settings of read) expect(settings).toMatchObject({ userId, theme: 'light' });
    expect(await rowsFor(userId)).toHaveLength(1);
  });

  it('lets a save race the first read without losing the saved value', async () => {
    await privilegedDb.delete(userSettings).where(eq(userSettings.userId, userId));

    await Promise.all([
      getOrCreateUserSettings(userId),
      saveUserSettings(userId, { theme: 'dark' }),
    ]);

    const [row] = await rowsFor(userId);
    expect(row.theme).toBe('dark');
  });
});
