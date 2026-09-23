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
   * Null on everything written before results carried a version, and on API tests. Two nulls
   * are read as the same unknown version: an unrecorded version cannot explain a change of
   * verdict, so historical data is counted exactly the way it always was.
   */
  testVersion?: number | null;
}

export interface FlakySummary {
  testName: string;
  browser: string | null;
  runs: number;
  passed: number;
  failed: number;
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
  /** True when the test was edited inside the window, which is why some flips are explained. */
  changedDuringWindow: boolean;
  /**
   * unexplainedFlips / (comparable runs - 1), so a long history and a short one rank together.
   *
   * Deliberately the unexplained ones: a test edited three times, changing verdict at each edit,
   * is not the test somebody should spend their morning on.
   */
  flakiness: number;
  lastStatus: 'passed' | 'failed';
  firstSeen: string;
  lastSeen: string;
}

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

function keyOf(row: FlakyInputRow): string {
  // The browser is part of the identity: "fails on WebKit, passes on Chromium" is a fact about
  // the application, not a test that cannot make its mind up, and merging the two would report
  // every cross-browser difference as flakiness.
  return `${row.testName}\u0000${row.browser ?? ''}`;
}

export interface FlakyOptions {
  /** Below this, a test has not been run enough times for "sometimes" to mean anything. */
  minimumRuns?: number;
  /** Only tests that changed their mind at least this often. */
  minimumFlips?: number;
}

/**
 * Groups results by test and browser, in time order, and counts the changes of mind.
 *
 * Errors are counted and then stepped over rather than treated as failures: a run that could
 * not start a browser says nothing about whether the test is reliable, and letting it count as
 * a failure would manufacture two flips out of one bad night on the runner.
 */
export function summariseFlakiness(rows: FlakyInputRow[], options: FlakyOptions = {}): FlakySummary[] {
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
    const ordered = [...group].sort((left, right) => timeOf(left.startedAt) - timeOf(right.startedAt));
    // Verdict and version travel together: which version produced a verdict is what decides
    // whether the next change of verdict is a surprise or a consequence.
    const judged: Array<{ verdict: 'passed' | 'failed'; version: number | null }> = [];
    let errored = 0;

    for (const row of ordered) {
      const verdict = verdictOf(row.status);
      if (verdict) judged.push({ verdict, version: row.testVersion ?? null });
      else errored++;
    }

    if (judged.length < minimumRuns) continue;

    let flips = 0;
    let unexplainedFlips = 0;
    for (let i = 1; i < judged.length; i++) {
      if (judged[i].verdict === judged[i - 1].verdict) continue;
      flips++;
      // Same version on both sides — including two unknowns, since an unrecorded version
      // cannot account for anything.
      if (judged[i].version === judged[i - 1].version) unexplainedFlips++;
    }
    // Filtered on the unexplained ones: a test whose every change of verdict followed an edit
    // has not disagreed with itself, and putting it on this list is how the list loses its
    // meaning.
    if (unexplainedFlips < minimumFlips) continue;

    const versions = Array.from(
      new Set(judged.map((entry) => entry.version).filter((version): version is number => version !== null)),
    ).sort((left, right) => left - right);

    const passed = judged.filter((entry) => entry.verdict === 'passed').length;
    summaries.push({
      testName: ordered[0].testName,
      browser: ordered[0].browser ?? null,
      runs: judged.length,
      passed,
      failed: judged.length - passed,
      errored,
      flips,
      unexplainedFlips,
      versions,
      changedDuringWindow: versions.length > 1,
      flakiness: Number((unexplainedFlips / (judged.length - 1)).toFixed(3)),
      lastStatus: judged[judged.length - 1].verdict,
      firstSeen: new Date(timeOf(ordered[0].startedAt)).toISOString(),
      lastSeen: new Date(timeOf(ordered[ordered.length - 1].startedAt)).toISOString(),
    });
  }

  // Most changeable first; ties broken by how much history says so, so a test that flipped
  // twice in three runs does not outrank one that flipped twenty times in thirty.
  return summaries.sort((left, right) => right.flakiness - left.flakiness || right.flips - left.flips);
}

/** One line for a run's console or a notification: what this run's flakiest tests are doing. */
export function describeFlakiness(summary: FlakySummary): string {
  const edited = summary.changedDuringWindow
    ? ` The test was edited in this window (versions ${summary.versions.join(', ')}), which accounts for ` +
      `${summary.flips - summary.unexplainedFlips} of them.`
    : '';
  return (
    `${summary.testName}${summary.browser ? ` (${summary.browser})` : ''}: ` +
    `${summary.passed} passed, ${summary.failed} failed over ${summary.runs} runs, ` +
    `changing verdict ${summary.flips} time${summary.flips === 1 ? '' : 's'}.${edited}`
  );
}
