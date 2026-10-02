import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { userSettings, users, testPlanExecutions, testPlans } from '@shared/schema';
import { getTenantOrgId } from './middleware/tenancy';
import { isEmailAddress, mailConfigured, sendMail } from './mailer';
import { runFinishedMail } from './mail-messages';
import { shouldNotify, type NotificationSettings, type RunSummary } from './notifications';

/**
 * E-mail when a run ends: to the addresses the plan's notification settings list, when its
 * switches say so for this outcome, and to the person who started the run, when their own
 * settings say so (Settings → Notifications).
 *
 * users and user_settings are read through the privileged handle: neither is organization data
 * (user_settings is not even granted to app_user), and the person is named by the run itself.
 */

const FAILED = new Set(['failed', 'error', 'timed_out']);

/** The person's own switches for this outcome: completion covers every end, failures only failures. */
export function personWantsMail(
  prefs: { notifyByEmail: boolean; notifyRunCompleted: boolean; notifyRunFailed: boolean } | undefined,
  status: string,
): boolean {
  if (!prefs?.notifyByEmail) return false;
  if (status === 'completed') return prefs.notifyRunCompleted;
  if (FAILED.has(status)) return prefs.notifyRunCompleted || prefs.notifyRunFailed;
  return false;
}

export interface RunMailOutcome {
  to: string;
  sent: boolean;
  error?: string;
}

export async function mailRunFinished(
  settings: NotificationSettings,
  requestedByUserId: number | null | undefined,
  summary: RunSummary,
): Promise<RunMailOutcome[]> {
  if (!mailConfigured()) return [];
  let organizationId = getTenantOrgId() ?? null;
  if (organizationId === null) {
    const [execution] = await privilegedDb.select({ organizationId: testPlanExecutions.organizationId }).from(testPlanExecutions).where(eq(testPlanExecutions.id, summary.executionId)).limit(1);
    const [plan] = execution ? [] : await privilegedDb.select({ organizationId: testPlans.organizationId }).from(testPlans).where(eq(testPlans.id, summary.planId)).limit(1);
    organizationId = execution?.organizationId ?? plan?.organizationId ?? null;
  }
  const recipients = new Set<string>();
  if (shouldNotify(settings, summary.status)) {
    for (const address of settings.emails ?? []) if (isEmailAddress(address?.trim())) recipients.add(address.trim().toLowerCase());
  }
  if (requestedByUserId) {
    const [person] = await privilegedDb
      .select({ username: users.username, kind: users.kind, organizationId: users.organizationId, notifyByEmail: userSettings.notifyByEmail, notifyRunCompleted: userSettings.notifyRunCompleted, notifyRunFailed: userSettings.notifyRunFailed })
      .from(users)
      .leftJoin(userSettings, eq(userSettings.userId, users.id))
      .where(eq(users.id, requestedByUserId))
      .limit(1);
    const prefs = person && person.notifyByEmail !== null
      ? { notifyByEmail: person.notifyByEmail, notifyRunCompleted: person.notifyRunCompleted!, notifyRunFailed: person.notifyRunFailed! }
      : undefined;
    if (organizationId === null) organizationId = person?.organizationId ?? null;
    if (person && person.organizationId === organizationId && person.kind === 'person' && isEmailAddress(person.username) && personWantsMail(prefs, summary.status)) {
      recipients.add(person.username.toLowerCase());
    }
  }
  const outcomes: RunMailOutcome[] = [];
  for (const to of Array.from(recipients)) {
    const result = await sendMail(runFinishedMail(to, summary, organizationId));
    outcomes.push({ to, ...result });
  }
  return outcomes;
}
