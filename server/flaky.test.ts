import { describe, it, expect } from 'vitest';
import { describeFlakiness, summariseFlakiness, type FlakyInputRow } from './flaky';

/**
 * A test that fails sometimes is worse than a test that fails: each run is read on its own, so
 * the same unreliable test is investigated again and again — until it is believed less than it
 * should be, and a real failure is waved through as "that one is flaky".
 */

let clock = Date.parse('2026-09-01T00:00:00Z');
const at = () => new Date((clock += 86_400_000)).toISOString();

const run = (testName: string, status: string, browser: string | null = 'chromium'): FlakyInputRow => ({
  testName,
  browser,
  status,
  startedAt: at(),
});

describe('summariseFlakiness', () => {
  it('finds the test that keeps changing its mind', () => {
    const [summary] = summariseFlakiness([
      run('Login', 'Passed'),
      run('Login', 'Failed'),
      run('Login', 'Passed'),
      run('Login', 'Failed'),
    ]);

    expect(summary.testName).toBe('Login');
    expect(summary.runs).toBe(4);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(2);
    expect(summary.flips).toBe(3);
    expect(summary.flakiness).toBe(1);
    expect(summary.lastStatus).toBe('failed');
  });

  it('says nothing about a test that simply passes, or simply fails', () => {
    expect(summariseFlakiness([run('Steady', 'Passed'), run('Steady', 'Passed'), run('Steady', 'Passed')])).toEqual([]);
    expect(summariseFlakiness([run('Broken', 'Failed'), run('Broken', 'Failed'), run('Broken', 'Failed')])).toEqual([]);
  });

  it('does not call a test that broke and was fixed flaky', () => {
    const summaries = summariseFlakiness(
      [
        run('Fixed', 'Failed'),
        run('Fixed', 'Failed'),
        run('Fixed', 'Failed'),
        run('Fixed', 'Passed'),
        run('Fixed', 'Passed'),
        run('Fixed', 'Passed'),
      ],
      { minimumFlips: 2 },
    );

    expect(summaries).toEqual([]);
  });

  it('counts flips in time order, not in the order rows arrived', () => {
    const first = run('Login', 'Passed');
    const second = run('Login', 'Failed');
    const third = run('Login', 'Passed');

    const [shuffled] = summariseFlakiness([third, first, second]);

    expect(shuffled.flips).toBe(2);
    expect(shuffled.lastStatus).toBe('passed');
  });

  it('keeps browsers apart, because "fails on WebKit" is not indecision', () => {
    const summaries = summariseFlakiness([
      run('Login', 'Passed', 'chromium'),
      run('Login', 'Passed', 'chromium'),
      run('Login', 'Passed', 'chromium'),
      run('Login', 'Failed', 'webkit'),
      run('Login', 'Failed', 'webkit'),
      run('Login', 'Failed', 'webkit'),
    ]);

    expect(summaries).toEqual([]);
  });

  it('steps over runs that never reached a verdict rather than counting them as failures', () => {
    const [summary] = summariseFlakiness([
      run('Login', 'Passed'),
      run('Login', 'Error'),
      run('Login', 'Passed'),
      run('Login', 'Failed'),
    ]);

    // Two verdicts changed once — the errored night in the middle did not manufacture two.
    expect(summary.errored).toBe(1);
    expect(summary.runs).toBe(3);
    expect(summary.flips).toBe(1);
  });

  it('will not judge a test on too little history', () => {
    expect(summariseFlakiness([run('New', 'Passed'), run('New', 'Failed')])).toEqual([]);
    expect(summariseFlakiness([run('New', 'Passed'), run('New', 'Failed')], { minimumRuns: 2 })).toHaveLength(1);
  });

  it('ranks the most changeable first, and breaks ties on how much history says so', () => {
    const summaries = summariseFlakiness([
      // Flips twice in three runs.
      run('Sometimes', 'Passed'),
      run('Sometimes', 'Failed'),
      run('Sometimes', 'Passed'),
      // Flips once in four.
      run('Rarely', 'Passed'),
      run('Rarely', 'Passed'),
      run('Rarely', 'Passed'),
      run('Rarely', 'Failed'),
    ]);

    expect(summaries.map((s) => s.testName)).toEqual(['Sometimes', 'Rarely']);
    expect(summaries[0].flakiness).toBeGreaterThan(summaries[1].flakiness);
  });

  it('carries the window it looked at, so a reader knows what "sometimes" covers', () => {
    const [summary] = summariseFlakiness([run('Login', 'Passed'), run('Login', 'Failed'), run('Login', 'Passed')]);

    expect(new Date(summary.firstSeen).getTime()).toBeLessThan(new Date(summary.lastSeen).getTime());
  });
});

/**
 * Which version of the test produced each verdict.
 *
 * Without it, a test edited on Monday night and failing from Tuesday reads exactly like one
 * that cannot make its mind up — and a measure that calls an explained change flakiness is one
 * people learn to ignore on the days it is right.
 */
describe('a test that changed underneath the runs', () => {
  const versioned = (testName: string, status: string, testVersion: number | null): FlakyInputRow => ({
    ...run(testName, status),
    testVersion,
  });

  it('does not call a verdict that changed across an edit flaky', () => {
    const summaries = summariseFlakiness([
      versioned('Checkout', 'Passed', 1),
      versioned('Checkout', 'Passed', 1),
      // Edited here; it has failed consistently ever since.
      versioned('Checkout', 'Failed', 2),
      versioned('Checkout', 'Failed', 2),
    ]);

    expect(summaries).toEqual([]);
  });

  it('still reports the flips that happened without the test changing', () => {
    const [summary] = summariseFlakiness([
      versioned('Checkout', 'Passed', 2),
      versioned('Checkout', 'Failed', 2),
      versioned('Checkout', 'Passed', 2),
    ]);

    expect(summary.flips).toBe(2);
    expect(summary.unexplainedFlips).toBe(2);
    expect(summary.changedDuringWindow).toBe(false);
  });

  it('separates the explained changes from the rest, and says the test was edited', () => {
    const [summary] = summariseFlakiness([
      versioned('Checkout', 'Passed', 1),
      versioned('Checkout', 'Failed', 1), // unexplained
      versioned('Checkout', 'Passed', 2), // explained by the edit
      versioned('Checkout', 'Failed', 2), // unexplained
    ]);

    expect(summary.flips).toBe(3);
    expect(summary.unexplainedFlips).toBe(2);
    expect(summary.versions).toEqual([1, 2]);
    expect(summary.changedDuringWindow).toBe(true);
  });

  it('ranks by what nobody can explain, not by the raw count', () => {
    const summaries = summariseFlakiness([
      // Flips at every run and was never touched.
      versioned('Unreliable', 'Passed', 4),
      versioned('Unreliable', 'Failed', 4),
      versioned('Unreliable', 'Passed', 4),
      versioned('Unreliable', 'Failed', 4),
      // Flips as often, but was edited between each one.
      versioned('Rewritten', 'Passed', 1),
      versioned('Rewritten', 'Failed', 2),
      versioned('Rewritten', 'Passed', 3),
      versioned('Rewritten', 'Failed', 4),
    ]);

    expect(summaries.map((summary) => summary.testName)).toEqual(['Unreliable']);
  });

  it('counts a flip between two unrecorded versions, because nothing explains it', () => {
    // Every result written before versions were recorded is this case, so the whole history
    // has to keep counting the way it always did.
    const [summary] = summariseFlakiness([
      versioned('Legacy', 'Passed', null),
      versioned('Legacy', 'Failed', null),
      versioned('Legacy', 'Passed', null),
    ]);

    expect(summary.unexplainedFlips).toBe(2);
    expect(summary.versions).toEqual([]);
    expect(summary.changedDuringWindow).toBe(false);
  });
});

describe('describeFlakiness', () => {
  it('says what the test has been doing in one line', () => {
    const [summary] = summariseFlakiness([run('Login', 'Passed'), run('Login', 'Failed'), run('Login', 'Passed')]);

    expect(describeFlakiness(summary)).toBe(
      'Login (chromium): 2 passed, 1 failed over 3 runs, changing verdict 2 times.',
    );
  });

  it('says how much of it the test’s own edits account for', () => {
    const [summary] = summariseFlakiness([
      { ...run('Login', 'Passed'), testVersion: 1 },
      { ...run('Login', 'Failed'), testVersion: 1 },
      { ...run('Login', 'Passed'), testVersion: 2 },
    ]);

    expect(describeFlakiness(summary)).toContain('edited in this window (versions 1, 2)');
    expect(describeFlakiness(summary)).toContain('accounts for 1 of them');
  });
});
