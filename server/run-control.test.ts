import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

// Short enough to run in a test: a heartbeat every 20 ms, and a run allowed 500 ms.
process.env.RUN_HEARTBEAT_INTERVAL_MS = '20';
process.env.RUN_MAX_DURATION_MS = '500';

/**
 * Stopping a run from outside it: somebody cancels it, or it runs out of time.
 *
 * The browser is not launched. Each test's stand-in can do what a person would do while it runs
 * — press Cancel — or take longer than the run is allowed.
 */

const executeTestSequence = vi.fn();
vi.mock('./playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));

const { privilegedDb } = await import('./db');
const { reportTestCaseResults, testPlanExecutions, testPlanSelectedTests, testPlans, tests: testsTable, users } = await import('@shared/schema');
const { createTestOrganization } = await import('./tests/factories');
const { processTestPlanJob } = await import('./test-execution-service');
const { requestCancellation } = await import('./execution-state');

const passed = { success: true, steps: [{ name: 'Click', type: 'click', status: 'passed' }], duration: 5 };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let organizationId: number;
let userId: number;
let planId: string;
let testIds: number[];
let executionId: string;

async function seed(testCount = 3) {
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Control', userId, organizationId } as any);
  testIds = [];
  for (let i = 1; i <= testCount; i++) {
    const [test] = await privilegedDb
      .insert(testsTable)
      .values({ userId, organizationId, name: `Test ${i}`, url: `https://example.test/${i}`, sequence: [], elements: [] })
      .returning();
    testIds.push(test.id);
    await privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: planId, testType: 'ui', testId: test.id, organizationId } as any);
  }
  executionId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({ id: executionId, organizationId, testPlanId: planId, status: 'queued', triggeredBy: 'manual' } as any);
}

async function outcome() {
  const [execution] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, executionId));
  const results = await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
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
  organizationId = await createTestOrganization('Control Org');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `control-${uuidv4().slice(0, 8)}`, password: 'x', organizationId })
    .returning();
  userId = user.id;
  executeTestSequence.mockReset();
  executeTestSequence.mockResolvedValue(passed);
});

afterEach(async () => {
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('cancelling a run while it runs', () => {
  it('lets the test in progress finish, starts no other, and ends the run cancelled', async () => {
    await seed();
    executeTestSequence.mockImplementationOnce(async () => {
      // Somebody presses Cancel while the first test is going; the worker hears it at its next
      // heartbeat, which comes before this test is over.
      await requestCancellation(executionId, 'Cancelled by ada.');
      await wait(100);
      return passed;
    });

    await processTestPlanJob(planId, executionId, userId);

    const { execution, byTest } = await outcome();
    expect(executeTestSequence).toHaveBeenCalledTimes(1);
    expect(execution).toMatchObject({ status: 'cancelled', failureMessage: 'Cancelled by ada.', skippedTests: 2 });
    expect(execution.completedAt).not.toBeNull();
    expect([byTest(0)?.status, byTest(1)?.status, byTest(2)?.status]).toEqual(['Passed', 'Skipped', 'Skipped']);
    expect(byTest(1)?.reasonForFailure).toMatch(/cancelled/);
  });

  it('stops the test in progress at its next step', async () => {
    await seed(1);
    executeTestSequence.mockImplementationOnce(async (...args: any[]) => {
      await requestCancellation(executionId, 'Cancelled by ada.');
      await wait(100);
      // What the step loop does at the top of each step.
      const signal: AbortSignal | undefined = args[6]?.signal;
      return { success: false, steps: [], duration: 1, aborted: signal?.aborted === true };
    });

    await processTestPlanJob(planId, executionId, userId);

    expect(await executeTestSequence.mock.results[0].value).toMatchObject({ aborted: true });
    expect((await outcome()).execution.status).toBe('cancelled');
  });
});

describe('a run past its time limit', () => {
  it('starts no further test and ends timed out, saying why', async () => {
    await seed();
    executeTestSequence.mockImplementationOnce(async () => {
      await wait(700);
      return passed;
    });

    await processTestPlanJob(planId, executionId, userId);

    const { execution, byTest } = await outcome();
    expect(executeTestSequence).toHaveBeenCalledTimes(1);
    expect(execution).toMatchObject({ status: 'timed_out', failureCode: 'run_timed_out' });
    expect(execution.failureMessage).toMatch(/limit/);
    expect([byTest(1)?.status, byTest(2)?.status]).toEqual(['Skipped', 'Skipped']);
  });
});

describe('the heartbeat', () => {
  it('is kept fresh for as long as the run goes on', async () => {
    await seed(1);
    let heartbeatDuringRun: Date | null = null;
    executeTestSequence.mockImplementationOnce(async () => {
      await wait(150);
      const [row] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, executionId));
      heartbeatDuringRun = row.heartbeatAt;
      return passed;
    });

    await processTestPlanJob(planId, executionId, userId);

    const { execution } = await outcome();
    expect(heartbeatDuringRun!.getTime()).toBeGreaterThan(execution.startedAt!.getTime() + 50);
    expect(execution.status).toBe('completed');
  });
});
