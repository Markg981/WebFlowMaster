import { and, eq } from 'drizzle-orm';
import { issueLinks, issueTrackers, type IssueLink, type IssueProvider, type IssueTracker } from '@shared/schema';
import { withTenantTransaction } from './middleware/tenancy';
import { decryptSecret } from './crypto';
import { addComment, createIssue, type ProviderDeps, type TrackerConfig } from './issue-providers';
import { dedupeKeyFor, issueDraftFor, recurrenceComment, resolvedComment, type FailureContext } from './issue-tracking';

/**
 * Filing a failure, once.
 *
 * The database half of issue tracking: find out whether this failure has been filed before,
 * file it or comment on what exists, and write down which issue belongs to which failure.
 *
 * Nothing here throws at the caller. Both callers — a run that has already produced its verdict,
 * and a report page — must survive a tracker that is down, a token that has expired, or a
 * project somebody renamed. A failure to file is reported as an outcome and never as an
 * exception, for the same reason a notification that cannot be delivered does not fail a run.
 */

export type FileAction = 'created' | 'commented' | 'skipped' | 'failed';

export interface FileIssueOutcome {
  action: FileAction;
  issueKey?: string;
  issueUrl?: string;
  occurrences?: number;
  /** Why nothing was filed, when nothing was filed. Usually a choice, not a fault. */
  reason?: string;
  error?: string;
}

/** The tracker as the provider layer needs it: same row, with the token in the clear. */
export function toConfig(tracker: IssueTracker): TrackerConfig {
  return {
    provider: tracker.provider as IssueProvider,
    baseUrl: tracker.baseUrl,
    projectKey: tracker.projectKey,
    issueType: tracker.issueType,
    userEmail: tracker.userEmail,
    token: decryptSecret(tracker.encryptedToken, tracker.tokenIv, tracker.tokenAuthTag),
  };
}

/** The tracker a plan names, or nothing — RLS decides which trackers exist to be named. */
export async function loadTracker(trackerId: string): Promise<IssueTracker | null> {
  const [tracker] = await withTenantTransaction((tx) =>
    tx.select().from(issueTrackers).where(eq(issueTrackers.id, trackerId)).limit(1),
  );
  return tracker ?? null;
}

/** The issue already filed for this failure, if there is one. */
export async function findLink(trackerId: string, dedupeKey: string): Promise<IssueLink | null> {
  const [link] = await withTenantTransaction((tx) =>
    tx
      .select()
      .from(issueLinks)
      .where(and(eq(issueLinks.trackerId, trackerId), eq(issueLinks.dedupeKey, dedupeKey)))
      .limit(1),
  );
  return link ?? null;
}

function isUniqueViolation(error: any): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('unique') || error?.code === '23505';
}

/**
 * Files the failure, or says it again on the issue that already has it.
 *
 * The provider call happens outside any transaction on purpose: holding a database transaction
 * open across a request to somebody else's Jira means holding a row lock for however long
 * their slowest day takes.
 */
export async function fileFailure(
  input: {
    organizationId: number;
    tracker: IssueTracker;
    failure: FailureContext;
    uiTestId?: number | null;
  },
  deps: ProviderDeps = {},
): Promise<FileIssueOutcome> {
  const dedupeKey = dedupeKeyFor(input.failure);

  try {
    const config = toConfig(input.tracker);
    const existing = await findLink(input.tracker.id, dedupeKey);

    if (existing) {
      const occurrences = existing.occurrences + 1;
      await addComment(config, existing.issueKey, recurrenceComment(input.failure, occurrences), deps);
      await withTenantTransaction((tx) =>
        tx
          .update(issueLinks)
          .set({
            occurrences,
            lastExecutionId: input.failure.executionId,
            // It is failing again, so it is not resolved again. The issue itself is left
            // however the team left it.
            resolvedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(issueLinks.id, existing.id))
          // returning(): the tenant transaction type does not accept an update with no result.
          .returning(),
      );
      return { action: 'commented', issueKey: existing.issueKey, issueUrl: existing.issueUrl, occurrences };
    }

    const created = await createIssue(config, issueDraftFor(input.failure), deps);

    try {
      await withTenantTransaction((tx) =>
        tx.insert(issueLinks).values({
          organizationId: input.organizationId,
          trackerId: input.tracker.id,
          dedupeKey,
          testPlanId: input.failure.planId ?? null,
          uiTestId: input.uiTestId ?? null,
          testName: input.failure.testName,
          browser: input.failure.browser ?? null,
          issueKey: created.key,
          issueUrl: created.url,
          firstExecutionId: input.failure.executionId,
          lastExecutionId: input.failure.executionId,
        }),
      );
    } catch (error: any) {
      if (!isUniqueViolation(error)) throw error;
      // Two runs of the same plan filed the same failure at the same instant. The issue that
      // lost the race exists in the tracker and is reported here rather than swallowed: a
      // duplicate somebody can see is recoverable, one nothing mentions is not.
      return {
        action: 'created',
        issueKey: created.key,
        issueUrl: created.url,
        reason: 'Another run filed this failure at the same time; both issues exist.',
      };
    }

    return { action: 'created', issueKey: created.key, issueUrl: created.url, occurrences: 1 };
  } catch (error: any) {
    return { action: 'failed', error: error?.message ?? String(error) };
  }
}

/**
 * Says on the issue that the test passed again, and remembers that it did.
 *
 * Only ever a comment. Whether the bug is fixed depends on what else is in that issue and on
 * how the team works, and software that closes somebody's ticket because one run went green is
 * software they turn off.
 */
export async function markResolved(
  input: { tracker: IssueTracker; failure: FailureContext },
  deps: ProviderDeps = {},
): Promise<FileIssueOutcome> {
  const dedupeKey = dedupeKeyFor(input.failure);

  try {
    const existing = await findLink(input.tracker.id, dedupeKey);
    if (!existing) return { action: 'skipped', reason: 'Nothing was ever filed for this test.' };
    if (existing.resolvedAt) return { action: 'skipped', reason: 'Already reported as passing again.' };

    await addComment(toConfig(input.tracker), existing.issueKey, resolvedComment(input.failure), deps);
    await withTenantTransaction((tx) =>
      tx
        .update(issueLinks)
        .set({ resolvedAt: new Date(), lastExecutionId: input.failure.executionId, updatedAt: new Date() })
        .where(eq(issueLinks.id, existing.id))
        .returning(),
    );
    return { action: 'commented', issueKey: existing.issueKey, issueUrl: existing.issueUrl };
  } catch (error: any) {
    return { action: 'failed', error: error?.message ?? String(error) };
  }
}
