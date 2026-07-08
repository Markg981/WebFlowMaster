import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Mock only external/non-deterministic collaborators; the DB is the real PGlite test DB.
vi.mock('node-cron', () => ({
  default: { schedule: vi.fn(() => ({ stop: vi.fn(), start: vi.fn() })), validate: vi.fn(() => true) },
}));
vi.mock('./test-execution-service', () => ({ runTestPlan: vi.fn() }));
vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { db } from './db';
import { users, testPlans, testPlanSchedules, testPlanExecutions } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { runTestPlan } from './test-execution-service';
import { executeScheduledPlanForTest } from './scheduler-service';

const mockRun = vi.mocked(runTestPlan);

function rnd() {
  return Math.random().toString(36).slice(2);
}

async function seedSchedule(retryOnFailure: string) {
  const [user] = await db.insert(users).values({ username: `u_${rnd()}`, password: 'x' }).returning();
  const planId = `plan_${rnd()}`;
  const [plan] = await db.insert(testPlans).values({ id: planId, userId: user.id, name: 'Plan' }).returning();
  const [schedule] = await db
    .insert(testPlanSchedules)
    .values({
      id: `sched_${rnd()}`,
      testPlanId: planId,
      userId: user.id,
      scheduleName: 'S',
      frequency: 'daily',
      nextRunAt: new Date(),
      retryOnFailure,
    })
    .returning();
  return { plan, schedule };
}

async function cleanup() {
  await db.delete(testPlanExecutions);
  await db.delete(testPlanSchedules);
  await db.delete(testPlans);
  await db.delete(users);
}

describe('scheduler retry-on-failure', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanup();
  });
  afterAll(cleanup);

  it('does not retry when the policy is "none"', async () => {
    const { plan, schedule } = await seedSchedule('none');
    mockRun.mockResolvedValue({ status: 'failed' } as any);

    await executeScheduledPlanForTest(schedule, plan);

    expect(mockRun).toHaveBeenCalledTimes(1);
    const [exec] = await db.select().from(testPlanExecutions).where(eq(testPlanExecutions.scheduleId, schedule.id));
    expect(exec.status).toBe('failed');
  });

  it('retries up to the policy limit when every run fails', async () => {
    const { plan, schedule } = await seedSchedule('twice');
    mockRun.mockResolvedValue({ status: 'failed' } as any);

    await executeScheduledPlanForTest(schedule, plan);

    expect(mockRun).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    const [exec] = await db.select().from(testPlanExecutions).where(eq(testPlanExecutions.scheduleId, schedule.id));
    expect(exec.status).toBe('failed');
  });

  it('stops retrying as soon as a run succeeds', async () => {
    const { plan, schedule } = await seedSchedule('twice');
    mockRun
      .mockResolvedValueOnce({ status: 'failed' } as any)
      .mockResolvedValueOnce({ status: 'passed' } as any);

    await executeScheduledPlanForTest(schedule, plan);

    expect(mockRun).toHaveBeenCalledTimes(2); // failed, then passed → stop
    const [exec] = await db.select().from(testPlanExecutions).where(eq(testPlanExecutions.scheduleId, schedule.id));
    expect(exec.status).toBe('passed');
  });
});
