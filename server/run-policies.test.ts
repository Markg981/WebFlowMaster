import { describe, it, expect } from 'vitest';
import type { TestPlan } from '@shared/schema';
import { buildExecutionSnapshot } from './execution-snapshot';
import {
  DEFAULT_TIMEOUT_MS,
  describePolicies,
  keepsScreenshot,
  rerunsFor,
  runPoliciesFrom,
  stopReasonAfter,
  toMilliseconds,
} from './run-policies';

function policiesFor(plan: Partial<TestPlan>) {
  const snapshot = buildExecutionSnapshot({ id: 'p', name: 'Plan', ...plan } as TestPlan, []);
  return runPoliciesFrom(snapshot);
}

describe('toMilliseconds', () => {
  it('keeps milliseconds, and reads a value under a second as the seconds the wizard sent', () => {
    expect(toMilliseconds(45_000)).toBe(45_000);
    expect(toMilliseconds(30)).toBe(30_000);
    expect(toMilliseconds(null)).toBe(DEFAULT_TIMEOUT_MS);
    expect(toMilliseconds(0)).toBe(DEFAULT_TIMEOUT_MS);
    expect(toMilliseconds(5_000_000)).toBe(600_000);
  });
});

describe('runPoliciesFrom', () => {
  it('reads the defaults every plan was created with as what they say', () => {
    const policies = policiesFor({});

    expect(policies).toEqual({
      step: { pageLoadTimeoutMs: 30_000, elementTimeoutMs: 30_000, screenshots: 'on_failed_steps', retryFailedStep: false },
      testReruns: 0,
      onPreconditionFailure: 'stop',
      stopOnStepFailure: false,
      stopOnAbortedTest: false,
      notApplied: [],
    });
  });

  it('turns each choice the plan form offers into what the runner does', () => {
    const policies = policiesFor({
      pageLoadTimeout: 60_000,
      elementTimeout: 10,
      captureScreenshots: 'always',
      onMajorStepFailure: 'retry_step',
      onAbortedTestCase: 'stop_execution',
      onTestCasePreRequisiteFailure: 'skip_test_case',
      reRunOnFailure: 'thrice',
    });

    expect(policies.step).toEqual({ pageLoadTimeoutMs: 60_000, elementTimeoutMs: 10_000, screenshots: 'always', retryFailedStep: true });
    expect(policies.testReruns).toBe(3);
    expect(policies.onPreconditionFailure).toBe('skip');
    expect(policies.stopOnAbortedTest).toBe(true);
    expect(policiesFor({ onMajorStepFailure: 'stop_execution' }).stopOnStepFailure).toBe(true);
    expect(policiesFor({ onTestCasePreRequisiteFailure: 'continue_anyway' }).onPreconditionFailure).toBe('continue');
  });

  it('names the settings it has nothing to apply to, only when somebody changed them', () => {
    expect(
      policiesFor({ onTestSuitePreRequisiteFailure: 'skip_test_suite', onTestStepPreRequisiteFailure: 'skip_test_step' }).notApplied,
    ).toHaveLength(2);
  });

  it('describes itself in one line for the run log', () => {
    expect(describePolicies(policiesFor({ reRunOnFailure: 'once' }))).toContain('run up to 1 more time(s)');
  });
});

describe('keepsScreenshot', () => {
  it('keeps what the policy says', () => {
    expect(keepsScreenshot('always', 'passed')).toBe(true);
    expect(keepsScreenshot('on_failed_steps', 'passed')).toBe(false);
    expect(keepsScreenshot('on_failed_steps', 'failed')).toBe(true);
    expect(keepsScreenshot('never', 'failed')).toBe(false);
  });
});

describe('rerunsFor', () => {
  it('counts the re-runs a policy allows', () => {
    expect([rerunsFor('none'), rerunsFor('once'), rerunsFor('twice'), rerunsFor('thrice'), rerunsFor(null)]).toEqual([0, 1, 2, 3, 0]);
  });
});

describe('stopReasonAfter', () => {
  const failedStep = { testName: 'Checkout', status: 'failed' as const, cause: 'step' as const };

  it('goes on after a pass, a skip, or a failure the plan does not stop for', () => {
    const defaults = policiesFor({});
    expect(stopReasonAfter({ ...failedStep, status: 'passed' }, defaults)).toBeNull();
    expect(stopReasonAfter({ ...failedStep, status: 'skipped' }, defaults)).toBeNull();
    expect(stopReasonAfter(failedStep, defaults)).toBeNull();
  });

  it('stops on a failing step or an aborted test when the plan says so, and says why', () => {
    expect(stopReasonAfter(failedStep, policiesFor({ onMajorStepFailure: 'stop_execution' }))).toMatch(/major step failure/);
    expect(
      stopReasonAfter({ testName: 'Orders API', status: 'failed', cause: 'other' }, policiesFor({ onAbortedTestCase: 'stop_execution' })),
    ).toMatch(/aborted test case/);
  });

  it('stops on a failed precondition by default, and not when the plan skips or continues', () => {
    const blocked = { testName: 'Checkout', status: 'error' as const, cause: 'precondition' as const };
    expect(stopReasonAfter(blocked, policiesFor({}))).toMatch(/prerequisite failure/);
    expect(stopReasonAfter(blocked, policiesFor({ onTestCasePreRequisiteFailure: 'continue_anyway' }))).toBeNull();
  });
});
