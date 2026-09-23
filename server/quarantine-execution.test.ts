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
  testQuarantines,
  tests as testsTable,
  users,
} from '@shared/schema';
import { createTestOrganization } from './tests/factories';
import { buildJUnitXml } from './junit';
import { summaryLine } from './notifications';

/**
 * What quarantine changes about a run, and only that.
 *
 * A quarantined test runs and its result is recorded as it was. Its failure does not fail the
 * run, does not stop the plan under a failure policy, is a skip to CI with the failure in its
 * message, and is named as such in the one-line summary. Everyone else's failures count exactly
 * as they did.
 */

const executeTestSequence = vi.fn();

vi.mock('./playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));
vi.mock('./precondition-runner', () => ({
  runPreconditions: async () => ({ ok: true, steps: [] }),
}));

const { processTestPlanJob } = await import('./test-execution-service');

const passed = { success: true, steps: [{ name: 'Click', type: 'click', status: 'passed' }], duration: 5 };
const failed = { success: false, steps: [{ name: 'Click', type: 'click', status: 'failed', error: 'Button not found' }], duration: 5 };

let organizationId: number;
let userId: number;
let planId: string;
let testIds: number[];

async function seedPlan(planColumns: Record<string, unknown> = {}, testCount = 3) {
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Nightly', userId, organizationId, ...planColumns } as any);
  testIds = [];
  for (let i = 1; i <= testCount; i++) {
    const [test] = await privilegedDb
      .insert(testsTable)
      .values({ userId, organizationId, name: `Test ${i}`, url: `https://example.test/${i}`, sequence: [], elements: [] })
      .returning();
    testIds.push(test.id);
    await privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: planId, testType: 'ui', testId: test.id, organizationId } as any);
  }
}

const quarantine = (index: number) =>
  privilegedDb.insert(testQuarantines).values({ organizationId, testType: 'ui', testId: testIds[index], reason: 'Flaky' }).returning();

async function runPlan() {
  const executionId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({ id: executionId, organizationId, testPlanId: planId, status: 'queued', triggeredBy: 'manual' } as any);
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
  organizationId = await createTestOrganization('Quarantine Runs Org');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `quarantine-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId })
    .returning();
  userId = user.id;
  executeTestSequence.mockReset();
  executeTestSequence.mockResolvedValue(passed);
});

afterEach(async () => {
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('a run with a test in quarantine', () => {
  it('runs it, records its failure, and does not fail because of it', async () => {
    await seedPlan();
    await quarantine(0);
    executeTestSequence.mockResolvedValueOnce(failed);

    const { execution, byTest } = await runPlan();

    expect(executeTestSequence).toHaveBeenCalledTimes(3);
    expect(byTest(0)).toMatchObject({ status: 'Failed', quarantined: true });
    expect(byTest(1)).toMatchObject({ status: 'Passed', quarantined: false });
    expect(execution).toMatchObject({ status: 'completed', failedTests: 1, quarantinedFailures: 1 });
  });

  it('still fails when a test outside quarantine fails', async () => {
    await seedPlan();
    await quarantine(0);
    executeTestSequence.mockResolvedValueOnce(failed).mockResolvedValueOnce(failed);

    const { execution } = await runPlan();

    expect(execution).toMatchObject({ status: 'failed', failedTests: 2, quarantinedFailures: 1 });
  });

  it('is not stopped by its failure, even when the plan stops on a failed step', async () => {
    await seedPlan({ onMajorStepFailure: 'stop_execution' });
    await quarantine(0);
    executeTestSequence.mockResolvedValueOnce(failed);

    const { byTest, execution } = await runPlan();

    expect([byTest(0)?.status, byTest(1)?.status, byTest(2)?.status]).toEqual(['Failed', 'Passed', 'Passed']);
    expect(execution.status).toBe('completed');
  });

  it('counts its failures again once it is released', async () => {
    await seedPlan({}, 1);
    const [row] = await quarantine(0);
    await privilegedDb.update(testQuarantines).set({ releasedAt: new Date() }).where(eq(testQuarantines.id, row.id));
    executeTestSequence.mockResolvedValueOnce(failed);

    const { execution, byTest } = await runPlan();

    expect(byTest(0)).toMatchObject({ status: 'Failed', quarantined: false });
    expect(execution).toMatchObject({ status: 'failed', quarantinedFailures: 0 });
  });
});

describe('what CI and the notification are told', () => {
  it('JUnit: a quarantined failure is a skip carrying the failure; a quarantined pass is a pass', () => {
    const xml = buildJUnitXml({
      planName: 'Nightly',
      executionId: 'run-1',
      results: [
        { testName: 'Checkout', status: 'Failed', reasonForFailure: 'Button not found\nat step 3', quarantined: true },
        { testName: 'Search', status: 'Passed', quarantined: true },
        { testName: 'Login', status: 'Failed', reasonForFailure: 'Wrong title' },
      ],
    });
    expect(xml).toContain('failures="1" errors="0" skipped="1"');
    expect(xml).toContain('<skipped message="In quarantine; it failed: Button not found" />');
    expect(xml).toContain('<system-out>Button not found\nat step 3</system-out>');
    expect(xml).toContain('<testcase name="Search" classname="webflowmaster" time="0.000" />');
    expect(xml).toContain('<failure message="Wrong title"');
  });

  it('the summary line explains a pass that has failures in it', () => {
    const line = summaryLine({
      planId: 'p', planName: 'Nightly', executionId: 'e', status: 'completed',
      totalTests: 3, passedTests: 2, failedTests: 1, skippedTests: 0, quarantinedFailures: 1,
      durationMs: 1000, triggeredBy: 'schedule',
    });
    expect(line).toMatch(/^Nightly: passed — 2\/3 passed, 1 failed \(1 in quarantine\)/);
  });
});
