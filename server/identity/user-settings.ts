import { eq } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod';
import { userSettings } from '@shared/schema';
import { privilegedDb } from '../platform/db';

/**
 * A person's own preferences: theme, language, the browser the recorder opens.
 *
 * Through the privileged handle on purpose. user_settings is keyed by the user, not by an
 * organization, and app_user is not granted it at all (migration 0006), so there is no
 * tenant transaction it could run in. That is also why this lives here and not in
 * server/http/routes/, where no module may import the handle (server/tests/architecture.test.ts).
 */

export const userSettingsBodySchema = createInsertSchema(userSettings).omit({
  userId: true,
  updatedAt: true,
});

export type UserSettingsInput = z.infer<typeof userSettingsBodySchema>;

const DEFAULT_SETTINGS = {
  theme: 'light',
  defaultTestUrl: '',
  playwrightBrowser: 'chromium',
  playwrightHeadless: true,
  playwrightDefaultTimeout: 30000,
  playwrightWaitTime: 1000,
  language: 'en',
} as const;

async function findSettings(userId: number) {
  const [row] = await privilegedDb
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return row;
}

/**
 * The person's settings, created with the defaults the first time they are asked for.
 *
 * The client fires several GETs at once on the first login, so the insert gives way to a
 * concurrent one instead of failing on the primary key; the loser reads the winner's row.
 */
export async function getOrCreateUserSettings(userId: number) {
  const existing = await findSettings(userId);
  if (existing) return existing;
  const [created] = await privilegedDb
    .insert(userSettings)
    .values({ ...DEFAULT_SETTINGS, userId })
    .onConflictDoNothing({ target: userSettings.userId })
    .returning();
  return created ?? (await findSettings(userId))!;
}

/** One statement, so a save racing the first GET (or another save) cannot hit the key. */
export async function saveUserSettings(userId: number, input: UserSettingsInput) {
  const [saved] = await privilegedDb
    .insert(userSettings)
    .values({ ...input, userId })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...input, updatedAt: new Date() },
    })
    .returning();
  return saved;
}
