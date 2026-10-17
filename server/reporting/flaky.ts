/**
 * Which tests disagree with themselves.
 *
 * A suite's worst failure mode is not a test that fails, it is a test that fails sometimes.
 * The report says "Failed" one night and "Passed" the next, and each run is read on its own —
 * so the same unreliable test is investigated again and again, and eventually believed less
 * than it should be, which is how a real failure gets waved through as "that one is flaky".
 *
 * Nothing here decides *why* a test is unreliable. It counts what happened, in order, and puts
 * the tests that changed their mind most often at the top. That is a question a person can
 * then answer; "is this flaky?" is not a question the data can answer on its own.
 */

export interface FlakyInputRow {
  testName: string;
  browser?: string | null;
  status: string;
  /** Chronology is the whole measurement: order is what makes a flip a flip. */
  startedAt: Date | string;
  testPlanExecutionId?: string | null;
  durationMs?: number | null;
  /**
   * Which version of the test produced this result, when the run recorded one.
   *
   * Null on everything written before results carried a version, and on API and mobile tests. Two nulls
   * are read as the same unknown version: an unrecorded version cannot explain a change of
   * verdict, so historical data is counted exactly the way it always was.
   */
  testVersion?: number | null;
  /** The test itself, when the result still points at it: what quarantining it needs. */
  uiTestId?: number | null;
  apiTestId?: number | null;
  mobileTestId?: number | null;
  /** How many tries the run made before this result stood. 1, or absent, for a single try. */
  attempts?: number | null;
  /**
   * What the version executes (server/authoring/executable-definition.ts), when it is known: two
   * versions that run the same thing are compared, and the same version number with a different
   * one is not. Absent, the version number stands in for it.
   */
  definition?: string | null;
  /** The plan the run belongs to, for the link to its report. */
  planId?: string | null;
  /** The matrix the result came from, as far as the run recorded it. */
  environment?: string | null;
  locale?: string | null;
  device?: string | null;
  /** The manifest unit and the attempt that decided it (P07); null on results written before. */
  unitId?: string | null;
  unitAttempt?: number | null;
  /**
   * The first try of this run that did not pass, from its attempt record — only when one was
   * recorded. A legacy result keeps only its attempt count, and its first failure stays unknown.
   */
  firstFailure?: { attempt: number; status: string | null; reason: string | null } | null;
}

/** Where a signal can be looked at: the run, and the attempt of it that shows the thing. */
export interface FlakyEvidence {
  executionId: string | null;
  planId: string | null;
  unitId: string | null;
  /** The attempt that shows it; null when the result predates attempt records. */
  attempt: number | null;
}

/**
 * One thing that happened, kept apart from the others because each asks a different question.
 *
 * - recovered: failed, then passed when the run tried again. A pass, and a finding.
 * - flip: the verdict changed from the run before with the same definition.
 * - error: the run never reached a verdict — a browser that did not start, a blocked setup.
 * - definition_changed: the test executes something else from here on.
 */
export interface FlakySignal extends FlakyEvidence {
  kind: 'recovered' | 'flip' | 'error' | 'definition_changed';
  at: string;
  version: number | null;
  /** recovered: how many tries the run took. */
  attempts?: number;
  /** recovered: why the first try failed, as recorded; null when it was not. */
  cause?: string | null;
  /** recovered: false for a legacy result, which only kept how many tries it took. */
  causeRecorded?: boolean;
  /** flip: the verdict it changed to. */
  verdict?: 'passed' | 'failed';
}

export interface FlakySummary {
  testName: string;
  /** The test behind the name, from its latest result that still points at one; null if deleted. */
  test: { type: 'ui' | 'api' | 'mobile'; id: number } | null;
  browser: string | null;
  /** The rest of the matrix this history is for; nulls where runs did not record it. */
  matrix: { environment: string | null; locale: string | null; device: string | null };
  runs: number;
  passed: number;
  failed: number;
  /** Runs that tried the test more than once, whatever they ended with. */
  retriedRuns: number;
  /**
   * Runs that passed only after a retry. Counted on their own, not as flips: three runs that each
   * passed on the second try never change verdict, and are as unreliable as a test can be.
   */
  recoveredByRetry: number;
  /** Runs that never produced a verdict — a browser that would not start, a blocked setup. */
  errored: number;
  /**
   * How many times the verdict changed from one run to the next.
   *
   * The measure, rather than "it has both passes and failures": a test that failed for a week
   * and has passed ever since was broken and is fixed, and has one flip. A test that alternates
   * has as many flips as it has runs, and is the one worth somebody's morning.
   */
  flips: number;
  /**
   * The flips that happened without the test changing underneath — the ones nobody can explain.
   *
   * A verdict that changed across an edit is explained by the edit: the test now does something
   * else, and calling that flakiness teaches people to distrust a measure that is telling them
   * the truth the rest of the time. Where no version was recorded on either side, the flip
   * counts here, because an unrecorded version explains nothing.
   */
  unexplainedFlips: number;
  /** Distinct versions this window saw, in order. One means the test never changed. */
  versions: number[];
  /** How many times what the test executes changed between two runs in the window. */
  definitionChanges: number;
  /** True when the test was edited inside the window, which is why some flips are explained. */
  changedDuringWindow: boolean;
  /**
   * The larger of unexplainedFlips / (runs - 1) and recoveredByRetry / runs, so a long history
   * and a short one rank together, and a test rescued by retries every night ranks with one that
   * alternates.
   *
   * Deliberately the unexplained flips: a test edited three times, changing verdict at each edit,
   * is not the test somebody should spend their morning on.
   */
  flakiness: number;
  lastStatus: 'passed' | 'failed';
  /** How many tries the last judged run took. */
  lastAttempts: number;
  firstSeen: string;
  lastSeen: string;
  /** What happened, newest first, each with the attempt that shows it. At most MAX_SIGNALS. */
  signals: FlakySignal[];
}

/** Enough to start from; the report of each run has the rest. */
export const MAX_SIGNALS = 20;

/** Only these two carry a verdict; everything else says the test never got to answer. */
function verdictOf(status: string): 'passed' | 'failed' | null {
  const normalised = status?.toLowerCase();
  if (normalised === 'passed') return 'passed';
  if (normalised === 'failed') return 'failed';
  return null;
}

function timeOf(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

/** The test a result belongs to, when the result still points at one. */
function testOf(row: FlakyInputRow): FlakySummary['test'] {
  if (row.uiTestId != null) return { type: 'ui', id: row.uiTestId };
  if (row.apiTestId != null) return { type: 'api', id: row.apiTestId };
  if (row.mobileTestId != null) return { type: 'mobile', id: row.mobileTestId };
  return null;
}

function keyOf(row: FlakyInputRow): string {
  // The test, not its name: two tests both called "Login" — one always passing, one always
  // failing — are two stable tests, and merging them by name reports one test that changes its
  // mind every run. The other way round, a renamed test keeps its history.
  // Results that no longer point at a test (written before results carried one, or whose test
  // was deleted) only have the name left, and are kept apart from the ones that do.
  const test = testOf(row);
  const identity = test ? [test.type, test.id] : ['legacy', row.testName];
  // The browser is part of the identity: "fails on WebKit, passes on Chromium" is a fact about
  // the application, not a test that cannot make its mind up, and merging the two would report
  // every cross-browser difference as flakiness.
  // A mobile test's "browser" is its device, so the same holds for a test that fails on one
  // phone and passes on another.
  // The rest of the matrix the same way: the same test against staging and production, or in
  // English and in Italian, is two histories. Where a run did not record a dimension, it is
  // an unknown kept apart from the known ones, never assumed to be one of them.
  return JSON.stringify([
    ...identity,
    row.browser ?? '',
    row.environment ?? '',
    row.locale ?? '',
    row.device ?? '',
  ]);
}

/**
 * What the run executed, as far as it can be told: the executable fingerprint, else the version
 * number, else nothing. Two nothings compare equal — an unrecorded definition explains nothing.
 */
function definitionOf(row: FlakyInputRow): string | null {
  if (row.definition) return `x:${row.definition}`;
  if (row.testVersion != null) return `v:${row.testVersion}`;
  return null;
}

function evidenceOf(row: FlakyInputRow, attempt: number | null): FlakyEvidence {
  return {
    executionId: row.testPlanExecutionId ?? null,
    planId: row.planId ?? null,
    unitId: row.unitId ?? null,
    attempt: row.unitId ? attempt : null,
  };
}

export interface FlakyOptions {
  /** Below this, a test has not been run enough times for "sometimes" to mean anything. */
  minimumRuns?: number;
  /** Only tests that changed their mind at least this often. */
  minimumFlips?: number;
}

/**
 * Groups results by test and matrix variant, in time order, and counts the changes of mind.
 *
 * Errors are counted and then stepped over rather than treated as failures: a run that could
 * not start a browser says nothing about whether the test is reliable, and letting it count as
 * a failure would manufacture two flips out of one bad night on the runner.
 *
 * Retries inside a run are their own signal. A run's verdict is its last attempt's, so a test
 * that fails and then passes on every run has a perfect history of passes and no flips: judged
 * on verdicts alone it vanished from this list exactly when it was flakiest. Such a test is
 * listed however short its history, because a single recovered run already shows it failing
 * and passing with nothing changed in between.
 */
export function summariseFlakiness(
  rows: FlakyInputRow[],
  options: FlakyOptions = {},
): FlakySummary[] {
  const minimumRuns = options.minimumRuns ?? 3;
  const minimumFlips = options.minimumFlips ?? 1;

  const groups = new Map<string, FlakyInputRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  const summaries: FlakySummary[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (left, right) => timeOf(left.startedAt) - timeOf(right.startedAt),
    );
    // Verdict and definition travel together: what produced a verdict is what decides whether
    // the next change of verdict is a surprise or a consequence.
    const judged: Array<{ verdict: 'passed' | 'failed'; row: FlakyInputRow }> = [];
    const signals: FlakySignal[] = [];
    let errored = 0;
    let retriedRuns = 0;
    let recoveredByRetry = 0;

    for (const row of ordered) {
      const at = new Date(timeOf(row.startedAt)).toISOString();
      const version = row.testVersion ?? null;
      const verdict = verdictOf(row.status);
      const attempts = Math.max(1, row.attempts ?? 1);
      if (!verdict) {
        errored++;
        signals.push({ kind: 'error', at, version, ...evidenceOf(row, row.unitAttempt ?? null) });
        continue;
      }
      if (attempts > 1) retriedRuns++;
      if (verdict === 'passed' && attempts > 1) {
        recoveredByRetry++;
        // The failed try is the one worth opening. Its cause only when it was recorded: a legacy
        // result knows it took two tries and nothing about why the first one failed.
        const first = row.unitId ? (row.firstFailure ?? null) : null;
        signals.push({
          kind: 'recovered',
          at,
          version,
          attempts,
          cause: first?.reason ?? null,
          causeRecorded: first !== null,
          ...evidenceOf(row, first?.attempt ?? null),
        });
      }
      judged.push({ verdict, row });
    }

    if (judged.length === 0) continue;

    let flips = 0;
    let unexplainedFlips = 0;
    let definitionChanges = 0;
    for (let i = 1; i < judged.length; i++) {
      const previous = judged[i - 1];
      const current = judged[i];
      const at = new Date(timeOf(current.row.startedAt)).toISOString();
      const version = current.row.testVersion ?? null;
      // Same definition on both sides — including two unknowns, since an unrecorded one cannot
      // account for anything.
      const sameDefinition = definitionOf(previous.row) === definitionOf(current.row);
      if (!sameDefinition) {
        definitionChanges++;
        signals.push({ kind: 'definition_changed', at, version, ...evidenceOf(current.row, null) });
      }
      if (current.verdict === previous.verdict) continue;
      flips++;
      if (!sameDefinition) continue;
      unexplainedFlips++;
      signals.push({
        kind: 'flip',
        at,
        version,
        verdict: current.verdict,
        ...evidenceOf(current.row, current.row.unitAttempt ?? null),
      });
    }
    // Filtered on the unexplained flips: a test whose every change of verdict followed an edit
    // has not disagreed with itself, and putting it on this list is how the list loses its
    // meaning. A recovery needs no history to count.
    const flipsCount = judged.length >= minimumRuns && unexplainedFlips >= minimumFlips;
    if (!flipsCount && recoveredByRetry === 0) continue;

    const versions = Array.from(
      new Set(
        judged
          .map((entry) => entry.row.testVersion ?? null)
          .filter((version): version is number => version !== null),
      ),
    ).sort((left, right) => left - right);

    const passed = judged.filter((entry) => entry.verdict === 'passed').length;
    const latest = ordered[ordered.length - 1];
    const lastJudged = judged[judged.length - 1];
    const flipRate = judged.length > 1 ? unexplainedFlips / (judged.length - 1) : 0;
    summaries.push({
      // The name it has now: a renamed test is listed under the name people will look for.
      testName: latest.testName,
      // Every row in the group points at the same test, or none does.
      test: testOf(latest),
      browser: ordered[0].browser ?? null,
      matrix: {
        environment: ordered[0].environment ?? null,
        locale: ordered[0].locale ?? null,
        device: ordered[0].device ?? null,
      },
      runs: judged.length,
      passed,
      failed: judged.length - passed,
      retriedRuns,
      recoveredByRetry,
      errored,
      flips,
      unexplainedFlips,
      versions,
      definitionChanges,
      changedDuringWindow: definitionChanges > 0,
      flakiness: Number(Math.max(flipRate, recoveredByRetry / judged.length).toFixed(3)),
      lastStatus: lastJudged.verdict,
      lastAttempts: Math.max(1, lastJudged.row.attempts ?? 1),
      firstSeen: new Date(timeOf(ordered[0].startedAt)).toISOString(),
      lastSeen: new Date(timeOf(latest.startedAt)).toISOString(),
      // Newest first; the sort is stable, so one run's signals keep their order.
      signals: signals
        .reverse()
        .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
        .slice(0, MAX_SIGNALS),
    });
  }

  // Most changeable first; ties broken by how much history says so, so a test that flipped
  // twice in three runs does not outrank one that flipped twenty times in thirty.
  return summaries.sort(
    (left, right) => right.flakiness - left.flakiness || right.flips - left.flips,
  );
}

/** One line for a run's console or a notification: what this run's flakiest tests are doing. */
export function describeFlakiness(summary: FlakySummary): string {
  const edited = summary.changedDuringWindow
    ? ` The test was edited in this window (versions ${summary.versions.join(', ')}), which accounts for ` +
      `${summary.flips - summary.unexplainedFlips} of them.`
    : '';
  const recovered = summary.recoveredByRetry
    ? ` ${summary.recoveredByRetry} of the passes needed a retry.`
    : '';
  return (
    `${summary.testName}${summary.browser ? ` (${summary.browser})` : ''}: ` +
    `${summary.passed} passed, ${summary.failed} failed over ${summary.runs} runs, ` +
    `changing verdict ${summary.flips} time${summary.flips === 1 ? '' : 's'}.${edited}${recovered}`
  );
}
