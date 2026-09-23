import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { asc, eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import {
  reportTestCaseResults,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  tests as testsTable,
  users,
} from '@shared/schema';
import { createTestOrganization } from './tests/factories';

/**
 * A plan's execution settings, as the run of the plan acts on them.
 *
 * The browser is not launched: `executeTestSequence` stands in for a test's run and
 * `runPreconditions` for its setup, because what is under test is what the plan loop does with
 * each outcome — stop, skip, run again — and what it hands the browser part.
 */

const executeTestSequence = vi.fn();
const runPreconditions = vi.fn();

vi.mock('./playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));
vi.mock('./precondition-runner', () => ({
  runPreconditions: (...args: any[]) => runPreconditions(...args),
}));

const { processTestPlanJob } = await import('./test-execution-service');

const passed = { success: true, steps: [{ name: 'Click', type: 'click', status: 'passed' }], duration: 5 };
const failedStep = { success: false, steps: [{ name: 'Click', type: 'click', status: 'failed', error: 'Button not found' }], duration: 5 };

let organizationId: number;
let userId: number;
let planId: string;
let testIds: number[];

async function seedPlan(planColumns: Record<string, unknown>, testCount = 3) {
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Policies', userId, organizationId, ...planColumns } as any);
  testIds = [];
  for (let i = 1; i <= testCount; i++) {
    const [test] = await privilegedDb
      .insert(testsTable)
      .values({ userId, organizationId, name: `Test ${i}`, url: `https://example.test/${i}`, sequence: [], elements: [] })
      .returning();
    testIds.push(test.id);
    await privilegedDb
      .insert(testPlanSelectedTests)
      .values({ testPlanId: planId, testType: 'ui', testId: test.id, organizationId } as any);
  }
}

async function runPlan() {
  const executionId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId,
    organizationId,
    testPlanId: planId,
    status: 'queued',
    triggeredBy: 'manual',
  } as any);
  await processTestPlanJob(planId, executionId, userId);
  const [execution] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, executionId));
  const results = await privilegedDb
    .select()
    .from(reportTestCaseResults)
    .where(eq(reportTestCaseResults.testPlanExecutionId, executionId))
    .orderBy(asc(reportTestCaseResults.startedAt));
  const byTest = (index: number) => results.find((row) => row.uiTestId === testIds[index]);
  return { execution, results, byTest };
}

beforeEach(async () => {
  await privilegedDb.delete(reportTestCaseResults);
  await privilegedDb.delete(testPlanSelectedTests);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(testsTable);
  await privilegedDb.delete(users);

  organizationId = await createTestOrganization('Policies Org');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `policies-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId })
    .returning();
  userId = user.id;

  executeTestSequence.mockReset();
  executeTestSequence.mockResolvedValue(passed);
  runPreconditions.mockReset();
  runPreconditions.mockResolvedValue({ ok: true, steps: [] });
});

afterEach(async () => {
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('what the browser part of each test is handed', () => {
  it("the plan's timeouts, screenshot policy and step retry — seconds from the wizard read as seconds", async () => {
    await seedPlan({ pageLoadTimeout: 45, elementTimeout: 12_000, captureScreenshots: 'always', onMajorStepFailure: 'retry_step' }, 1);

    await runPlan();

    const options = executeTestSequence.mock.calls[0][6];
    expect(options.runtime).toEqual({
      pageLoadTimeoutMs: 45_000,
      elementTimeoutMs: 12_000,
      screenshots: 'always',
      retryFailedStep: true,
    });
  });
});

describe('when a step fails', () => {
  it('ends that test and runs the rest, by default', async () => {
    await seedPlan({});
    executeTestSequence.mockResolvedValueOnce(failedStep);

    const { execution, byTest } = await runPlan();

    expect(executeTestSequence).toHaveBeenCalledTimes(3);
    expect([byTest(0)?.status, byTest(1)?.status, byTest(2)?.status]).toEqual(['Failed', 'Passed', 'Passed']);
    expect(execution.status).toBe('failed');
  });

  it('stops the run when the plan says "Stop Execution", and records every test it did not run', async () => {
    await seedPlan({ onMajorStepFailure: 'stop_execution' });
    executeTestSequence.mockResolvedValueOnce(failedStep);

    const { execution, results, byTest } = await runPlan();

    expect(executeTestSequence).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(3);
    expect([byTest(0)?.status, byTest(1)?.status, byTest(2)?.status]).toEqual(['Failed', 'Skipped', 'Skipped']);
    expect(byTest(1)?.reasonForFailure).toMatch(/"Test 1".*major step failure/);
    expect(execution).toMatchObject({ status: 'failed', skippedTests: 2 });
  });

  it('stops the run after a test that did not pass when aborted test cases stop it', async () => {
    await seedPlan({ onAbortedTestCase: 'stop_execution' });
    executeTestSequence.mockResolvedValueOnce(passed).mockResolvedValueOnce(failedStep);

    const { byTest } = await runPlan();

    expect([byTest(0)?.status, byTest(1)?.status, byTest(2)?.status]).toEqual(['Passed', 'Failed', 'Skipped']);
  });
});

describe('re-running a failed test', () => {
  it('runs it again up to the plan\'s number, and records how many attempts the result took', async () => {
    await seedPlan({ reRunOnFailure: 'twice' }, 1);
    executeTestSequence.mockResolvedValueOnce(failedStep).mockResolvedValueOnce(passed);

    const { execution, byTest } = await runPlan();

    expect(executeTestSequence).toHaveBeenCalledTimes(2);
    expect(byTest(0)).toMatchObject({ status: 'Passed', attempts: 2 });
    expect(execution.status).toBe('completed');
  });

  it('stops at the last attempt, whose failure is the result', async () => {
    await seedPlan({ reRunOnFailure: 'once' }, 1);
    executeTestSequence.mockResolvedValue(failedStep);

    const { byTest } = await runPlan();

    expect(executeTestSequence).toHaveBeenCalledTimes(2);
    expect(byTest(0)).toMatchObject({ status: 'Failed', attempts: 2 });
  });

  it('does not re-run a test that passed, which is every test of a plan without the setting', async () => {
    await seedPlan({}, 2);

    const { results } = await runPlan();

    expect(executeTestSequence).toHaveBeenCalledTimes(2);
    expect(results.every((row) => row.attempts === 1)).toBe(true);
  });
});

describe("when a test's preconditions fail", () => {
  const blocked = { ok: false, failedAt: 'Create order', reason: 'HTTP 500' };

  it('stops the run by default, as the plan form says it does', async () => {
    await seedPlan({});
    runPreconditions.mockResolvedValueOnce(blocked);

    const { byTest } = await runPlan();

    expect(executeTestSequence).not.toHaveBeenCalled();
    expect([byTest(0)?.status, byTest(1)?.status, byTest(2)?.status]).toEqual(['Error', 'Skipped', 'Skipped']);
    expect(byTest(0)?.reasonForFailure).toMatch(/Create order/);
  });

  it('skips only that test with "Skip Test Case"', async () => {
    await seedPlan({ onTestCasePreRequisiteFailure: 'skip_test_case' });
    runPreconditions.mockResolvedValueOnce(blocked);

    const { execution, byTest } = await runPlan();

    expect([byTest(0)?.status, byTest(1)?.status, byTest(2)?.status]).toEqual(['Skipped', 'Passed', 'Passed']);
    expect(execution.status).toBe('completed');
  });

  it('runs the test anyway with "Continue Anyway"', async () => {
    await seedPlan({ onTestCasePreRequisiteFailure: 'continue_anyway' }, 1);
    runPreconditions.mockResolvedValueOnce(blocked);

    const { byTest } = await runPlan();

    expect(executeTestSequence).toHaveBeenCalledTimes(1);
    expect(byTest(0)?.status).toBe('Passed');
  });
});
