import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { asc, eq, sql } from 'drizzle-orm';
import { privilegedDb } from '../../platform/db';
import logger from '../../platform/logger';
import {
  reportTestCaseResults,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  tests as testsTable,
  users,
} from '@shared/schema';
import { createTestOrganization } from '../../tests/factories';
import { commitStatusFor } from '../../integrations/commit-status';

/**
 * A result the run cannot write down is not a result (audit C02, lot P01).
 *
 * The run used to log the failed insert and carry on, so a plan whose only failure was the row
 * that got lost ended `completed`: one test passed, the other "never happened". A synthetic
 * trigger on `report_test_case_results` stands in for the database refusing a write; whatever it
 * refuses, the run must end `error` / `run_incomplete`, and everything downstream — notification,
 * commit status, the CLI's exit code — must see a run that did not succeed.
 */

const executeTestSequence = vi.fn();
const notifyRunFinished = vi.fn();

vi.mock('../../web/playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));
vi.mock('../../runtime/precondition-runner', () => ({
  runPreconditions: async () => ({ ok: true, steps: [] }),
}));
vi.mock('./after-run', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./after-run')>()),
  notifyRunFinished: (...args: any[]) => notifyRunFinished(...args),
}));

const { processTestPlanJob } = await import('../test-execution-service');

const passed = {
  success: true,
  steps: [{ name: 'Click', type: 'click', status: 'passed' }],
  duration: 5,
};
const failed = {
  success: false,
  steps: [{ name: 'Click', type: 'click', status: 'failed', error: 'Button not found' }],
  duration: 5,
};

let organizationId: number;
let userId: number;
let planId: string;

async function seedPlan(testCount = 2) {
  planId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'Nightly', userId, organizationId } as any);
  for (let i = 1; i <= testCount; i++) {
    const [test] = await privilegedDb
      .insert(testsTable)
      .values({
        userId,
        organizationId,
        name: `Test ${i}`,
        url: `https://example.test/${i}`,
        sequence: [],
        elements: [],
      })
      .returning();
    await privilegedDb
      .insert(testPlanSelectedTests)
      .values({ testPlanId: planId, testType: 'ui', testId: test.id, organizationId } as any);
  }
}

/** The database refuses every result row matching `condition` (SQL over NEW). */
async function rejectWrites(condition: string) {
  await privilegedDb.execute(
    sql.raw(`
      CREATE OR REPLACE FUNCTION p01_reject_result() RETURNS trigger AS $$
      BEGIN
        IF ${condition} THEN
          RAISE EXCEPTION 'synthetic write rejection';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `),
  );
  await privilegedDb.execute(
    sql.raw(`
      CREATE TRIGGER p01_reject_result BEFORE INSERT ON report_test_case_results
      FOR EACH ROW EXECUTE FUNCTION p01_reject_result();
    `),
  );
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
  const [execution] = await privilegedDb
    .select()
    .from(testPlanExecutions)
    .where(eq(testPlanExecutions.id, executionId));
  const results = await privilegedDb
    .select()
    .from(reportTestCaseResults)
    .where(eq(reportTestCaseResults.testPlanExecutionId, executionId))
    .orderBy(asc(reportTestCaseResults.startedAt));
  return { execution, results };
}

/** What the run told the plan's webhook. */
const notifiedStatus = () => notifyRunFinished.mock.calls.at(-1)?.[0]?.summary?.status;

beforeEach(async () => {
  organizationId = await createTestOrganization('Lost Result Org');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `lost-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId })
    .returning();
  userId = user.id;
  executeTestSequence.mockReset();
  executeTestSequence.mockResolvedValue(passed);
  notifyRunFinished.mockReset();
});

afterEach(async () => {
  await privilegedDb.execute(
    sql.raw('DROP TRIGGER IF EXISTS p01_reject_result ON report_test_case_results'),
  );
  vi.restoreAllMocks();
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('a run whose result could not be recorded', () => {
  it('lost-result-false-green: one passes, the failure is lost, and the run is not completed', async () => {
    await seedPlan();
    executeTestSequence.mockResolvedValueOnce(passed).mockResolvedValueOnce(failed);
    await rejectWrites(`NEW.status = 'Failed'`);
    const logged = vi.spyOn(logger, 'error');

    const { execution, results } = await runPlan();

    expect(executeTestSequence).toHaveBeenCalledTimes(2);
    expect(results.map((row) => row.status)).toEqual(['Passed']);
    expect(execution.status).toBe('error');
    expect(execution.failureCode).toBe('run_incomplete');
    expect(execution.failureMessage).toContain('The result of "Test 2" could not be recorded');
    // Never reported as the run CI waits on to pass.
    expect(notifiedStatus()).toBe('error');
    expect(commitStatusFor(execution, 'Nightly')?.state).toBe('error');

    // The log names the test and the cause, not its steps or evidence.
    const lost = logged.mock.calls
      .map(([entry]) => entry as unknown as Record<string, unknown>)
      .find((entry) => entry?.message === 'Failed to insert into reportTestCaseResultsTable');
    expect(lost).toMatchObject({
      testPlanRunId: execution.id,
      testType: 'ui',
      testName: 'Test 2',
      status: 'Failed',
      error: expect.stringContaining('synthetic write rejection'),
    });
    expect(lost).not.toHaveProperty('entry');
    expect(JSON.stringify(lost)).not.toContain('Button not found');
  });

  it('is incomplete when the last write is the one lost', async () => {
    await seedPlan();
    await rejectWrites(`NEW.test_name = 'Test 2'`);

    const { execution, results } = await runPlan();

    expect(results.map((row) => row.testName)).toEqual(['Test 1']);
    expect(execution).toMatchObject({ status: 'error', failureCode: 'run_incomplete' });
    expect(notifiedStatus()).toBe('error');
  });

  it('is incomplete when every write is lost, and still runs every test', async () => {
    await seedPlan(3);
    await rejectWrites('TRUE');

    const { execution, results } = await runPlan();

    expect(executeTestSequence).toHaveBeenCalledTimes(3);
    expect(results).toEqual([]);
    expect(execution).toMatchObject({
      status: 'error',
      failureCode: 'run_incomplete',
      totalTests: 0,
    });
    expect(execution.failureMessage?.match(/could not be recorded/g)).toHaveLength(3);
    expect(notifiedStatus()).toBe('error');
  });
});

describe('a run whose results were all recorded', () => {
  it('completes when every test passed', async () => {
    await seedPlan();

    const { execution, results } = await runPlan();

    expect(results).toHaveLength(2);
    expect(execution).toMatchObject({ status: 'completed', failureCode: null });
    expect(notifiedStatus()).toBe('completed');
    expect(commitStatusFor(execution, 'Nightly')?.state).toBe('success');
  });

  it('fails, not errors, when a recorded test failed', async () => {
    await seedPlan();
    executeTestSequence.mockResolvedValueOnce(passed).mockResolvedValueOnce(failed);

    const { execution } = await runPlan();

    expect(execution).toMatchObject({ status: 'failed', failedTests: 1, failureCode: null });
    expect(notifiedStatus()).toBe('failed');
  });
});
