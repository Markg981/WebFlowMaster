import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Mock only external collaborators; the database is the real PGlite test DB.
// scheduler-service imports node-cron as a namespace (`import * as cron`), so the
// mock must expose `schedule`/`validate` as top-level exports (not only default).
const { scheduleSpy, validateSpy } = vi.hoisted(() => ({
  scheduleSpy: vi.fn(() => ({ stop: vi.fn(), start: vi.fn() })),
  validateSpy: vi.fn(() => true),
}));
vi.mock('node-cron', () => ({
  schedule: scheduleSpy,
  validate: validateSpy,
  default: { schedule: scheduleSpy, validate: validateSpy },
}));
vi.mock('./test-execution-service', () => ({ runTestPlan: vi.fn().mockResolvedValue({ status: 'passed' }) }));
vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn() }),
}));

import { privilegedDb } from './db';
import { users, testPlans, testPlanSchedules, testPlanExecutions, type TestPlanSchedule } from '@shared/schema';
import { eq } from 'drizzle-orm';
import {
  addScheduleJob,
  removeScheduleJob,
  updateScheduleJob,
  initializeScheduler,
  shutdownScheduler,
  frequencyToCronPatternForTest as frequencyToCronPattern,
  calculateNextRunTimeForTest as calculateNextRunTime,
} from './scheduler-service';
import { createTestOrganization } from './tests/factories';

function rnd() {
  return Math.random().toString(36).slice(2);
}

async function seedPlan() {
  const organizationId = await createTestOrganization();
  const [user] = await privilegedDb.insert(users).values({ username: `u_${rnd()}`, password: 'x', organizationId }).returning();
  const planId = `plan_${rnd()}`;
  await privilegedDb.insert(testPlans).values({ id: planId, userId: user.id, organizationId, name: 'Plan' }).returning();
  return { userId: user.id, planId, organizationId };
}

async function seedSchedule(planId: number | string, userId: number, overrides: Partial<typeof testPlanSchedules.$inferInsert> = {}) {
  // A schedule belongs to the same organization as the test plan it schedules.
  const [plan] = await privilegedDb.select({ organizationId: testPlans.organizationId }).from(testPlans).where(eq(testPlans.id, planId as string)).limit(1);
  const [s] = await privilegedDb
    .insert(testPlanSchedules)
    .values({
      id: `sched_${rnd()}`,
      testPlanId: planId as string,
      organizationId: plan.organizationId,
      userId,
      scheduleName: 'S',
      frequency: 'daily',
      nextRunAt: new Date(Date.now() + 3_600_000),
      isActive: true,
      retryOnFailure: 'none',
      ...overrides,
    })
    .returning();
  return s as TestPlanSchedule;
}

async function cleanup() {
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlanSchedules);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(users);
}

describe('Scheduler Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await shutdownScheduler(); // clear the in-memory cron-job map for isolation
    await cleanup();
  });
  afterAll(async () => {
    await shutdownScheduler();
    await cleanup();
  });

  describe('frequencyToCronPattern', () => {
    it('converts "daily" to a cron pattern', () => {
      expect(frequencyToCronPattern('daily', new Date('2023-01-01T10:30:00Z'))).toBe('30 10 * * *');
    });
    it('converts "weekly" to a cron pattern', () => {
      expect(frequencyToCronPattern('weekly', new Date('2023-01-01T10:30:00Z'))).toBe('30 10 * * 0');
    });
    it('returns null for "once"', () => {
      expect(frequencyToCronPattern('once', new Date())).toBeNull();
    });
    it('returns the cron string for "cron:..."', () => {
      expect(frequencyToCronPattern('cron:0 0 * * *', new Date())).toBe('0 0 * * *');
    });
    it('handles "every_X_minutes/hours/days"', () => {
      expect(frequencyToCronPattern('every_30_minutes', new Date())).toBe('*/30 * * * *');
      expect(frequencyToCronPattern('every_2_hours', new Date())).toBe('0 */2 * * *');
      expect(frequencyToCronPattern('every_3_days', new Date('2023-01-01T08:15:00Z'))).toBe('0 8 */3 * *');
    });

    it('reads the wall-clock time in the schedule timezone, not in UTC', () => {
      // 01:30 UTC in January is 02:30 in Rome. A schedule the tester set to run at 02:30
      // has to produce 30 2, not 30 1 — otherwise the interface says one time and the
      // scheduler means another.
      expect(frequencyToCronPattern('daily', new Date('2024-01-15T01:30:00Z'), 'Europe/Rome'))
        .toBe('30 2 * * *');
    });

    it('still reads UTC when no timezone is given, so existing schedules do not move', () => {
      expect(frequencyToCronPattern('daily', new Date('2024-01-15T01:30:00Z'))).toBe('30 1 * * *');
    });

    it('takes the weekday in the schedule timezone too', () => {
      // 23:00 UTC on Monday is already Tuesday in Rome. Deriving the weekday in UTC would
      // schedule a "weekly on Tuesday" run for Monday.
      expect(frequencyToCronPattern('weekly', new Date('2024-01-15T23:00:00Z'), 'Europe/Rome'))
        .toBe('0 0 * * 2');
    });
  });

  describe('daylight saving time', () => {
    /** The wall-clock hour a moment falls on, as read in a given zone. */
    const hourIn = (date: Date, timeZone: string) =>
      Number(
        new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false })
          .format(date),
      );

    it('keeps a daily run at the same local hour on both sides of the change', () => {
      // The defect: everything resolved against UTC, so a 02:00 Europe/Rome nightly
      // regression silently ran at 03:00 for half the year and 02:00 for the other half.
      // Nobody changed anything; the clocks did.
      const winter = calculateNextRunTime('daily', new Date('2024-01-15T01:00:00Z'), 'Europe/Rome');
      const summer = calculateNextRunTime('daily', new Date('2024-07-15T00:00:00Z'), 'Europe/Rome');

      expect(winter).not.toBeNull();
      expect(summer).not.toBeNull();
      // Same wall-clock hour in Rome, despite Rome being UTC+1 in January and UTC+2 in July.
      expect(hourIn(winter!, 'Europe/Rome')).toBe(2);
      expect(hourIn(summer!, 'Europe/Rome')).toBe(2);
      // And therefore genuinely different UTC hours — which is the whole point.
      expect(winter!.getUTCHours()).toBe(1);
      expect(summer!.getUTCHours()).toBe(0);
    });

    it('rejects a timezone the platform does not know rather than silently using UTC', () => {
      expect(() => frequencyToCronPattern('daily', new Date(), 'Mars/Olympus_Mons')).toThrow(
        /timezone/i,
      );
    });
  });

  describe('addScheduleJob', () => {
    it('schedules a recurring job with the expected pattern', async () => {
      const { userId, planId } = await seedPlan();
      const schedule = await seedSchedule(planId, userId, { frequency: 'daily' });

      await addScheduleJob(schedule);

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      expect(scheduleSpy.mock.calls[0][0]).toBe(frequencyToCronPattern('daily', new Date(schedule.nextRunAt)));
    });

    it('does not schedule an inactive schedule', async () => {
      const { userId, planId } = await seedPlan();
      const schedule = await seedSchedule(planId, userId, { isActive: false });

      await addScheduleJob(schedule);

      expect(scheduleSpy).not.toHaveBeenCalled();
    });

    it('schedules a future "once" job at its specific date/time', async () => {
      const { userId, planId } = await seedPlan();
      const runAt = new Date(Date.now() + 3_600_000);
      const schedule = await seedSchedule(planId, userId, { frequency: 'once', nextRunAt: runAt });

      await addScheduleJob(schedule);

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      const expected = `${runAt.getUTCMinutes()} ${runAt.getUTCHours()} ${runAt.getUTCDate()} ${runAt.getUTCMonth() + 1} *`;
      expect(scheduleSpy.mock.calls[0][0]).toBe(expected);
    });
  });

  describe('removeScheduleJob', () => {
    it('stops the job when it exists', async () => {
      const { userId, planId } = await seedPlan();
      const schedule = await seedSchedule(planId, userId);
      await addScheduleJob(schedule);
      const job = scheduleSpy.mock.results[0].value as { stop: ReturnType<typeof vi.fn> };

      await removeScheduleJob(schedule.id);

      expect(job.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateScheduleJob', () => {
    it('removes the old job and adds a new one when still active', async () => {
      const { userId, planId } = await seedPlan();
      const schedule = await seedSchedule(planId, userId, { frequency: 'daily' });
      await addScheduleJob(schedule);
      const oldJob = scheduleSpy.mock.results[0].value as { stop: ReturnType<typeof vi.fn> };

      await updateScheduleJob({ ...schedule, frequency: 'weekly' });

      expect(oldJob.stop).toHaveBeenCalledTimes(1);
      expect(scheduleSpy).toHaveBeenCalledTimes(2); // original add + re-add
      expect(scheduleSpy.mock.calls[1][0]).toBe(frequencyToCronPattern('weekly', new Date(schedule.nextRunAt)));
    });

    it('removes the job when updated to inactive', async () => {
      const { userId, planId } = await seedPlan();
      const schedule = await seedSchedule(planId, userId);
      await addScheduleJob(schedule);
      const job = scheduleSpy.mock.results[0].value as { stop: ReturnType<typeof vi.fn> };

      await updateScheduleJob({ ...schedule, isActive: false });

      expect(job.stop).toHaveBeenCalledTimes(1);
      expect(scheduleSpy).toHaveBeenCalledTimes(1); // no re-add for an inactive schedule
    });
  });

  describe('initializeScheduler', () => {
    it('loads active schedules and schedules a job for each', async () => {
      const { userId, planId } = await seedPlan();
      await seedSchedule(planId, userId, { frequency: 'daily' });
      await seedSchedule(planId, userId, { frequency: 'weekly' });

      await initializeScheduler();

      expect(scheduleSpy).toHaveBeenCalledTimes(2);
    });

    it('deactivates and skips a past "once" schedule', async () => {
      const { userId, planId } = await seedPlan();
      const past = await seedSchedule(planId, userId, {
        frequency: 'once',
        nextRunAt: new Date(Date.now() - 3_600_000),
      });

      await initializeScheduler();

      expect(scheduleSpy).not.toHaveBeenCalled();
      const [row] = await privilegedDb.select().from(testPlanSchedules).where(eq(testPlanSchedules.id, past.id));
      expect(row.isActive).toBe(false);
    });
  });
});
