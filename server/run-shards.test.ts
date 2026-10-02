import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { eq, sql } from 'drizzle-orm';
import { privilegedDb } from './db';
import {
  tests as testsTable,
  testPlans,
  testPlanExecutions,
  testPlanSelectedTests,
  reportTestCaseResults,
  runWorkItems,
  users,
} from '@shared/schema';
import { createTestOrganization } from './tests/factories';
import { claimWorkItem, recordStopReason, registerShardDispatcher, shardCount, type ShardDispatcher } from './run-shards';

/**
 * A plan run shared by several workers (server/run-shards.ts). The browser is never launched: what
 * is under test is how the work is shared out and brought back together, not Playwright.
 */

const executeTestSequence = vi.fn();
const launchBrowser = vi.fn(async () => ({ close: async () => {} }) as any);

vi.mock('./playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));
vi.mock('./browsers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./browsers')>();
  return { ...actual, launchBrowser: (...args: any[]) => launchBrowser(...(args as [any])) };
});

const { processTestPlanJob, processShardJob } = await import('./test-execution-service');

let organizationId: number;
let userId: number;
let planId: string;

async function seedPlan(planColumns: Record<string, unknown>, testCount: number) {
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Sharded Plan', userId, organizationId, ...planColumns } as any);
  for (let i = 0; i < testCount; i++) {
    const [test] = await privilegedDb
      .insert(testsTable)
      .values({ userId, organizationId, name: `Test ${i}`, url: 'https://example.test', sequence: [], elements: [] })
      .returning();
    await privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: planId, testType: 'ui', testId: test.id, organizationId } as any);
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
    browsers: ['chromium', 'firefox'],
  } as any);
  await processTestPlanJob(planId, executionId, userId);
  return executionId;
}

/** Helpers that start at once, as a worker taking the queued job would. */
function helpersOnThisProcess(): { dispatched: number[]; done: () => Promise<unknown[]> } {
  const running: Promise<unknown>[] = [];
  const dispatched: number[] = [];
  const dispatcher: ShardDispatcher = async ({ executionId, planId, userId, shard }) => {
    dispatched.push(shard);
    running.push(processShardJob(planId, executionId, userId, shard));
  };
  registerShardDispatcher(dispatcher);
  return { dispatched, done: () => Promise.all(running) };
}

beforeEach(async () => {
  await privilegedDb.delete(reportTestCaseResults);
  await privilegedDb.delete(runWorkItems);
  await privilegedDb.delete(testPlanSelectedTests);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(testsTable);
  await privilegedDb.delete(users);
  organizationId = await createTestOrganization('Shard Org');
  const [user] = await privilegedDb.insert(users).values({ username: `shard-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId }).returning();
  userId = user.id;
  executeTestSequence.mockReset();
  executeTestSequence.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return { success: true, steps: [], duration: 15 };
  });
  launchBrowser.mockClear();
});

afterEach(async () => {
  registerShardDispatcher(null);
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('a run shared by several workers', () => {
  it('runs every test once, on whichever worker takes it, and ends as one run', async () => {
    await seedPlan({ shards: 3 }, 4);
    const helpers = helpersOnThisProcess();
    const executionId = await runPlan();
    const outcomes = await helpers.done();

    expect(helpers.dispatched).toEqual([1, 2]);
    expect(outcomes).toEqual([{ shard: 1, testPlanRunId: executionId }, { shard: 2, testPlanRunId: executionId }]);
    const results = await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
    // Four tests on two browsers, each exactly once.
    expect(results).toHaveLength(8);
    expect(new Set(results.map((r) => `${r.uiTestId}/${r.browser}`)).size).toBe(8);
    const items = await privilegedDb.select().from(runWorkItems).where(eq(runWorkItems.executionId, executionId));
    expect(items.every((item) => item.state === 'done')).toBe(true);
    expect(new Set(items.map((item) => item.claimedBy)).size).toBeGreaterThan(1);
    const [run] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, executionId));
    expect(run).toMatchObject({ status: 'completed', totalTests: 8, passedTests: 8 });
    // The legacy results list is put back together from every worker's share.
    const legacy = typeof run.results === 'string' ? JSON.parse(run.results) : run.results;
    expect(legacy).toHaveLength(8);
  });

  it('runs alone when nobody can be asked to help', async () => {
    await seedPlan({ shards: 4 }, 2);
    const executionId = await runPlan();
    const [run] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, executionId));
    expect(run).toMatchObject({ status: 'completed', totalTests: 4 });
  });

  it('takes back the work of a helper that stopped answering', async () => {
    await seedPlan({ shards: 2 }, 2);
    // A helper claims an item and dies at once: its heartbeat is long past.
    registerShardDispatcher(async ({ executionId }) => {
      const taken = await claimWorkItem(executionId, 'ghost');
      await privilegedDb.update(runWorkItems).set({ heartbeatAt: sql`now() - interval '1 hour'` }).where(eq(runWorkItems.key, taken!.key));
    });
    const executionId = await runPlan();
    const results = await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
    expect(results).toHaveLength(4);
    const items = await privilegedDb.select().from(runWorkItems).where(eq(runWorkItems.executionId, executionId));
    expect(items.some((item) => item.claimedBy === 'ghost')).toBe(false);
    const [run] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, executionId));
    expect(run.status).toBe('completed');
  });

  it('stops every worker when one of them stops the run', async () => {
    await seedPlan({ shards: 2 }, 3);
    registerShardDispatcher(async ({ executionId }) => recordStopReason(executionId, 'Not run: a test failed and the plan stops on failure.'));
    const executionId = await runPlan();
    const results = await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.status === 'Skipped' && r.reasonForFailure?.includes('plan stops on failure'))).toBe(true);
    expect(executeTestSequence).not.toHaveBeenCalled();
  });

  it('keeps the number of workers within bounds', () => {
    expect([shardCount(undefined), shardCount(0), shardCount(3.7), shardCount(50)]).toEqual([1, 1, 3, 8]);
  });

  it('joins only a run that is running', async () => {
    await seedPlan({ shards: 2 }, 1);
    const executionId = uuidv4();
    await privilegedDb.insert(testPlanExecutions).values({ id: executionId, organizationId, testPlanId: planId, status: 'completed', triggeredBy: 'manual' } as any);
    expect(await processShardJob(planId, executionId, userId, 1)).toMatchObject({ skipped: true });
  });
});
