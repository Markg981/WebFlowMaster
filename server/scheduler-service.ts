import cron from 'node-cron';
import { db } from './db';
import { testPlanSchedules, testPlanExecutions, testPlans } from '@shared/schema';
import type { TestPlanSchedule, TestPlanExecution, TestPlan } from '@shared/schema';
import { eq, and, gt } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';
// Import runTestPlan function - assuming it's exported from test-execution-service
// We need to be careful with circular dependencies if test-execution-service also imports this.
// For now, let's assume it can be imported. If not, we might need to use an event emitter or refactor.
import { runTestPlan } from './test-execution-service'; // Adjust path if necessary

interface ActiveJob {
  job: cron.ScheduledTask;
  scheduleId: string;
}

const activeCronJobs: Map<string, ActiveJob> = new Map();

// Helper to convert frequency to cron pattern
// This is a simplified version. A more robust solution would parse more complex frequencies.
// For 'once', it's handled by nextRunAt and then the schedule should be deactivated or deleted.
// 'custom_cron' will expect a valid cron string.
function frequencyToCronPattern(frequency: string, nextRunAt: Date): string | null {
  if (frequency.startsWith('cron:')) {
    return frequency.substring(5).trim();
  }

  const hours = nextRunAt.getUTCHours();
  const minutes = nextRunAt.getUTCMinutes();

  switch (frequency) {
    case 'daily':
      return `${minutes} ${hours} * * *`;
    case 'weekly':
      // This would run every week on the day of nextRunAt
      return `${minutes} ${hours} * * ${nextRunAt.getUTCDay()}`;
    case 'monthly':
      // This would run every month on the date of nextRunAt
      return `${minutes} ${hours} ${nextRunAt.getUTCDate()} * *`;
    // 'once' type schedules are not recurring, so they don't get a cron pattern here.
    // They are executed once then typically deactivated or deleted.
    // Or, if they should run at a specific future time and then stop,
    // the job should unschedule itself after running.
    case 'once':
      return null; // Or handle as a one-time job that unschedules itself.
    default:
      // Attempt to parse common patterns like "every_x_minutes", "every_x_hours"
      if (frequency.match(/^every_\d+_(minutes|hours|days)$/)) {
        const parts = frequency.split('_');
        const value = parseInt(parts[1]);
        const unit = parts[2];
        if (unit === 'minutes') return `*/${value} * * * *`;
        if (unit === 'hours') return `0 */${value} * * *`;
        if (unit === 'days') return `0 ${hours} */${value} * *`; // At the specific hour of nextRunAt
      }
      logger.warn(`[SchedulerService] Unknown frequency format: ${frequency}. Cannot convert to cron pattern.`);
      return null;
  }
}

// Exported for testing purposes
export function frequencyToCronPatternForTest(frequency: string, nextRunAt: Date): string | null {
  return frequencyToCronPattern(frequency, nextRunAt);
}

// Exported for testing purposes
export async function executeScheduledPlanForTest(schedule: TestPlanSchedule, plan: TestPlan) {
  return executeScheduledPlan(schedule, plan);
}

async function executeScheduledPlan(schedule: TestPlanSchedule, plan: TestPlan) {
  const resolvedLogger = await logger;
  resolvedLogger.info(`[SchedulerService] Triggering job for schedule: ${schedule.scheduleName} (ID: ${schedule.id}), Plan: ${plan.name}`);

  const executionId = uuidv4();
  let executionStatus: TestPlanExecution['status'] = 'pending';

  try {
    await db.insert(testPlanExecutions).values({
      id: executionId,
      scheduleId: schedule.id,
      testPlanId: schedule.testPlanId,
      status: 'pending',
      environment: schedule.environment,
      browsers: schedule.browsers ? JSON.stringify(schedule.browsers) : null, // Store as JSON string
      triggeredBy: 'scheduled',
      startedAt: Math.floor(Date.now() / 1000),
      // executionParameters from schedule can be passed to runTestPlan if it supports it
    });

    // TODO: Enhance runTestPlan to accept executionParameters, environment, browsers from schedule
    // For now, runTestPlan likely uses plan's default config or user's settings.
    // We need to ensure runTestPlan can take overrides from the schedule.
    // Also, userId for runTestPlan. Schedules might not have a user, or have a service user.
    // Assuming runTestPlan needs a userId, this is a gap if schedule is system-wide.
    // Let's assume a placeholder or that runTestPlan can handle a null/system user.
    const placeholderUserIdForScheduledTask = 1; // TODO: Replace with actual user logic if required

    const result = await runTestPlan(
        schedule.testPlanId,
        placeholderUserIdForScheduledTask, // This needs to be addressed.
        { // Pass execution parameters, environment, browsers as overrides
            environment: schedule.environment,
            // browsers: schedule.browsers, // runTestPlan needs to accept this
            // customParams: schedule.executionParameters // runTestPlan needs to accept this
        }
    );


    executionStatus = result.status || 'error'; // runTestPlan should return a TestPlanRun like object
    // Update testPlanExecutions with the final status and results
    await db.update(testPlanExecutions)
      .set({
        status: executionStatus,
        results: result.results ? JSON.stringify(result.results) : null,
        completedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(testPlanExecutions.id, executionId));

    resolvedLogger.info(`[SchedulerService] Execution completed for schedule ${schedule.id}, Plan ${plan.name}. Status: ${executionStatus}`);

    // Handle retries - simplified version
    if ((executionStatus === 'failed' || executionStatus === 'error') && schedule.retryOnFailure && schedule.retryOnFailure !== 'none') {
        // Implement actual retry logic (e.g., another runTestPlan call after a delay)
        // This could involve creating a new execution record or updating the existing one.
        // For simplicity, this is a placeholder. A robust retry would need careful state management.
        resolvedLogger.info(`[SchedulerService] Schedule ${schedule.id} failed, retry configured to ${schedule.retryOnFailure}. (Retry logic placeholder)`);
    }

  } catch (error: any) {
    resolvedLogger.error(`[SchedulerService] Error executing scheduled plan ${schedule.testPlanId} (Schedule ID: ${schedule.id}): ${error.message}`, { stack: error.stack, scheduleId: schedule.id, executionId });
    executionStatus = 'error';
    try {
      await db.update(testPlanExecutions)
        .set({
          status: 'error',
          results: JSON.stringify({ error: error.message, stack: error.stack }),
          completedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(testPlanExecutions.id, executionId));
    } catch (dbError) {
      resolvedLogger.error(`[SchedulerService] CRITICAL: Failed to update execution status to error after catching execution error. Execution ID: ${executionId}`, { dbError });
    }
  } finally {
    // Update nextRunAt for recurring schedules (if not 'once')
    if (schedule.frequency !== 'once') {
      try {
        const cronPattern = frequencyToCronPattern(schedule.frequency, new Date(schedule.nextRunAt * 1000));
        if (cronPattern) { // Only if it's a recurring pattern recognized
            // This is tricky: node-cron itself handles the next run time internally for its jobs.
            // We need to calculate the next run time based on *our* schedule definition to store it.
            // This requires a robust cron expression parser or date calculation logic.
            // For simplicity, we'll assume for now that `node-cron` jobs are re-created/updated based on DB state.
            // A more robust approach would involve a library like `cron-parser`.
            // Placeholder:
            // const newNextRunAt = calculateNextRunTime(schedule.frequency, new Date(schedule.nextRunAt * 1000));
            // await db.update(testPlanSchedules).set({ nextRunAt: newNextRunAt }).where(eq(testPlanSchedules.id, schedule.id));
            // resolvedLogger.info(`[SchedulerService] Updated nextRunAt for recurring schedule ${schedule.id} to ${newNextRunAt}`);
        }
      } catch (e) {
          resolvedLogger.error(`[SchedulerService] Failed to update nextRunAt for schedule ${schedule.id}`, e);
      }
    } else {
      // For 'once' schedules, deactivate it after execution
      await db.update(testPlanSchedules).set({ isActive: false, updatedAt: Math.floor(Date.now()/1000) }).where(eq(testPlanSchedules.id, schedule.id));
      resolvedLogger.info(`[SchedulerService] Deactivated 'once' schedule ${schedule.id} after execution.`);
      removeScheduleJob(schedule.id); // Remove it from active cron jobs
    }

    // Placeholder for notifications
    // sendNotification(plan, schedule, executionStatus, results);
  }
}

export async function addScheduleJob(schedule: TestPlanSchedule) {
  const resolvedLogger = await logger;
  if (!schedule.isActive) {
    resolvedLogger.info(`[SchedulerService] Schedule ${schedule.id} is not active. Not adding job.`);
    return;
  }

  if (activeCronJobs.has(schedule.id)) {
    resolvedLogger.warn(`[SchedulerService] Job for schedule ${schedule.id} already exists. Removing old one before adding.`);
    removeScheduleJob(schedule.id);
  }

  const planResult = await db.select().from(testPlans).where(eq(testPlans.id, schedule.testPlanId)).limit(1);
  if (!planResult.length) {
    resolvedLogger.error(`[SchedulerService] Test Plan ${schedule.testPlanId} not found for schedule ${schedule.id}. Cannot add job.`);
    return;
  }
  const plan = planResult[0];

  let task: cron.ScheduledTask;

  if (schedule.frequency === 'once') {
    // For 'once' tasks, schedule them to run at `nextRunAt` and then they are done.
    // node-cron doesn't directly support a "run once at this future time then stop" via cron string.
    // We can schedule it if `nextRunAt` is in the future.
    const now = Math.floor(Date.now() / 1000);
    if (schedule.nextRunAt > now) {
      // This is a bit of a hack for 'once'. We create a cron job that runs every minute,
      // and inside the job, it checks if the current time matches `nextRunAt`.
      // A better way would be to use setTimeout for true 'once' tasks if they are imminent,
      // or a more sophisticated scheduler that handles one-time future tasks.
      // Or, if `node-cron` is used, schedule it for the specific time and ensure the job unschedules itself.
      const runAtDate = new Date(schedule.nextRunAt * 1000);
      const cronTimeForOnce = `${runAtDate.getUTCMinutes()} ${runAtDate.getUTCHours()} ${runAtDate.getUTCDate()} ${runAtDate.getUTCMonth() + 1} *`; // Runs once on this date/time

      try {
        task = cron.schedule(cronTimeForOnce, async () => {
          resolvedLogger.info(`[SchedulerService] Executing 'once' schedule ${schedule.id} at specific time.`);
          await executeScheduledPlan(schedule, plan);
          // After execution, the 'once' job should ideally unschedule itself or be marked.
          // The executeScheduledPlan already deactivates 'once' schedules.
        }, { timezone: "UTC" }); // Assuming all times are UTC
        resolvedLogger.info(`[SchedulerService] Scheduled 'once' job for schedule ${schedule.id} at ${runAtDate.toISOString()}`);
      } catch(e:any) {
        resolvedLogger.error(`[SchedulerService] Invalid cron pattern for 'once' schedule ${schedule.id} (${cronTimeForOnce}): ${e.message}`);
        return;
      }

    } else {
      resolvedLogger.info(`[SchedulerService] 'Once' schedule ${schedule.id} has a nextRunAt in the past. Not scheduling.`);
      // Optionally, deactivate it here if it wasn't already.
      if (schedule.isActive) {
        await db.update(testPlanSchedules).set({ isActive: false, updatedAt: Math.floor(Date.now()/1000) }).where(eq(testPlanSchedules.id, schedule.id));
      }
      return;
    }
  } else {
    // For recurring tasks
    const cronPattern = frequencyToCronPattern(schedule.frequency, new Date(schedule.nextRunAt * 1000));
    if (!cronPattern || !cron.validate(cronPattern)) {
      resolvedLogger.error(`[SchedulerService] Invalid or null cron pattern '${cronPattern}' for schedule ${schedule.id} (Frequency: ${schedule.frequency}). Not adding job.`);
      return;
    }
    try {
        task = cron.schedule(cronPattern, async () => {
            await executeScheduledPlan(schedule, plan);
        }, { timezone: "UTC" }); // Assuming all times are UTC
        resolvedLogger.info(`[SchedulerService] Added cron job for schedule ${schedule.id} with pattern: ${cronPattern}`);
    } catch(e:any) {
        resolvedLogger.error(`[SchedulerService] Failed to schedule job for schedule ${schedule.id} with pattern ${cronPattern}: ${e.message}`);
        return;
    }
  }

  activeCronJobs.set(schedule.id, { job: task, scheduleId: schedule.id });
}

export function removeScheduleJob(scheduleId: string) {
  const activeJob = activeCronJobs.get(scheduleId);
  if (activeJob) {
    activeJob.job.stop();
    activeCronJobs.delete(scheduleId);
    logger.info(`[SchedulerService] Removed cron job for schedule ${scheduleId}`);
  }
}

export async function updateScheduleJob(schedule: TestPlanSchedule) {
  const resolvedLogger = await logger;
  resolvedLogger.info(`[SchedulerService] Updating job for schedule ${schedule.id}`);
  removeScheduleJob(schedule.id); // Remove existing job if any
  if (schedule.isActive) {
    addScheduleJob(schedule); // Add new job if active
  } else {
    resolvedLogger.info(`[SchedulerService] Schedule ${schedule.id} is now inactive. Job not (re)added.`);
  }
}

export async function initializeScheduler() {
  const resolvedLogger = await logger;
  resolvedLogger.info('[SchedulerService] Initializing scheduler...');
  // Clear any existing jobs (e.g., if re-initializing)
  activeCronJobs.forEach(job => job.job.stop());
  activeCronJobs.clear();

  try {
    const now = Math.floor(Date.now() / 1000);
    const schedulesToLoad = await db
      .select()
      .from(testPlanSchedules)
      .where(and(
        eq(testPlanSchedules.isActive, true)
        // For 'once' schedules, only load if nextRunAt is in the future.
        // For recurring, we might always load them and let cron handle the timing.
        // Or, more efficiently, only load those whose nextRunAt is "soon".
        // For now, let's load all active ones and rely on cron pattern / 'once' logic in addScheduleJob.
        // gt(testPlanSchedules.nextRunAt, now) // This might be too restrictive for recurring.
      ));

    resolvedLogger.info(`[SchedulerService] Found ${schedulesToLoad.length} active schedules to load.`);
    for (const schedule of schedulesToLoad) {
      // If it's a 'once' schedule and its time has passed, deactivate it and skip.
      if (schedule.frequency === 'once' && schedule.nextRunAt <= now) {
        resolvedLogger.info(`[SchedulerService] 'Once' schedule ${schedule.id} has past. Deactivating.`);
        await db.update(testPlanSchedules).set({ isActive: false, updatedAt: Math.floor(Date.now()/1000) }).where(eq(testPlanSchedules.id, schedule.id));
        continue;
      }
      await addScheduleJob(schedule);
    }
    resolvedLogger.info('[SchedulerService] Scheduler initialized successfully.');
  } catch (error: any) {
    resolvedLogger.error(`[SchedulerService] Error initializing scheduler: ${error.message}`, { stack: error.stack });
  }
}

// Call initializeScheduler on application startup.
// This should be done in your main server file (e.g., index.ts) after DB is ready.
// For example:
// db.sync().then(() => { // Or however DB readiness is determined
//   initializeScheduler();
//   app.listen(...);
// });

// TODO:
// 1. Robust cron pattern generation/validation and nextRunAt calculation for recurring tasks.
//    Libraries like `cron-parser` can help here.
// 2. Refined `executeScheduledPlan` to correctly pass parameters (environment, browsers, custom params)
//    to `runTestPlan`. This requires `runTestPlan` to be adapted.
// 3. User ID handling for scheduled tasks: determine how `userId` is passed to `runTestPlan` if needed.
//    It could be a dedicated service account user, or schedules could be tied to users.
// 4. Full retry logic implementation.
// 5. Notification implementation.
// 6. Consider distributed environments: if running multiple instances of the app, a more robust
//    distributed job scheduler like Agenda.js or BullMQ might be needed to avoid duplicate job executions.
//    For now, node-cron is fine for single-instance deployments.
// 7. Graceful shutdown: ensure cron jobs are stopped when the application shuts down.
// 8. TestPlanSchedule's `nextRunAt` should be reliably updated after each run for recurring tasks.
//    The current placeholder logic for this is insufficient.
//    The `cron.schedule` task itself knows its next execution time, but that's internal.
//    We need to store our `nextRunAt` in the DB for persistence and UI.
//    This means after a job runs, we calculate its *next* `nextRunAt` based on its frequency and current time.
//    For example, if a daily job runs at 10:00 UTC, after it runs, `nextRunAt` should be updated to tomorrow 10:00 UTC.
//    If the server restarts, it will pick up this `nextRunAt`.
//    The `frequencyToCronPattern` uses `nextRunAt` to set the time part of the cron. This is okay for initial scheduling.
//    But subsequent `nextRunAt` updates need careful calculation.
//    A library like `cron-parser` would be essential here to get the next date from a cron string.
//    Example: `const interval = parser.parseExpression(cronPattern); newNextRunAt = interval.next().toDate();`
// 9. The `executeScheduledPlan` function should fetch the LATEST schedule details from DB before execution,
//    in case it was updated since the job was initially created in memory.
//    The `schedule` object passed to `cron.schedule` callback is a snapshot from when the job was defined.
//    Inside the callback: `const currentScheduleDetails = await db.select()...where(id = schedule.id)`
//    Then use `currentScheduleDetails` for execution.
// 10. Error handling in `frequencyToCronPattern` for invalid cron strings in `custom_cron`.
//     `cron.validate()` should be used before scheduling.
// 11. For 'once' schedules, the current cron pattern `cronTimeForOnce` will make it run every year on that date/time.
//     The job needs to explicitly stop itself or be removed after the first execution. The current logic deactivates
//     the schedule in DB and removes the job from `activeCronJobs`, which is good.

export default {
  initializeScheduler,
  addScheduleJob,
  updateScheduleJob,
  removeScheduleJob,
};
