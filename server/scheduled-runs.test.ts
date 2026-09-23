import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';

/**
 * A scheduled occurrence asks for one run, through the same command as everything else.
 *
 * The scheduler used to insert a row of its own, call an enqueue that inserted a second one, and
 * then retry — or write a verdict — from the enqueue's answer, which is only ever "queued". Its
 * environment, a name like "QA", was parsed as a number by the runner and never loaded.
 */

const queued: Array<{ name: string; data: Record<string, unknown>; options: Record<string, unknown> }> = [];

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn(() => ({ stop: vi.fn(), start: vi.fn() })), validate: vi.fn(() => true) },
}));
vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn() }),
}));
vi.mock('./queue', () => ({
  TEST_EXECUTION_QUEUE_NAME: 'test-queue',
  testExecutionQueue: {
    add: vi.fn(async (name: string, data: Record<string, unknown>, options: Record<string, unknown>) => {
      queued.push({ name, data, options });
      return { id: options?.jobId };
    }),
    upsertJobScheduler: vi.fn(),
    removeJobScheduler: vi.fn(),
    remove: vi.fn(),
    getJobSchedulers: vi.fn(async () => []),
  },
}));

import { privilegedDb } from './db';
import { environments, testPlanExecutions, testPlanSchedules, testPlans, users, type TestPlanSchedule } from '@shared/schema';
import {
  attemptsForPolicy,
  executeScheduledPlanForTest,
  occurrenceKey,
  scheduledOccurrence,
} from './scheduler-service';
import { createTestOrganization } from './tests/factories';

function rnd() {
  return Math.random().toString(36).slice(2);
}

const occurrence = new Date('2026-09-24T02:00:00.000Z');

async function seed(scheduleColumns: Partial<TestPlanSchedule> = {}) {
  const organizationId = await createTestOrganization();
  const [owner] = await privilegedDb.insert(users).values({ username: `u_${rnd()}`, password: 'x', organizationId }).returning();
  const [plan] = await privilegedDb
    .insert(testPlans)
    .values({ id: `plan_${rnd()}`, userId: owner.id, organizationId, name: 'Nightly' })
    .returning();
  const [schedule] = await privilegedDb
    .insert(testPlanSchedules)
    .values({
      id: `sched_${rnd()}`,
      testPlanId: plan.id,
      organizationId,
      userId: owner.id,
      scheduleName: 'Every night',
      frequency: 'daily',
      nextRunAt: occurrence,
      browsers: ['chromium', 'firefox'],
      ...scheduleColumns,
    })
    .returning();
  return { organizationId, owner, plan, schedule };
}

async function runsOf(scheduleId: string) {
  return privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.scheduleId, scheduleId));
}

async function cleanup() {
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlanSchedules);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(environments);
  await privilegedDb.delete(users);
}

beforeEach(async () => {
  queued.length = 0;
  await cleanup();
});
afterAll(cleanup);

describe('a scheduled occurrence', () => {
  it('queues exactly one run, with the schedule on it, and one job for that run', async () => {
    const { owner, plan, schedule } = await seed({ retryOnFailure: 'twice' });

    const execution = await executeScheduledPlanForTest(schedule, plan, occurrence);

    const runs = await runsOf(schedule.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: execution!.id,
      testPlanId: plan.id,
      status: 'queued',
      triggeredBy: 'scheduled',
      requestedByUserId: owner.id,
      attempt: 1,
      maxAttempts: 3,
      idempotencyKey: occurrenceKey(schedule.id, occurrence),
    });
    expect(runs[0].configurationSnapshot).toMatchObject({
      browsers: { requested: ['chromium', 'firefox'] },
    });
    expect(queued).toEqual([
      expect.objectContaining({ name: 'execute-plan', options: { jobId: execution!.id } }),
    ]);
  });

  it('is one run however many replicas fire it, and the next occurrence is another', async () => {
    const { plan, schedule } = await seed();

    const first = await executeScheduledPlanForTest(schedule, plan, occurrence);
    // Another replica, a few seconds into the same minute.
    const again = await executeScheduledPlanForTest(schedule, plan, new Date(occurrence.getTime() + 7_000));
    const tomorrow = await executeScheduledPlanForTest(schedule, plan, new Date(occurrence.getTime() + 86_400_000));

    expect(again!.id).toBe(first!.id);
    expect(tomorrow!.id).not.toBe(first!.id);
    expect(await runsOf(schedule.id)).toHaveLength(2);
    expect(queued).toHaveLength(2);
  });

  it('loads the environment the schedule names, found by name in its own organization', async () => {
    const { organizationId, owner, plan, schedule } = await seed({ environment: 'QA' });
    const [qa] = await privilegedDb
      .insert(environments)
      .values({ name: 'QA', userId: owner.id, organizationId })
      .returning();

    const execution = await executeScheduledPlanForTest(schedule, plan, occurrence);

    expect(execution!.environment).toBe(String(qa.id));
    expect(execution!.configurationSnapshot).toMatchObject({ environmentId: qa.id });
  });

  it("does not borrow another organization's environment of the same name", async () => {
    const { plan, schedule } = await seed({ environment: 'Staging' });
    const otherOrganizationId = await createTestOrganization('Elsewhere');
    const [stranger] = await privilegedDb
      .insert(users)
      .values({ username: `s_${rnd()}`, password: 'x', organizationId: otherOrganizationId })
      .returning();
    await privilegedDb
      .insert(environments)
      .values({ name: 'Staging', userId: stranger.id, organizationId: otherOrganizationId });

    const execution = await executeScheduledPlanForTest(schedule, plan, occurrence);

    // Runs without an environment, as a name that matches nothing always did, and still says
    // which one was asked for.
    expect(execution!.environment).toBe('Staging');
    expect(execution!.configurationSnapshot).toMatchObject({ environmentId: null });
  });

  it('does not run a schedule switched off after the cron job captured it, nor move it on', async () => {
    const { plan, schedule } = await seed();
    await privilegedDb.update(testPlanSchedules).set({ isActive: false }).where(eq(testPlanSchedules.id, schedule.id));

    const execution = await executeScheduledPlanForTest(schedule, plan, occurrence);

    expect(execution).toBeNull();
    expect(await runsOf(schedule.id)).toHaveLength(0);
    expect(queued).toHaveLength(0);
    const [after] = await privilegedDb.select().from(testPlanSchedules).where(eq(testPlanSchedules.id, schedule.id));
    expect(after.nextRunAt).toEqual(schedule.nextRunAt);
  });

  it('uses the schedule as it is now, not as the cron job captured it', async () => {
    const { plan, schedule } = await seed();
    await privilegedDb.update(testPlanSchedules).set({ browsers: ['webkit'] }).where(eq(testPlanSchedules.id, schedule.id));

    const execution = await executeScheduledPlanForTest(schedule, plan, occurrence);

    expect(execution!.configurationSnapshot).toMatchObject({ browsers: { requested: ['webkit'] } });
  });

  it('runs a schedule from before owners were recorded on behalf of the plan owner', async () => {
    const { owner, plan, schedule } = await seed({ userId: null });

    const execution = await executeScheduledPlanForTest(schedule, plan, occurrence);

    expect(execution!.requestedByUserId).toBe(owner.id);
  });

  it('moves a recurring schedule on to its next occurrence, and retires a one-off one', async () => {
    const daily = await seed();
    await executeScheduledPlanForTest(daily.schedule, daily.plan, occurrence);
    const [dailyAfter] = await privilegedDb.select().from(testPlanSchedules).where(eq(testPlanSchedules.id, daily.schedule.id));
    expect(dailyAfter.nextRunAt.getTime()).toBeGreaterThan(Date.now());

    const once = await seed({ frequency: 'once' });
    await executeScheduledPlanForTest(once.schedule, once.plan, occurrence);
    const [onceAfter] = await privilegedDb.select().from(testPlanSchedules).where(eq(testPlanSchedules.id, once.schedule.id));
    expect(onceAfter.isActive).toBe(false);
  });
});

describe('the pieces a scheduled run is keyed and counted by', () => {
  it('turns a retry policy into a number of attempts', () => {
    expect(attemptsForPolicy('none')).toBe(1);
    expect(attemptsForPolicy(null)).toBe(1);
    expect(attemptsForPolicy('once')).toBe(2);
    expect(attemptsForPolicy('twice')).toBe(3);
  });

  it('keys an occurrence by its minute', () => {
    expect(occurrenceKey('s1', new Date('2026-09-24T02:00:59.999Z'))).toBe('schedule-s1-2026-09-24T02:00:00.000Z');
    expect(occurrenceKey('s1', new Date('2026-09-24T02:01:00.000Z'))).toBe('schedule-s1-2026-09-24T02:01:00.000Z');
  });

  it('reads the occurrence a BullMQ trigger was meant for, not when it was picked up', () => {
    const at = Date.parse('2026-09-24T02:00:00.000Z');
    expect(scheduledOccurrence({ timestamp: at - 86_400_000, opts: { prevMillis: at, delay: 86_400_000 } }).getTime()).toBe(at);
    expect(scheduledOccurrence({ timestamp: at - 60_000, opts: { delay: 60_000 } }).getTime()).toBe(at);
  });
});
