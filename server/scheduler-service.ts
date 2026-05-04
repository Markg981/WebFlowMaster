import { db } from './db';
import { testPlanSchedules, testPlanExecutions, testPlans } from '@shared/schema';
import type { TestPlanSchedule, TestPlanExecution, TestPlan } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import loggerPromise from './logger';
import { runTestPlan } from './test-execution-service';
import { schedulerQueue } from './queue';

// Convert frequency to standard cron pattern for BullMQ
function frequencyToCronPattern(frequency: string, nextRunAt: Date): string | null {
  if (frequency.startsWith('cron:')) {
    return frequency.substring(5).trim();
  }
  const hours = nextRunAt.getUTCHours();
  const minutes = nextRunAt.getUTCMinutes();

  switch (frequency) {
    case 'daily': return `${minutes} ${hours} * * *`;
    case 'weekly': return `${minutes} ${hours} * * ${nextRunAt.getUTCDay()}`;
    case 'monthly': return `${minutes} ${hours} ${nextRunAt.getUTCDate()} * *`;
    default: return null;
  }
}

export async function executeScheduledPlan(schedule: TestPlanSchedule, plan: TestPlan) {
  const logger = await loggerPromise;
  logger.info(`[SchedulerService] Executing plan ${plan.name} for schedule ${schedule.id}`);

  try {
    const runId = uuidv4();
    await db.insert(testPlanExecutions).values({
      id: runId,
      testPlanId: plan.id,
      status: "running",
      triggeredBy: `schedule:${schedule.id}`,
      environment: schedule.environment,
    });

    // In a real scenario, passing the user who created the schedule or a system user
    await runTestPlan(plan.id, 1);

    if (schedule.frequency === 'once') {
      logger.info(`[SchedulerService] 'Once' schedule ${schedule.id} complete. Deactivating.`);
      await db.update(testPlanSchedules).set({ isActive: false }).where(eq(testPlanSchedules.id, schedule.id));
      await removeScheduleJob(schedule.id);
    } else {
      // Update nextRunAt placeholder
      const now = new Date();
      const nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      await db.update(testPlanSchedules).set({ nextRunAt: nextRun, updatedAt: now }).where(eq(testPlanSchedules.id, schedule.id));
    }
  } catch (error) {
    logger.error(`[SchedulerService] Error executing plan ${plan.id} for schedule ${schedule.id}:`, error);
  }
}

export async function addScheduleJob(schedule: TestPlanSchedule) {
  const logger = await loggerPromise;
  if (!schedule.isActive) {
    logger.info(`[SchedulerService] Schedule ${schedule.id} is inactive.`);
    return;
  }

  const jobId = `schedule-${schedule.id}`;

  if (schedule.frequency === 'once') {
    const delay = schedule.nextRunAt.getTime() - Date.now();
    if (delay > 0) {
      await schedulerQueue.add('execute-scheduled-plan', { scheduleId: schedule.id }, {
        jobId,
        delay,
        removeOnComplete: true
      });
      logger.info(`[SchedulerService] Added delayed job for 'once' schedule ${schedule.id} (delay: ${delay}ms)`);
    } else {
      logger.info(`[SchedulerService] 'Once' schedule ${schedule.id} is in the past. Deactivating.`);
      await db.update(testPlanSchedules).set({ isActive: false }).where(eq(testPlanSchedules.id, schedule.id));
    }
  } else {
    const cronPattern = frequencyToCronPattern(schedule.frequency, new Date(schedule.nextRunAt));
    if (cronPattern) {
      await schedulerQueue.add('execute-scheduled-plan', { scheduleId: schedule.id }, {
        jobId,
        repeat: { pattern: cronPattern }
      });
      logger.info(`[SchedulerService] Added repeating BullMQ job for schedule ${schedule.id} with cron: ${cronPattern}`);
    }
  }
}

export async function removeScheduleJob(scheduleId: string) {
  const logger = await loggerPromise;
  const jobId = `schedule-${scheduleId}`;

  // Need to find and remove repeatable jobs by their specific repeat pattern keys
  const repeatableJobs = await schedulerQueue.getRepeatableJobs();
  const jobToRemove = repeatableJobs.find(job => job.id === jobId);

  if (jobToRemove) {
    await schedulerQueue.removeRepeatableByKey(jobToRemove.key);
    logger.info(`[SchedulerService] Removed repeating job for schedule ${scheduleId}`);
  } else {
    // Attempt normal removal for 'once' jobs
    const job = await schedulerQueue.getJob(jobId);
    if (job) {
      await job.remove();
      logger.info(`[SchedulerService] Removed delayed job for schedule ${scheduleId}`);
    }
  }
}

export async function updateScheduleJob(schedule: TestPlanSchedule) {
  await removeScheduleJob(schedule.id);
  if (schedule.isActive) {
    await addScheduleJob(schedule);
  }
}

export async function initializeScheduler() {
  const logger = await loggerPromise;
  logger.info('[SchedulerService] Initializing BullMQ scheduler...');

  try {
    const schedulesToLoad = await db.select().from(testPlanSchedules).where(eq(testPlanSchedules.isActive, true));
    logger.info(`[SchedulerService] Found ${schedulesToLoad.length} active schedules.`);

    // Optional: Clear existing repeatable jobs in BullMQ to sync DB state completely
    const repeatableJobs = await schedulerQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await schedulerQueue.removeRepeatableByKey(job.key);
    }

    for (const schedule of schedulesToLoad) {
      await addScheduleJob(schedule);
    }
    logger.info('[SchedulerService] BullMQ Scheduler initialized successfully.');
  } catch (error: any) {
    logger.error(`[SchedulerService] Error initializing scheduler: ${error.message}`);
  }
}

export default {
  initializeScheduler,
  addScheduleJob,
  updateScheduleJob,
  removeScheduleJob,
  executeScheduledPlan
};
