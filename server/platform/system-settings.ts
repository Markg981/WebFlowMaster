import { eq } from 'drizzle-orm';
import { systemSettings } from '@shared/schema';
import { privilegedDb } from './db';

/**
 * Installation-wide settings (logRetentionDays, logLevel, clientLogLevel, workspaceName).
 *
 * Through the privileged handle on purpose: system_settings has no organization, so there is
 * no tenant it could be read under, and app_user is not granted it (migration 0006). Kept out
 * of server/http/routes/ for that reason, like server/identity/user-settings.ts.
 */

export function listSystemSettings() {
  return privilegedDb.select().from(systemSettings);
}

export async function getSystemSetting(key: string) {
  const [row] = await privilegedDb
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  return row;
}

/** Writes the value under the key, creating it if it is new, and returns the stored row. */
export async function upsertSystemSetting(key: string, value: string | null) {
  const [row] = await privilegedDb
    .insert(systemSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value } })
    .returning();
  return row;
}
