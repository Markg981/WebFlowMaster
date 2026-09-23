/**
 * A run, in the one format every CI system already understands.
 *
 * Jenkins, GitHub Actions, GitLab, Azure Pipelines, Bamboo and TeamCity all read JUnit XML,
 * and none of them read this product's report. Without it, a pipeline can start a run and
 * learn whether it passed, and that is all: which test failed, and why, stays behind a login
 * in a web page nobody opens from a build log.
 *
 * Suites are browsers. A plan covering Chromium and Firefox produces two of them, so a CI
 * report shows "Firefox: 2 failed" rather than one flat list in which the same test name
 * appears twice with different verdicts and no way to tell them apart.
 */

export interface JUnitResultRow {
  testName: string;
  status: string;
  browser?: string | null;
  reasonForFailure?: string | null;
  durationMs?: number | null;
  module?: string | null;
  component?: string | null;
  testType?: string | null;
  startedAt?: Date | string | null;
  /** In quarantine when it ran: a failure is reported as a skip, so it does not turn the build red. */
  quarantined?: boolean | null;
}

export interface JUnitInput {
  planName: string;
  executionId: string;
  startedAt?: Date | string | null;
  results: JUnitResultRow[];
}

/** Where a run with no browser recorded goes, which is every run made before the matrix. */
const DEFAULT_SUITE = 'default';

/**
 * XML 1.0 forbids most control characters outright — they cannot be escaped, only removed,
 * and a single one of them makes the whole document unparseable to the CI that reads it.
 * A failure message is the likeliest place for one: it can contain anything a page rendered.
 */
function stripInvalidXmlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

export function escapeXml(value: unknown): string {
  return stripInvalidXmlChars(String(value ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Seconds, as JUnit counts time. */
function seconds(durationMs: number | null | undefined): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return '0';
  return (durationMs / 1000).toFixed(3);
}

function timestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * How a result maps onto JUnit's vocabulary.
 *
 * `Error` becomes an `<error>` rather than a `<failure>` because the distinction is the one
 * CI dashboards already draw: a failure is the application disagreeing with the test, an
 * error is the test never getting to ask.
 */
type Verdict = 'passed' | 'failure' | 'error' | 'skipped';

export function verdictFor(status: string): Verdict {
  switch (status) {
    case 'Passed':
    case 'passed':
      return 'passed';
    case 'Failed':
    case 'failed':
      return 'failure';
    case 'Skipped':
    case 'skipped':
    case 'Pending':
    case 'pending':
      return 'skipped';
    default:
      return 'error';
  }
}

/**
 * The class a test is filed under.
 *
 * CI systems group and de-duplicate by `classname`, so it carries the plan's own taxonomy —
 * module and component, when a test has them — rather than being left blank.
 */
function classNameFor(row: JUnitResultRow): string {
  const parts = [row.module, row.component].filter((part): part is string => !!part && part.trim() !== '');
  return parts.length > 0 ? parts.join('.') : 'webflowmaster';
}

export function buildJUnitXml(input: JUnitInput): string {
  const suites = new Map<string, JUnitResultRow[]>();
  for (const row of input.results) {
    const suite = row.browser?.trim() || DEFAULT_SUITE;
    const existing = suites.get(suite);
    if (existing) existing.push(row);
    else suites.set(suite, [row]);
  }

  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0, timeMs: 0 };
  const suiteXml: string[] = [];

  for (const [suiteName, rows] of suites) {
    const counts = { failures: 0, errors: 0, skipped: 0, timeMs: 0 };
    const cases: string[] = [];

    for (const row of rows) {
      const raw = verdictFor(row.status);
      // A quarantined test's failure is a skip to CI, with the failure in its message. A CI
      // system has no "failed but does not count", and a failure it sees fails the build.
      const quarantinedFailure = !!row.quarantined && (raw === 'failure' || raw === 'error');
      const verdict: Verdict = quarantinedFailure ? 'skipped' : raw;
      const duration = typeof row.durationMs === 'number' ? row.durationMs : 0;
      counts.timeMs += duration;
      if (verdict === 'failure') counts.failures++;
      if (verdict === 'error') counts.errors++;
      if (verdict === 'skipped') counts.skipped++;

      const attributes =
        `name="${escapeXml(row.testName)}" classname="${escapeXml(classNameFor(row))}" ` +
        `time="${seconds(duration)}"`;

      if (verdict === 'passed') {
        cases.push(`    <testcase ${attributes} />`);
        continue;
      }
      if (quarantinedFailure) {
        const reason = row.reasonForFailure?.trim() || `Test ${row.status.toLowerCase()}`;
        const message = `In quarantine; it ${row.status.toLowerCase()}: ${firstLine(reason)}`;
        cases.push(
          `    <testcase ${attributes}>\n` +
            `      <skipped message="${escapeXml(firstLine(message))}" />\n` +
            `      <system-out>${escapeXml(reason)}</system-out>\n` +
            `    </testcase>`,
        );
        continue;
      }
      if (verdict === 'skipped') {
        cases.push(`    <testcase ${attributes}>\n      <skipped />\n    </testcase>`);
        continue;
      }

      const tag = verdict === 'error' ? 'error' : 'failure';
      // The reason twice: as the attribute a dashboard shows in its list, and as the body a
      // developer expands. A message attribute alone is routinely truncated to one line.
      const reason = row.reasonForFailure?.trim() || `Test ${row.status.toLowerCase()}`;
      cases.push(
        `    <testcase ${attributes}>\n` +
          `      <${tag} message="${escapeXml(firstLine(reason))}" type="${tag}">${escapeXml(reason)}</${tag}>\n` +
          `    </testcase>`,
      );
    }

    totals.tests += rows.length;
    totals.failures += counts.failures;
    totals.errors += counts.errors;
    totals.skipped += counts.skipped;
    totals.timeMs += counts.timeMs;

    const suiteTimestamp = timestamp(rows[0]?.startedAt ?? input.startedAt);
    suiteXml.push(
      `  <testsuite name="${escapeXml(suiteName)}" tests="${rows.length}" failures="${counts.failures}" ` +
        `errors="${counts.errors}" skipped="${counts.skipped}" time="${seconds(counts.timeMs)}"` +
        `${suiteTimestamp ? ` timestamp="${escapeXml(suiteTimestamp)}"` : ''}>\n` +
        `${cases.join('\n')}${cases.length > 0 ? '\n' : ''}` +
        `  </testsuite>`,
    );
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="${escapeXml(input.planName)}" tests="${totals.tests}" failures="${totals.failures}" ` +
    `errors="${totals.errors}" skipped="${totals.skipped}" time="${seconds(totals.timeMs)}">\n` +
    `${suiteXml.join('\n')}${suiteXml.length > 0 ? '\n' : ''}` +
    `</testsuites>\n`
  );
}

function firstLine(value: string): string {
  const [line] = value.split('\n');
  return line.length > 300 ? `${line.slice(0, 297)}…` : line;
}
