import type { ExecutionSnapshot } from './execution-snapshot';

/**
 * What a plan's execution settings mean to the runner.
 *
 * A plan has always recorded its timeouts, whether to keep a screenshot of each step, what to do
 * when a step fails or a test's setup does, and whether to re-run a failed test, and the runner
 * read none of them: every run used the user's own timeout, kept every screenshot, ran on after
 * every failure and never re-ran anything, whatever the plan said. The plan page showing
 * "Stop Execution" for a plan that never stopped is a promise the product broke on every run.
 *
 * Pure: it turns a snapshot into decisions, and the runner acts on them. Two of the settings have
 * nothing to act on here and are named as such rather than silently ignored — see `notApplied`.
 */

export type ScreenshotPolicy = 'always' | 'on_failed_steps' | 'never';
export type PreconditionFailurePolicy = 'stop' | 'skip' | 'continue';

/** What the browser part of a run needs: see ExecuteSequenceOptions.runtime. */
export interface StepRuntime {
  pageLoadTimeoutMs: number;
  elementTimeoutMs: number;
  screenshots: ScreenshotPolicy;
  /** Try a failed step once more before giving up on the test. */
  retryFailedStep: boolean;
}

export interface RunPolicies {
  step: StepRuntime;
  /** How many more times a test that did not pass is run before its result stands. */
  testReruns: number;
  onPreconditionFailure: PreconditionFailurePolicy;
  /** The run stops when a step fails ("On Major Step Failure: Stop Execution"). */
  stopOnStepFailure: boolean;
  /** The run stops when a test ends without passing ("On Aborted Test Case: Stop Execution"). */
  stopOnAbortedTest: boolean;
  /** Settings the plan changed from their default that this runner has nothing to apply to. */
  notApplied: string[];
}

export const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;

/**
 * A plan timeout in milliseconds.
 *
 * The plan wizard asked for seconds and saved what it was given — 30 — into columns every other
 * writer, and the column's own default, fill in milliseconds. Migration 0024 converts the stored
 * ones; this reads a value under a second as seconds for a snapshot taken before it ran, because
 * a 30 ms timeout is never what anybody meant and would fail every step of every test.
 */
export function toMilliseconds(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  const ms = value < 1000 ? value * 1000 : value;
  return Math.min(Math.round(ms), MAX_TIMEOUT_MS);
}

export function rerunsFor(policy: string | null | undefined): number {
  switch (policy) {
    case 'once':
      return 1;
    case 'twice':
      return 2;
    case 'thrice':
      return 3;
    default:
      return 0;
  }
}

function screenshotPolicy(value: string | null | undefined): ScreenshotPolicy {
  return value === 'always' || value === 'never' ? value : 'on_failed_steps';
}

function preconditionPolicy(value: string | null | undefined): PreconditionFailurePolicy {
  if (value === 'skip_test_case') return 'skip';
  if (value === 'continue_anyway') return 'continue';
  return 'stop';
}

export function runPoliciesFrom(snapshot: ExecutionSnapshot): RunPolicies {
  const policies = snapshot.failurePolicies;
  const notApplied: string[] = [];
  // A test here has preconditions of its own and nothing above or below it: there is no suite
  // with setup of its own, and no step that declares one. Said once in the run's log, so a
  // setting that does nothing is visibly one.
  if (policies.onTestSuitePreRequisiteFailure && policies.onTestSuitePreRequisiteFailure !== 'stop_execution') {
    notApplied.push('"On Test Suite Pre Requisite Failure" (a plan has no suite-level prerequisites)');
  }
  if (policies.onTestStepPreRequisiteFailure && policies.onTestStepPreRequisiteFailure !== 'abort_and_run_next_test_case') {
    notApplied.push('"On Test Step Pre Requisite Failure" (steps have no prerequisites of their own)');
  }

  return {
    step: {
      pageLoadTimeoutMs: toMilliseconds(snapshot.timeouts.pageLoadMs),
      elementTimeoutMs: toMilliseconds(snapshot.timeouts.elementMs),
      screenshots: screenshotPolicy(snapshot.captureScreenshots),
      retryFailedStep: policies.onMajorStepFailure === 'retry_step',
    },
    testReruns: rerunsFor(snapshot.rerunPolicy),
    onPreconditionFailure: preconditionPolicy(policies.onTestCasePreRequisiteFailure),
    stopOnStepFailure: policies.onMajorStepFailure === 'stop_execution',
    // "Delete cookies and reuse session", the other choice, is what every test already gets and
    // more: each one starts in a browser context of its own, with no cookies from the last.
    stopOnAbortedTest: policies.onAbortedTestCase === 'stop_execution',
    notApplied,
  };
}

/** Whether a step's screenshot is kept as evidence. */
export function keepsScreenshot(policy: ScreenshotPolicy, stepStatus: 'passed' | 'failed'): boolean {
  if (policy === 'always') return true;
  if (policy === 'never') return false;
  return stepStatus === 'failed';
}

/** How a test ended, as far as deciding whether the run goes on. */
export interface TestOutcome {
  testName: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  /** What stopped it: one of its steps, its preconditions, or anything else. */
  cause: 'step' | 'precondition' | 'other';
}

/**
 * Why the run stops after this test, or null when it goes on.
 *
 * The reason is a sentence, because it is what every test that did not run gets as its reason.
 */
export function stopReasonAfter(outcome: TestOutcome, policies: RunPolicies): string | null {
  if (outcome.status === 'passed' || outcome.status === 'skipped') return null;
  const test = `"${outcome.testName}"`;

  if (outcome.cause === 'precondition') {
    return policies.onPreconditionFailure === 'stop'
      ? `Not run: ${test} could not establish its preconditions, and this plan stops on a test case prerequisite failure.`
      : null;
  }
  if (outcome.cause === 'step' && policies.stopOnStepFailure) {
    return `Not run: a step of ${test} failed, and this plan stops on a major step failure.`;
  }
  if (policies.stopOnAbortedTest) {
    return `Not run: ${test} did not pass, and this plan stops on an aborted test case.`;
  }
  return null;
}

/** One line for the run's log, so what the run is doing is not a surprise. */
export function describePolicies(policies: RunPolicies): string {
  const seconds = (ms: number) => `${Math.round(ms / 100) / 10}s`;
  const onStep = policies.stopOnStepFailure
    ? 'a failing step stops the run'
    : policies.step.retryFailedStep
      ? 'a failing step is tried once more'
      : 'a failing step ends its test and the run goes on';
  const parts = [
    `Timeouts: page load ${seconds(policies.step.pageLoadTimeoutMs)}, element ${seconds(policies.step.elementTimeoutMs)}`,
    `screenshots: ${policies.step.screenshots.replace(/_/g, ' ')}`,
    onStep,
  ];
  if (policies.stopOnAbortedTest) parts.push('a test that does not pass stops the run');
  if (policies.testReruns > 0) parts.push(`a test that does not pass is run up to ${policies.testReruns} more time(s)`);
  parts.push(
    policies.onPreconditionFailure === 'stop'
      ? 'a failed precondition stops the run'
      : policies.onPreconditionFailure === 'skip'
        ? 'a test whose preconditions fail is skipped'
        : 'a test whose preconditions fail runs anyway',
  );
  return `${parts.join('; ')}.`;
}
