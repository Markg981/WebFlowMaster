import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import {
  environments,
  reportTestCaseResults,
  testPlanExecutions,
  testPlanSchedules,
  testPlanSelectedTests,
  testPlans,
  tests as testsTable,
  users,
} from '@shared/schema';
import { createTestOrganization } from './tests/factories';
import { runWithTenant } from './middleware/tenancy';

/**
 * Creating a run: one row, one job, the configuration written down, and asking twice gets the
 * same run back. The worker half is here too, because a snapshot nobody reads is a column.
 */

const executeTestSequence = vi.fn();
const launchBrowser = vi.fn(async () => ({ close: async () => {} }) as any);

vi.mock('./playwright-service', () => ({
  playwrightService: {
    executeTestSequence: (...args: any[]) => executeTestSequence(...args),
  },
}));

// The queue the worker's own retries go to; the enqueue tests use capturingQueue() instead.
const productionQueueAdds: Array<{ name: string; data: Record<string, unknown>; options: Record<string, unknown> }> = [];
vi.mock('./queue', () => ({
  TEST_EXECUTION_QUEUE_NAME: 'test-queue',
  testExecutionQueue: {
    add: async (name: string, data: Record<string, unknown>, options: Record<string, unknown>) => {
      productionQueueAdds.push({ name, data, options });
      return { id: options?.jobId };
    },
  },
}));

vi.mock('./browsers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./browsers')>();
  return { ...actual, launchBrowser: (...args: any[]) => launchBrowser(...(args as [any])) };
});

const { createExecutionOrchestrator, ExecutionEnqueueError, QUEUE_SUBMISSION_FAILED } = await import('./execution-orchestrator');
const { processTestPlanJob } = await import('./test-execution-service');

interface CapturedJob {
  name: string;
  data: Record<string, unknown>;
  options: { jobId: string };
}

/** A queue that remembers what it was given and, like BullMQ, ignores a job id it already holds. */
function capturingQueue() {
  const jobs: CapturedJob[] = [];
  let failNext = false;
  return {
    jobs,
    failOnce() {
      failNext = true;
    },
    async add(name: string, data: Record<string, unknown>, options: { jobId: string }) {
      if (failNext) {
        failNext = false;
        throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
      }
      if (!jobs.some((job) => job.options.jobId === options.jobId)) jobs.push({ name, data, options });
      return { id: options.jobId };
    },
  };
}

let organizationId: number;
let otherOrganizationId: number;
let userId: number;
let outsiderId: number;
let planId: string;
let firstTestId: number;
let secondTestId: number;

async function insertUiTest(name: string) {
  const [row] = await privilegedDb
    .insert(testsTable)
    .values({ userId, organizationId, name, url: `https://example.test/${name}`, sequence: [], elements: [] })
    .returning();
  return row.id;
}

async function executionRow(id: string) {
  const [row] = await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id));
  return row;
}

beforeEach(async () => {
  await privilegedDb.delete(reportTestCaseResults);
  await privilegedDb.delete(testPlanSelectedTests);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(testsTable);
  await privilegedDb.delete(environments);
  await privilegedDb.delete(users);

  organizationId = await createTestOrganization('Orchestrator Org');
  otherOrganizationId = await createTestOrganization('Somebody Else');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `orch-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId })
    .returning();
  userId = user.id;
  const [outsider] = await privilegedDb
    .insert(users)
    .values({ username: `outsider-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId: otherOrganizationId })
    .returning();
  outsiderId = outsider.id;

  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({
    id: planId,
    name: 'Checkout',
    userId,
    organizationId,
    maxParallelTests: 2,
    visualTestingEnabled: false,
  } as any);
  firstTestId = await insertUiTest('first');
  secondTestId = await insertUiTest('second');
  await privilegedDb.insert(testPlanSelectedTests).values({
    testPlanId: planId,
    testType: 'ui',
    testId: firstTestId,
    organizationId,
  } as any);

  executeTestSequence.mockReset();
  executeTestSequence.mockResolvedValue({ success: true, steps: [], duration: 5 });
  launchBrowser.mockClear();
  productionQueueAdds.length = 0;
});

afterEach(async () => {
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('enqueue', () => {
  it('creates one queued run, with its configuration, and one job named after it', async () => {
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);

    const execution = await orchestrator.enqueue({ planId, requestedByUserId: userId, trigger: 'api' });

    const row = await executionRow(execution.id);
    expect(row).toMatchObject({
      status: 'queued',
      organizationId,
      testPlanId: planId,
      requestedByUserId: userId,
      triggeredBy: 'api',
      startedAt: null,
    });
    expect(row.configurationSnapshot).toMatchObject({
      version: 1,
      plan: { id: planId, name: 'Checkout' },
      maxParallelTests: 2,
      selectedTests: [{ testType: 'ui', testId: firstTestId, apiTestId: null }],
    });
    expect(queue.jobs).toEqual([
      {
        name: 'execute-plan',
        data: expect.objectContaining({ executionId: execution.id, testPlanRunId: execution.id, planId, userId }),
        // First in flight for its organization, so first in line.
        options: { jobId: execution.id, priority: 1 },
      },
    ]);
  });

  it('returns the first run when asked again with the same key, and queues it once', async () => {
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);
    const request = { planId, requestedByUserId: userId, trigger: 'api' as const, idempotencyKey: 'build-4812' };

    const first = await orchestrator.enqueue(request);
    const second = await orchestrator.enqueue(request);

    expect(second.id).toBe(first.id);
    expect(await privilegedDb.select().from(testPlanExecutions)).toHaveLength(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it('settles two identical requests that arrive together on one run', async () => {
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);
    const request = { planId, requestedByUserId: userId, trigger: 'api' as const, idempotencyKey: 'same-instant' };

    const [a, b] = await Promise.all([orchestrator.enqueue(request), orchestrator.enqueue(request)]);

    expect(a.id).toBe(b.id);
    expect(await privilegedDb.select().from(testPlanExecutions)).toHaveLength(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it('treats the same key in another organization as a different request', async () => {
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);
    const otherPlanId = uuidv4();
    await privilegedDb.insert(testPlans).values({
      id: otherPlanId,
      name: 'Theirs',
      userId: outsiderId,
      organizationId: otherOrganizationId,
    } as any);

    const ours = await orchestrator.enqueue({ planId, requestedByUserId: userId, trigger: 'api', idempotencyKey: 'nightly' });
    const theirs = await orchestrator.enqueue({
      planId: otherPlanId,
      requestedByUserId: outsiderId,
      trigger: 'api',
      idempotencyKey: 'nightly',
    });

    expect(theirs.id).not.toBe(ours.id);
    expect(theirs.organizationId).toBe(otherOrganizationId);
  });

  it('leaves a run the queue refused in error with a reason, and retries it when asked again with its key', async () => {
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);
    const request = { planId, requestedByUserId: userId, trigger: 'api' as const, idempotencyKey: 'redis-blip' };

    queue.failOnce();
    const failure = await orchestrator.enqueue(request).catch((error) => error);

    expect(failure).toBeInstanceOf(ExecutionEnqueueError);
    expect(failure).toMatchObject({ code: QUEUE_SUBMISSION_FAILED, status: 503 });
    const failed = await executionRow(failure.executionId);
    expect(failed).toMatchObject({ status: 'error', failureCode: QUEUE_SUBMISSION_FAILED });
    expect(failed.completedAt).not.toBeNull();
    expect(queue.jobs).toHaveLength(0);

    const retried = await orchestrator.enqueue(request);

    expect(retried.id).toBe(failure.executionId);
    expect(await executionRow(retried.id)).toMatchObject({ status: 'queued', failureCode: null, completedAt: null });
    expect(queue.jobs).toHaveLength(1);
  });

  it('does not take back a run that failed for any other reason', async () => {
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);
    const request = { planId, requestedByUserId: userId, trigger: 'api' as const, idempotencyKey: 'ran-and-failed' };
    const first = await orchestrator.enqueue(request);
    await privilegedDb
      .update(testPlanExecutions)
      .set({ status: 'error', failureCode: 'run_incomplete' })
      .where(eq(testPlanExecutions.id, first.id));

    const again = await orchestrator.enqueue(request);

    expect(again).toMatchObject({ id: first.id, status: 'error', failureCode: 'run_incomplete' });
    expect(queue.jobs).toHaveLength(1);
  });

  it('refuses a requester from another organization, and records nothing', async () => {
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);

    await expect(
      orchestrator.enqueue({ planId, requestedByUserId: outsiderId, trigger: 'api' }),
    ).rejects.toMatchObject({ code: 'requester_not_in_organization', status: 403 });

    expect(await privilegedDb.select().from(testPlanExecutions)).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
  });

  it("refuses another organization's environment, whose secrets the run would otherwise load", async () => {
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);
    const [theirs] = await privilegedDb
      .insert(environments)
      .values({ name: `theirs-${uuidv4().slice(0, 8)}`, userId: outsiderId, organizationId: otherOrganizationId })
      .returning();
    const [ours] = await privilegedDb
      .insert(environments)
      .values({ name: `ours-${uuidv4().slice(0, 8)}`, userId, organizationId })
      .returning();

    await expect(
      orchestrator.enqueue({ planId, requestedByUserId: userId, trigger: 'manual', environmentId: theirs.id }),
    ).rejects.toMatchObject({ code: 'environment_not_found', status: 404 });

    const accepted = await orchestrator.enqueue({ planId, requestedByUserId: userId, trigger: 'manual', environmentId: ours.id });
    expect(accepted.environment).toBe(String(ours.id));
    expect(accepted.configurationSnapshot).toMatchObject({ environmentId: ours.id });
  });

  it('says a plan that does not exist was not found', async () => {
    const orchestrator = createExecutionOrchestrator(capturingQueue());
    await expect(
      orchestrator.enqueue({ planId: uuidv4(), requestedByUserId: userId, trigger: 'manual' }),
    ).rejects.toMatchObject({ code: 'plan_not_found', status: 404 });
  });
});

describe('retrying a failed run', () => {
  async function failedRun(maxAttempts: number, status: 'failed' | 'error' | 'cancelled' | 'timed_out' = 'failed') {
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);
    const first = await orchestrator.enqueue({ planId, requestedByUserId: userId, trigger: 'scheduled', maxAttempts });
    const [ended] = await privilegedDb
      .update(testPlanExecutions)
      .set({ status, completedAt: new Date() })
      .where(eq(testPlanExecutions.id, first.id))
      .returning();
    return { queue, orchestrator, first: ended };
  }

  const inTenant = <T>(fn: () => Promise<T>) => runWithTenant(organizationId, fn);

  it('queues the next attempt with the first attempt\'s configuration, after the delay', async () => {
    const { queue, orchestrator, first } = await failedRun(3);
    // The plan changes between the attempts; the retry tries the same thing again.
    await privilegedDb.update(testPlans).set({ maxParallelTests: 9 }).where(eq(testPlans.id, planId));

    const retry = await inTenant(() => orchestrator.retryFailedRun(first, 30_000));

    expect(retry).toMatchObject({
      status: 'queued',
      attempt: 2,
      maxAttempts: 3,
      retryOfExecutionId: first.id,
      triggeredBy: 'scheduled',
      requestedByUserId: userId,
    });
    expect(retry!.configurationSnapshot).toEqual(first.configurationSnapshot);
    expect(queue.jobs.at(-1)).toMatchObject({ options: { jobId: retry!.id, delay: 30_000 } });
  });

  it('queues one retry however many times the same attempt is reported finished', async () => {
    const { queue, orchestrator, first } = await failedRun(2);

    const a = await inTenant(() => orchestrator.retryFailedRun(first, 0));
    const b = await inTenant(() => orchestrator.retryFailedRun(first, 0));

    expect(b!.id).toBe(a!.id);
    expect(queue.jobs).toHaveLength(2); // the first attempt and one retry
  });

  it('points every later attempt at the first, and stops at the last', async () => {
    const { orchestrator, first } = await failedRun(3);
    const second = await inTenant(() => orchestrator.retryFailedRun(first, 0));
    const [secondFailed] = await privilegedDb
      .update(testPlanExecutions)
      .set({ status: 'error' })
      .where(eq(testPlanExecutions.id, second!.id))
      .returning();

    const third = await inTenant(() => orchestrator.retryFailedRun(secondFailed, 0));
    expect(third).toMatchObject({ attempt: 3, retryOfExecutionId: first.id });

    const [thirdFailed] = await privilegedDb
      .update(testPlanExecutions)
      .set({ status: 'failed' })
      .where(eq(testPlanExecutions.id, third!.id))
      .returning();
    expect(await inTenant(() => orchestrator.retryFailedRun(thirdFailed, 0))).toBeNull();
  });

  it('does not retry a run somebody cancelled or that ran out of time, or one allowed a single attempt', async () => {
    for (const status of ['cancelled', 'timed_out'] as const) {
      const { orchestrator, first } = await failedRun(3, status);
      expect(await inTenant(() => orchestrator.retryFailedRun(first, 0))).toBeNull();
    }
    const { orchestrator, first } = await failedRun(1);
    expect(await inTenant(() => orchestrator.retryFailedRun(first, 0))).toBeNull();
  });

  it('does not retry for a schedule that has been switched off since', async () => {
    const [schedule] = await privilegedDb
      .insert(testPlanSchedules)
      .values({
        id: uuidv4(),
        testPlanId: planId,
        organizationId,
        userId,
        scheduleName: 'Nightly',
        frequency: 'daily',
        nextRunAt: new Date(),
        isActive: false,
      })
      .returning();
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);
    const first = await orchestrator.enqueue({
      planId,
      requestedByUserId: userId,
      trigger: 'scheduled',
      scheduleId: schedule.id,
      maxAttempts: 3,
    });
    const [failed] = await privilegedDb
      .update(testPlanExecutions)
      .set({ status: 'failed' })
      .where(eq(testPlanExecutions.id, first.id))
      .returning();

    expect(await inTenant(() => orchestrator.retryFailedRun(failed, 0))).toBeNull();
  });

  it('is queued by the worker when an attempt fails, and not after the last one', async () => {
    const execution = await runWithTenant(organizationId, async () => {
      const { executionOrchestrator } = await import('./execution-orchestrator');
      return executionOrchestrator.enqueue({ planId, requestedByUserId: userId, trigger: 'scheduled', maxAttempts: 2 });
    });
    executeTestSequence.mockResolvedValue({ success: false, error: 'Button not found', steps: [], duration: 5 });

    await processTestPlanJob(planId, execution.id, userId);

    expect((await executionRow(execution.id)).status).toBe('failed');
    const [retry] = await privilegedDb
      .select()
      .from(testPlanExecutions)
      .where(eq(testPlanExecutions.retryOfExecutionId, execution.id));
    expect(retry).toMatchObject({ status: 'queued', attempt: 2 });
    expect(productionQueueAdds.map((job) => job.options.jobId)).toEqual([execution.id, retry.id]);

    // The last attempt failing is the verdict: nothing further is queued.
    await processTestPlanJob(planId, retry.id, userId);
    expect((await executionRow(retry.id)).status).toBe('failed');
    expect(await privilegedDb.select().from(testPlanExecutions)).toHaveLength(2);
  });
});

describe('a plan edited while its run waits', () => {
  it('does not change what the run does', async () => {
    const queue = capturingQueue();
    const orchestrator = createExecutionOrchestrator(queue);
    const execution = await orchestrator.enqueue({ planId, requestedByUserId: userId, trigger: 'manual' });

    // Somebody edits the plan before a worker gets to the run: another test instead of the
    // first, and a new name.
    await privilegedDb.delete(testPlanSelectedTests).where(eq(testPlanSelectedTests.testPlanId, planId));
    await privilegedDb.insert(testPlanSelectedTests).values({
      testPlanId: planId,
      testType: 'ui',
      testId: secondTestId,
      organizationId,
    } as any);
    await privilegedDb.update(testPlans).set({ name: 'Checkout (renamed)' }).where(eq(testPlans.id, planId));

    const job = queue.jobs[0];
    await processTestPlanJob(job.data.planId as string, job.data.executionId as string, userId);

    const results = await privilegedDb
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, execution.id));
    expect(results.map((result) => result.uiTestId)).toEqual([firstTestId]);
    expect(executeTestSequence).toHaveBeenCalledTimes(1);
    expect((await executionRow(execution.id)).status).toBe('completed');
  });

  it('runs a row from before snapshots with the plan as it is, as it always did', async () => {
    const executionId = uuidv4();
    await privilegedDb.insert(testPlanExecutions).values({
      id: executionId,
      organizationId,
      testPlanId: planId,
      status: 'queued',
      triggeredBy: 'scheduled',
    } as any);
    await privilegedDb.delete(testPlanSelectedTests).where(eq(testPlanSelectedTests.testPlanId, planId));
    await privilegedDb.insert(testPlanSelectedTests).values({
      testPlanId: planId,
      testType: 'ui',
      testId: secondTestId,
      organizationId,
    } as any);

    await processTestPlanJob(planId, executionId, userId);

    const results = await privilegedDb
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
    expect(results.map((result) => result.uiTestId)).toEqual([secondTestId]);
  });
});
