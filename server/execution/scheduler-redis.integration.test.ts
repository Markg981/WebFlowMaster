import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// Integration test of the BullMQ scheduler path against a REAL Redis (QA-01).
// Gated like the other Redis tests: it runs when REDIS_URL is set (CI's server-tests job has a
// Redis service container) and is skipped otherwise. Real here: the queue, the repeatable job
// schedulers, a BullMQ worker, scheduler-service and the PGlite database. Mocked: only the run
// execution (executionOrchestrator.enqueue), which would otherwise need a browser.
const REDIS_URL = process.env.REDIS_URL;
const enabled = Boolean(REDIS_URL);

const { enqueueSpy, runsByKey } = vi.hoisted(() => ({
  enqueueSpy: vi.fn(),
  runsByKey: new Map<string, { id: string; maxAttempts: number }>(),
}));

vi.mock('../platform/queue', async () => {
  const { TracedQueue } = await import('../platform/observability/queue');
  const name = `scheduler-it-${process.pid}-${Math.random().toString(36).slice(2)}`;
  return {
    TEST_EXECUTION_QUEUE_NAME: name,
    testExecutionQueue: process.env.REDIS_URL
      ? new TracedQueue(name, { connection: { url: process.env.REDIS_URL } })
      : {},
  };
});
vi.mock('./execution-orchestrator', () => ({
  ExecutionEnqueueError: class ExecutionEnqueueError extends Error {
    code = 'enqueue_failed';
  },
  executionOrchestrator: { enqueue: enqueueSpy },
}));
vi.mock('../platform/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn() },
}));

import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import { users, testPlans, testPlanSchedules, type TestPlanSchedule } from '@shared/schema';
import { testExecutionQueue, TEST_EXECUTION_QUEUE_NAME } from '../platform/queue';
import {
  bullmqAddScheduleJob,
  bullmqInitializeScheduler,
  bullmqRemoveScheduleJob,
  bullmqUpdateScheduleJob,
  executeScheduledPlan,
  scheduledOccurrence,
  TRIGGER_SCHEDULE_JOB,
} from './scheduler-service';
import { createTestOrganization } from '../tests/factories';

const EVERY_SECOND = 'cron:* * * * * *';
const EVERY_OTHER_SECOND = 'cron:*/2 * * * * *';

const rnd = () => Math.random().toString(36).slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(100);
  }
  throw new Error(`condition not met within ${timeoutMs} ms`);
}

async function seedSchedule(overrides: Partial<typeof testPlanSchedules.$inferInsert> = {}) {
  const organizationId = await createTestOrganization();
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `u_${rnd()}`, password: 'x', organizationId })
    .returning();
  const planId = `plan_${rnd()}`;
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, userId: user.id, organizationId, name: 'Plan' });
  const [s] = await privilegedDb
    .insert(testPlanSchedules)
    .values({
      id: `sched_${rnd()}`,
      testPlanId: planId,
      organizationId,
      userId: user.id,
      scheduleName: 'S',
      frequency: EVERY_SECOND,
      nextRunAt: new Date(Date.now() + 60_000),
      isActive: true,
      retryOnFailure: 'none',
      ...overrides,
    })
    .returning();
  return s as TestPlanSchedule;
}

const schedulerKeys = async () =>
  (await testExecutionQueue.getJobSchedulers(0, -1)).map((j) => j.key);
const runsFor = (scheduleId: string) =>
  enqueueSpy.mock.calls.filter(([a]) => a.scheduleId === scheduleId);

describe.skipIf(!enabled)('BullMQ scheduler against a real Redis', () => {
  const workers: Worker[] = [];
  const extraQueues: Queue[] = [];
  const processedJobs: string[] = [];

  // The same steps as the TRIGGER_SCHEDULE_JOB branch of server/worker.ts.
  const startWorker = () => {
    const w = new Worker(
      TEST_EXECUTION_QUEUE_NAME,
      async (job: Job) => {
        if (job.name !== TRIGGER_SCHEDULE_JOB) return;
        processedJobs.push(String(job.id));
        const [schedule] = await privilegedDb
          .select()
          .from(testPlanSchedules)
          .where(eq(testPlanSchedules.id, job.data.scheduleId))
          .limit(1);
        if (!schedule || !schedule.isActive) return;
        const [plan] = await privilegedDb
          .select()
          .from(testPlans)
          .where(eq(testPlans.id, schedule.testPlanId))
          .limit(1);
        if (!plan) return;
        await executeScheduledPlan(schedule, plan, scheduledOccurrence(job));
      },
      { connection: { url: REDIS_URL! } },
    );
    workers.push(w);
    return w;
  };

  beforeAll(async () => {
    await testExecutionQueue.waitUntilReady();
  });
  beforeEach(async () => {
    processedJobs.length = 0;
    enqueueSpy.mockReset();
    runsByKey.clear();
    // Like the orchestrator: one run per idempotency key.
    enqueueSpy.mockImplementation(async (input: { idempotencyKey: string }) => {
      let run = runsByKey.get(input.idempotencyKey);
      if (!run) {
        run = { id: `run_${runsByKey.size + 1}`, maxAttempts: 1 };
        runsByKey.set(input.idempotencyKey, run);
      }
      return run;
    });
    await Promise.all(workers.splice(0).map((w) => w.close()));
    await testExecutionQueue.obliterate({ force: true });
  });
  afterAll(async () => {
    await Promise.all(workers.splice(0).map((w) => w.close()));
    await testExecutionQueue.obliterate({ force: true }).catch(() => undefined);
    await Promise.all(extraQueues.map((q) => q.close()));
    await testExecutionQueue.close();
  });

  it('a registered repeatable schedule fires and creates a run', async () => {
    const schedule = await seedSchedule();
    await bullmqAddScheduleJob(schedule);
    expect(await schedulerKeys()).toEqual([schedule.id]);

    startWorker();
    await waitFor(() => runsFor(schedule.id).length > 0);
    const [input] = runsFor(schedule.id)[0];
    expect(input).toMatchObject({
      planId: schedule.testPlanId,
      trigger: 'scheduled',
      scheduleId: schedule.id,
      requestedByUserId: schedule.userId,
    });
    expect(input.idempotencyKey).toContain(`schedule-${schedule.id}-`);
  });

  it('a one-off schedule already in the past at startup is deactivated, not fired', async () => {
    const schedule = await seedSchedule({
      frequency: 'once',
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    startWorker();
    await bullmqInitializeScheduler();

    const [after] = await privilegedDb
      .select()
      .from(testPlanSchedules)
      .where(eq(testPlanSchedules.id, schedule.id));
    expect(after.isActive).toBe(false);
    expect(await schedulerKeys()).not.toContain(schedule.id);
    expect(await testExecutionQueue.getJob(`once-${schedule.id}`)).toBeFalsy();
    await sleep(1_500);
    expect(runsFor(schedule.id)).toHaveLength(0);
  });

  it('a one-off schedule in the future is queued as a delayed job and fires once', async () => {
    const schedule = await seedSchedule({
      frequency: 'once',
      nextRunAt: new Date(Date.now() + 1_500),
    });
    await bullmqAddScheduleJob(schedule);
    expect(await testExecutionQueue.getJob(`once-${schedule.id}`)).toBeTruthy();

    startWorker();
    await waitFor(() => runsFor(schedule.id).length > 0);
    await sleep(1_500);
    expect(runsFor(schedule.id)).toHaveLength(1);
  });

  it('updating a schedule replaces its repeatable job without a duplicate', async () => {
    const schedule = await seedSchedule();
    await bullmqAddScheduleJob(schedule);
    const before = (await testExecutionQueue.getJobSchedulers(0, -1)).find(
      (j) => j.key === schedule.id,
    );
    expect(before?.pattern).toBe('* * * * * *');

    await bullmqUpdateScheduleJob({ ...schedule, frequency: EVERY_OTHER_SECOND });
    const after = await testExecutionQueue.getJobSchedulers(0, -1);
    expect(after.filter((j) => j.key === schedule.id)).toHaveLength(1);
    expect(after.find((j) => j.key === schedule.id)?.pattern).toBe('*/2 * * * * *');

    // Registering the same schedule again is idempotent too.
    await bullmqAddScheduleJob({ ...schedule, frequency: EVERY_OTHER_SECOND });
    expect((await schedulerKeys()).filter((k) => k === schedule.id)).toHaveLength(1);
  });

  it('deleting a schedule removes its job and nothing fires afterwards', async () => {
    const schedule = await seedSchedule();
    await bullmqAddScheduleJob(schedule);
    startWorker();
    await waitFor(() => runsFor(schedule.id).length > 0);

    await bullmqRemoveScheduleJob(schedule.id);
    expect(await schedulerKeys()).not.toContain(schedule.id);
    await sleep(1_500); // let an in-flight occurrence settle
    const settled = runsFor(schedule.id).length;
    await sleep(2_500);
    expect(runsFor(schedule.id)).toHaveLength(settled);
  });

  it('two scheduler instances do not double-enqueue the same occurrence', async () => {
    const schedule = await seedSchedule();
    // A second instance (its own queue connection) registers the same schedule concurrently.
    const second = new Queue(TEST_EXECUTION_QUEUE_NAME, { connection: { url: REDIS_URL! } });
    extraQueues.push(second);
    await Promise.all([
      bullmqAddScheduleJob(schedule),
      second.upsertJobScheduler(
        schedule.id,
        { pattern: '* * * * * *', tz: 'UTC' },
        { name: TRIGGER_SCHEDULE_JOB, data: { scheduleId: schedule.id } },
      ),
    ]);
    expect((await schedulerKeys()).filter((k) => k === schedule.id)).toHaveLength(1);

    // Two workers (two replicas) compete for the same stream of occurrences.
    startWorker();
    startWorker();
    await waitFor(() => runsFor(schedule.id).length >= 3, 20_000);
    await bullmqRemoveScheduleJob(schedule.id);
    await sleep(1_500);

    // One job per occurrence: no occurrence was handed to both workers. (The run idempotency key is
    // bucketed per minute by design, so the every-second occurrences legitimately share one key.)
    expect(processedJobs.length).toBeGreaterThanOrEqual(3);
    expect(processedJobs.length).toBe(new Set(processedJobs).size);
  });
});
