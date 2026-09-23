import { reportUrlFor } from './report-links';
import type { IssueDraft } from './issue-providers';

/**
 * What gets filed, and whether it has been filed before.
 *
 * No network and no database here: this decides what an issue says, and what makes two
 * failures the same failure. Both are judgements, and both are worth being able to test
 * without a Jira.
 *
 * The one that matters is the second. A nightly plan that fails for a week would otherwise
 * open seven identical issues, and by the eighth morning nobody reads any of them — so "the
 * same failure" is defined once, here, as this plan, this test, this browser.
 */

export interface FailureContext {
  planId?: string | null;
  planName?: string | null;
  executionId: string;
  testName: string;
  browser?: string | null;
  /** 'Failed' or 'Error', as the report records it. */
  status: string;
  reason?: string | null;
  startedAt?: Date | string | null;
}

/** How much of a stack trace or a Playwright message is worth putting in an issue. */
const MAX_REASON_CHARS = 2000;
/** Both trackers accept more, but a title that does not fit on one line is not a title. */
const MAX_TITLE_CHARS = 200;

/**
 * What makes two failures the same failure.
 *
 * The browser is part of it because a test that fails only on WebKit is a different problem
 * from one that fails everywhere, and filing them together loses exactly the fact that
 * distinguishes them. The plan is part of it because the same test in a smoke plan and in a
 * nightly regression is usually two people's business.
 *
 * An ad-hoc run has no plan, so it files under 'adhoc' — the alternative, filing every manual
 * re-run as a fresh issue, is the duplicate storm this exists to prevent.
 */
export function dedupeKeyFor(input: { planId?: string | null; testName: string; browser?: string | null }): string {
  const plan = input.planId?.trim() || 'adhoc';
  const browser = input.browser?.trim() || 'default';
  return `${plan}::${input.testName.trim()}::${browser}`;
}

/** The failures in a run's results — a test that failed, and one that never ran. */
export function failuresOf<T extends { status: string }>(rows: T[]): T[] {
  return rows.filter((row) => {
    const status = String(row.status).toLowerCase();
    return status === 'failed' || status === 'error';
  });
}

export function issueTitle(failure: FailureContext): string {
  const where = failure.browser ? ` on ${failure.browser}` : '';
  const plan = failure.planName ? ` — ${failure.planName}` : '';
  const verb = String(failure.status).toLowerCase() === 'error' ? 'could not run' : 'fails';
  return `${failure.testName} ${verb}${where}${plan}`.slice(0, MAX_TITLE_CHARS);
}

/**
 * The body, written for somebody who was not watching the run.
 *
 * Everything needed to decide whether this is worth looking at, and a link to the evidence
 * rather than a copy of it: the report holds the screenshots, the video and the trace, and an
 * issue that tries to carry those becomes an issue nobody can read.
 */
export function issueBody(failure: FailureContext, productName = 'WebFlowMaster'): string {
  const lines: string[] = [];
  lines.push(
    failure.planName
      ? `The test "${failure.testName}" failed in the plan "${failure.planName}".`
      : `The test "${failure.testName}" failed.`,
  );
  if (failure.browser) lines.push(`Browser: ${failure.browser}`);
  lines.push(`Status: ${failure.status}`);
  if (failure.startedAt) lines.push(`Started: ${asIsoString(failure.startedAt)}`);

  const url = reportUrlFor(failure.planId, failure.executionId);
  lines.push(url ? `Report: ${url}` : `Run: ${failure.executionId}`);

  if (failure.reason && failure.reason.trim() !== '') {
    lines.push('');
    lines.push('Reason given by the run:');
    lines.push(truncate(failure.reason.trim(), MAX_REASON_CHARS));
  }

  lines.push('');
  lines.push(
    `Filed by ${productName}. Further failures of the same test, browser and plan are added ` +
      `to this issue as comments rather than opened as new ones.`,
  );
  return lines.join('\n');
}

export function issueDraftFor(failure: FailureContext, productName?: string): IssueDraft {
  return { title: issueTitle(failure), body: issueBody(failure, productName) };
}

/**
 * What the second, fifth and twentieth occurrence say.
 *
 * The count is the point: an issue that says it has happened twenty times since Tuesday is
 * making an argument that twenty separate issues cannot.
 */
export function recurrenceComment(failure: FailureContext, occurrences: number): string {
  const url = reportUrlFor(failure.planId, failure.executionId);
  const where = failure.browser ? ` on ${failure.browser}` : '';
  return [
    `Failed again${where} (occurrence ${occurrences}).`,
    failure.reason ? `Reason: ${truncate(failure.reason.trim(), 500)}` : '',
    url ? `Report: ${url}` : `Run: ${failure.executionId}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * What a return to green says.
 *
 * Deliberately a comment and not a transition: whether this issue should now be closed depends
 * on what else is in it and on how the team works, and a robot that closes somebody's bug
 * because one run went green is a robot they turn off.
 */
export function resolvedComment(failure: FailureContext): string {
  const url = reportUrlFor(failure.planId, failure.executionId);
  const where = failure.browser ? ` on ${failure.browser}` : '';
  return [
    `This test passed again${where}.`,
    url ? `Report: ${url}` : `Run: ${failure.executionId}`,
    'Left open on purpose: whether the underlying problem is fixed is not something a single green run can say.',
  ].join('\n');
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}… (truncated)`;
}

function asIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
