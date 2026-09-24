import * as cron from 'node-cron';
// cron-parser v4 is CommonJS; under Node ESM (tsx) only the default import exposes
// its members — a named `{ parseExpression }` import throws at runtime.
import cronParser from 'cron-parser';
import { privilegedDb } from './db';
import { environments, testPlanSchedules, testPlans } from '@shared/schema';
import type { TestPlanSchedule, TestPlanExecution, TestPlan } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import logger from './logger';
import { ExecutionEnqueueError, executionOrchestrator } from './execution-orchestrator';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { testExecutionQueue } from './queue';

interface ActiveJob {
  job: any; // cron.ScheduledTask
  scheduleId: string;
}

const activeCronJobs: Map<string, ActiveJob> = new Map();

// Scheduler backend selection. Default is the in-process node-cron engine (single
// instance). Set SCHEDULER_BACKEND=bullmq to use Redis-backed BullMQ job schedulers,
// which are distributed (no duplicate runs across instances) and survive restarts.
export const SCHEDULER_BACKEND: 'cron' | 'bullmq' =
  process.env.SCHEDULER_BACKEND === 'bullmq' ? 'bullmq' : 'cron';

// Job name used for BullMQ-triggered scheduled runs (handled by the worker).
export const TRIGGER_SCHEDULE_JOB = 'trigger-schedule';
// NOTE: BullMQ custom job ids must NOT contain ':' — use a hyphen separator.
const onceJobId = (scheduleId: string) => `once-${scheduleId}`;

/**
 * How many runs one scheduled occurrence may take, counting the first.
 *
 * The retries themselves are the worker's: it queues the next attempt when one ends failed
 * (see retryFailedRun in server/execution-orchestrator.ts). They used to be a loop here over the
 * answer to an enqueue, which is never a verdict, so the policy never retried anything.
 */
export function attemptsForPolicy(policy: string | null | undefined): number {
  switch (policy) {
    case 'once':
      return 2;
    case 'twice':
      return 3;
    default:
      return 1;
  }
}

/**
 * The moment a BullMQ trigger job was meant for, which every delivery of it agrees on.
 *
 * A job scheduler's job carries its occurrence as `prevMillis`; a one-off trigger was added with a
 * delay from its creation. The time a worker happens to pick the job up is neither, and a
 * redelivered job would get a different one — and with it a second run.
 */
export function scheduledOccurrence(job: { timestamp: number; opts: object }): Date {
  const opts = job.opts as { prevMillis?: number; delay?: number };
  return new Date(opts.prevMillis ?? job.timestamp + (opts.delay ?? 0));
}

/**
 * The key that makes one scheduled occurrence one run.
 *
 * Every replica running the in-process scheduler fires the same minute, and BullMQ can deliver a
 * trigger twice; both derive this same key from the same occurrence, so the orchestrator creates
 * the run once and hands the same one back to the rest.
 */
export function occurrenceKey(scheduleId: string, occurrence: Date): string {
  const minute = new Date(Math.floor(occurrence.getTime() / 60_000) * 60_000);
  return `schedule-${scheduleId}-${minute.toISOString()}`;
}

/** The zone a schedule with no timezone of its own runs in — what every existing row means. */
export const DEFAULT_SCHEDULE_TIMEZONE = 'UTC';

const WEEKDAY_TO_CRON: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * The wall-clock parts of a moment, as read in a given zone.
 *
 * Everything used to be derived with getUTCHours(), so a nightly regression a tester set to
 * 02:00 Italian time ran at 02:00 UTC — 03:00 locally in summer and 02:00 in winter. It
 * moved by an hour twice a year with nobody changing anything, which is the hardest kind of
 * scheduling bug to attribute because the schedule is not what changed.
 */
function zonedParts(date: Date, timeZone: string) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23', // not hour12:false: that yields "24" for midnight on some ICU builds
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(date);
  } catch {
    // Falling back to UTC here would move every run of this schedule by the offset without
    // telling anyone — the same silent drift this function exists to remove.
    throw new Error(
      `Unknown timezone "${timeZone}". Use an IANA name such as "Europe/Rome" or "UTC".`,
    );
  }

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    hours: Number(value('hour')),
    minutes: Number(value('minute')),
    dayOfMonth: Number(value('day')),
    weekday: WEEKDAY_TO_CRON[value('weekday')] ?? 0,
  };
}

/** The month number (1-12) of a moment, read in a given zone. */
function zonedMonth(date: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone, month: 'numeric' }).format(date),
  );
}

/**
 * The zone a schedule runs in.
 *
 * Rows written before the timezone column existed read 'UTC' from its default, which is
 * exactly what they always meant — so no existing scheduled run moves.
 */
function scheduleZone(schedule: { timezone?: string | null }): string {
  return schedule.timezone || DEFAULT_SCHEDULE_TIMEZONE;
}

/** Rejects a zone this platform cannot resolve, at the point a schedule is saved. */
export function assertValidTimezone(timeZone: string): void {
  zonedParts(new Date(), timeZone);
}

// Helper to convert frequency to cron pattern
// This is a simplified version. A more robust solution would parse more complex frequencies.
// For 'once', it's handled by nextRunAt and then the schedule should be deactivated or deleted.
// 'custom_cron' will expect a valid cron string.
//
// `timeZone` is the zone the resulting pattern is meant to be interpreted in — node-cron and
// cron-parser are both told the same thing, so the numbers here and the evaluation there
// agree. A cron pattern carries no zone of its own, which is exactly how these drifted apart.
function frequencyToCronPattern(
  frequency: string,
  nextRunAt: Date,
  timeZone: string = DEFAULT_SCHEDULE_TIMEZONE,
): string | null {
  if (frequency.startsWith('cron:')) {
    // Validate even here: a custom pattern still gets evaluated in the schedule's zone.
    assertValidTimezone(timeZone);
    return frequency.substring(5).trim();
  }

  const zoned = zonedParts(nextRunAt, timeZone);
  const hours = zoned.hours;
  const minutes = zoned.minutes;

  switch (frequency) {
    case 'daily':
      return `${minutes} ${hours} * * *`;
    case 'weekly':
      // The weekday in the schedule's zone, not in UTC: 23:00 Monday UTC is already Tuesday
      // in Rome, so deriving it from UTC would schedule a Tuesday run for Monday.
      return `${minutes} ${hours} * * ${zoned.weekday}`;
    case 'monthly':
      // Likewise the day of the month.
      return `${minutes} ${hours} ${zoned.dayOfMonth} * *`;
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
      console.warn(`[SchedulerService] Unknown frequency format: ${frequency}. Cannot convert to cron pattern.`);
      return null;
  }
}

// Compute the next run time for a recurring schedule from its frequency, using a
// real cron parser so the stored `nextRunAt` stays accurate for persistence and the UI.
function calculateNextRunTime(
  frequency: string,
  from: Date,
  timeZone: string = DEFAULT_SCHEDULE_TIMEZONE,
): Date | null {
  const pattern = frequencyToCronPattern(frequency, from, timeZone);
  if (!pattern) return null;
  try {
    const interval = cronParser.parseExpression(pattern, { currentDate: from, tz: timeZone });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

// Exported for testing purposes
export function frequencyToCronPatternForTest(
  frequency: string,
  nextRunAt: Date,
  timeZone?: string,
): string | null {
  return frequencyToCronPattern(frequency, nextRunAt, timeZone);
}

// Exported for testing purposes
export function calculateNextRunTimeForTest(
  frequency: string,
  from: Date,
  timeZone?: string,
): Date | null {
  return calculateNextRunTime(frequency, from, timeZone);
}

// Exported for testing purposes
export async function executeScheduledPlanForTest(schedule: TestPlanSchedule, plan: TestPlan, occurrence?: Date) {
  return executeScheduledPlan(schedule, plan, occurrence);
}

/**
 * The environment a schedule names, as an environment of its organization.
 *
 * Schedules store it as text, and the form offers names — "QA", "Staging" — while the runner
 * wanted an id: it parsed "QA" as a number, got nothing, and every scheduled run went out with no
 * environment's variables and no saved login, whatever the schedule said. An id is still read as
 * an id; anything else is looked up by name, ignoring case, inside the schedule's organization. A name
 * that matches nothing runs without an environment, as it always did, and keeps its label on the
 * run so the report still says what was asked for.
 */
async function resolveScheduleEnvironment(value: string | null | undefined): Promise<{ environmentId: number | null; label: string | null }> {
  const label = value?.trim() || null;
  if (!label) return { environmentId: null, label: null };
  const byId = /^\d+$/.test(label)
    ? await withTenantTransaction((tx) =>
        tx.select({ id: environments.id }).from(environments).where(eq(environments.id, Number(label))).limit(1),
      )
    : [];
  if (byId[0]) return { environmentId: byId[0].id, label };
  // Without case, as names are unique (migration 0041): "staging" finds "Staging".
  const byName = await withTenantTransaction((tx) =>
    tx
      .select({ id: environments.id })
      .from(environments)
      .where(sql`lower(${environments.name}) = lower(${label})`)
      .limit(1),
  );
  return { environmentId: byName[0]?.id ?? null, label };
}

/**
 * Asks for the run of one scheduled occurrence.
 *
 * Only asks: the run is created by the orchestrator like any other — configuration written down,
 * one job — and its verdict, and any retry, belong to the worker. It used to insert its own row,
 * then call an enqueue that created a second one, and then write a verdict from the enqueue's
 * answer, which is never one.
 *
 * `schedule` and `plan` may be the ones an in-process cron job captured when it was set up, so
 * the schedule is read again: a schedule switched off, or pointed at another environment, since
 * then is what it is now.
 */
export async function executeScheduledPlan(
  scheduleAsLoaded: TestPlanSchedule,
  plan: TestPlan,
  occurrence: Date = new Date(),
): Promise<TestPlanExecution | null> {
  const resolvedLogger = await logger;
  let schedule: TestPlanSchedule | undefined = scheduleAsLoaded;

  try {
    return await runWithTenant(scheduleAsLoaded.organizationId, async () => {
      [schedule] = await withTenantTransaction((tx) =>
        tx.select().from(testPlanSchedules).where(eq(testPlanSchedules.id, scheduleAsLoaded.id)).limit(1),
      );
      if (!schedule || !schedule.isActive) {
        resolvedLogger.info(`[SchedulerService] Schedule ${scheduleAsLoaded.id} is ${schedule ? 'inactive' : 'gone'}; not running it.`);
        return null;
      }
      resolvedLogger.info(`[SchedulerService] Triggering schedule ${schedule.scheduleName} (ID: ${schedule.id}) for ${occurrence.toISOString()}, Plan: ${plan.name}`);

      // On behalf of the schedule's owner; schedules from before that was recorded fall back to
      // the plan's owner.
      let ownerUserId = schedule.userId ?? null;
      if (ownerUserId == null) {
        const planId = schedule.testPlanId;
        const [planOwner] = await withTenantTransaction((tx) =>
          tx.select({ userId: testPlans.userId }).from(testPlans).where(eq(testPlans.id, planId)).limit(1),
        );
        ownerUserId = planOwner?.userId ?? null;
        resolvedLogger.warn(`[SchedulerService] Schedule ${schedule.id} has no userId; falling back to the test plan owner (${ownerUserId}).`);
      }
      if (ownerUserId == null) {
        throw new Error(`Cannot execute schedule ${schedule.id}: no owner user could be resolved.`);
      }

      const environment = await resolveScheduleEnvironment(schedule.environment);
      if (environment.label && environment.environmentId == null) {
        resolvedLogger.warn(`[SchedulerService] Schedule ${schedule.id} names environment "${environment.label}", which is not an environment of its organization; running without one.`);
      }

      const execution = await executionOrchestrator.enqueue({
        planId: schedule.testPlanId,
        requestedByUserId: ownerUserId,
        trigger: 'scheduled',
        scheduleId: schedule.id,
        environmentId: environment.environmentId,
        environmentLabel: environment.label,
        browsers: schedule.browsers ?? null,
        maxAttempts: attemptsForPolicy(schedule.retryOnFailure),
        idempotencyKey: occurrenceKey(schedule.id, occurrence),
      });
      resolvedLogger.info(`[SchedulerService] Run ${execution.id} queued for schedule ${schedule.id} (up to ${execution.maxAttempts} attempt(s)).`);
      return execution;
    });
  } catch (error: any) {
    // A refused enqueue leaves its own record where there is a run to put it on (the queue
    // refusing a job marks that run); one refused before a run existed has only this.
    const code = error instanceof ExecutionEnqueueError ? error.code : 'schedule_trigger_failed';
    resolvedLogger.error(`[SchedulerService] Schedule ${scheduleAsLoaded.id} could not queue its run (${code}): ${error.message}`, { stack: error.stack, scheduleId: scheduleAsLoaded.id });
    return null;
  } finally {
    // The schedule as it is now. One that is gone or switched off has nothing to advance.
    if (schedule?.isActive) await advanceSchedule(schedule);
  }
}

/** Moves a recurring schedule to its next occurrence, or retires a one-off one. */
async function advanceSchedule(schedule: TestPlanSchedule): Promise<void> {
  const resolvedLogger = await logger;
  try {
    if (schedule.frequency !== 'once') {
      // Persisted so it survives restarts and is what the UI shows.
      const newNextRunAt = calculateNextRunTime(schedule.frequency, new Date(), scheduleZone(schedule));
      if (newNextRunAt) {
        await privilegedDb.update(testPlanSchedules)
          .set({ nextRunAt: newNextRunAt, updatedAt: new Date() })
          .where(eq(testPlanSchedules.id, schedule.id));
        resolvedLogger.info(`[SchedulerService] Updated nextRunAt for recurring schedule ${schedule.id} to ${newNextRunAt.toISOString()}`);
      } else {
        resolvedLogger.warn(`[SchedulerService] Could not compute nextRunAt for schedule ${schedule.id} (frequency: ${schedule.frequency}).`);
      }
    } else {
      await privilegedDb.update(testPlanSchedules).set({ isActive: false, updatedAt: new Date() }).where(eq(testPlanSchedules.id, schedule.id));
      resolvedLogger.info(`[SchedulerService] Deactivated 'once' schedule ${schedule.id} after execution.`);
      await removeScheduleJob(schedule.id);
    }
  } catch (e) {
    resolvedLogger.error(`[SchedulerService] Failed to advance schedule ${schedule.id}`, e);
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

  const planResult = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, schedule.testPlanId)).limit(1);
  if (!planResult.length) {
    resolvedLogger.error(`[SchedulerService] Test Plan ${schedule.testPlanId} not found for schedule ${schedule.id}. Cannot add job.`);
    return;
  }
  const plan = planResult[0];

  let task: any; // cron.ScheduledTask

  if (schedule.frequency === 'once') {
    // For 'once' tasks, schedule them to run at `nextRunAt` and then they are done.
    // node-cron doesn't directly support a "run once at this future time then stop" via cron string.
    // We can schedule it if `nextRunAt` is in the future.
    if (schedule.nextRunAt.getTime() > Date.now()) {
      // This is a bit of a hack for 'once'. We create a cron job that runs every minute,
      // and inside the job, it checks if the current time matches `nextRunAt`.
      // A better way would be to use setTimeout for true 'once' tasks if they are imminent,
      // or a more sophisticated scheduler that handles one-time future tasks.
      // Or, if `node-cron` is used, schedule it for the specific time and ensure the job unschedules itself.
      const runAtDate = new Date(schedule.nextRunAt);
      // The parts are read in the schedule's own zone, because node-cron is told to
      // evaluate the pattern in that zone below. Mixing the two — UTC numbers evaluated in
      // Europe/Rome — is what made a "once" job fire an hour or two off its stated time.
      const onceParts = zonedParts(runAtDate, scheduleZone(schedule));
      const onceMonth = zonedMonth(runAtDate, scheduleZone(schedule));
      const cronTimeForOnce = `${onceParts.minutes} ${onceParts.hours} ${onceParts.dayOfMonth} ${onceMonth} *`; // Runs once on this date/time

      try {
        task = cron.schedule(cronTimeForOnce, async () => {
          resolvedLogger.info(`[SchedulerService] Executing 'once' schedule ${schedule.id} at specific time.`);
          await executeScheduledPlan(schedule, plan);
          // After execution, the 'once' job should ideally unschedule itself or be marked.
          // The executeScheduledPlan already deactivates 'once' schedules.
        }, { timezone: scheduleZone(schedule) });
        resolvedLogger.info(`[SchedulerService] Scheduled 'once' job for schedule ${schedule.id} at ${runAtDate.toISOString()} (${scheduleZone(schedule)})`);
      } catch (e: any) {
        resolvedLogger.error(`[SchedulerService] Invalid cron pattern for 'once' schedule ${schedule.id} (${cronTimeForOnce}): ${e.message}`);
        return;
      }

    } else {
      resolvedLogger.info(`[SchedulerService] 'Once' schedule ${schedule.id} has a nextRunAt in the past. Not scheduling.`);
      // Optionally, deactivate it here if it wasn't already.
      if (schedule.isActive) {
        await privilegedDb.update(testPlanSchedules).set({ isActive: false, updatedAt: new Date() }).where(eq(testPlanSchedules.id, schedule.id));
      }
      return;
    }
  } else {
    // For recurring tasks
    const cronPattern = frequencyToCronPattern(schedule.frequency, new Date(schedule.nextRunAt), scheduleZone(schedule));
    if (!cronPattern || !cron.validate(cronPattern)) {
      resolvedLogger.error(`[SchedulerService] Invalid or null cron pattern '${cronPattern}' for schedule ${schedule.id} (Frequency: ${schedule.frequency}). Not adding job.`);
      return;
    }
    try {
      task = cron.schedule(cronPattern, async () => {
        await executeScheduledPlan(schedule, plan);
      }, { timezone: scheduleZone(schedule) });
      resolvedLogger.info(`[SchedulerService] Added cron job for schedule ${schedule.id} with pattern: ${cronPattern} (${scheduleZone(schedule)})`);
    } catch (e: any) {
      resolvedLogger.error(`[SchedulerService] Failed to schedule job for schedule ${schedule.id} with pattern ${cronPattern}: ${e.message}`);
      return;
    }
  }

  activeCronJobs.set(schedule.id, { job: task, scheduleId: schedule.id });
}

export async function removeScheduleJob(scheduleId: string) {
  const resolvedLogger = await logger;
  const activeJob = activeCronJobs.get(scheduleId);
  if (activeJob) {
    activeJob.job.stop();
    activeCronJobs.delete(scheduleId);
    resolvedLogger.info(`[SchedulerService] Removed cron job for schedule ${scheduleId}`);
  }
}

export async function updateScheduleJob(schedule: TestPlanSchedule) {
  const resolvedLogger = await logger;
  resolvedLogger.info(`[SchedulerService] Updating job for schedule ${schedule.id}`);
  await removeScheduleJob(schedule.id); // Remove existing job if any
  if (schedule.isActive) {
    await addScheduleJob(schedule); // Add new job if active
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
    const schedulesToLoad = await privilegedDb
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
      if (schedule.frequency === 'once' && schedule.nextRunAt.getTime() <= Date.now()) {
        resolvedLogger.info(`[SchedulerService] 'Once' schedule ${schedule.id} has past. Deactivating.`);
        await privilegedDb.update(testPlanSchedules).set({ isActive: false, updatedAt: new Date() }).where(eq(testPlanSchedules.id, schedule.id));
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
// privilegedDb.sync().then(() => { // Or however DB readiness is determined
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
//    Inside the callback: `const currentScheduleDetails = await privilegedDb.select()...where(id = schedule.id)`
//    Then use `currentScheduleDetails` for execution.
// 10. Error handling in `frequencyToCronPattern` for invalid cron strings in `custom_cron`.
//     `cron.validate()` should be used before scheduling.
// 11. For 'once' schedules, the current cron pattern `cronTimeForOnce` will make it run every year on that date/time.
//     The job needs to explicitly stop itself or be removed after the first execution. The current logic deactivates
//     the schedule in DB and removes the job from `activeCronJobs`, which is good.

/** Stop all in-memory cron jobs. Called during graceful shutdown. */
export async function shutdownScheduler(): Promise<void> {
  const resolvedLogger = await logger;
  activeCronJobs.forEach((j) => j.job.stop());
  activeCronJobs.clear();
  resolvedLogger.info('[SchedulerService] All cron jobs stopped.');
}

// ─── BullMQ backend ───────────────────────────────────────────────────────────
// Instead of an in-process cron, each active schedule becomes a Redis-backed BullMQ
// Job Scheduler (recurring) or a delayed job ('once'). The worker consumes the
// resulting 'trigger-schedule' jobs and runs executeScheduledPlan. This is
// distributed (single source of truth in Redis) and survives restarts.

export async function bullmqAddScheduleJob(schedule: TestPlanSchedule): Promise<void> {
  const resolvedLogger = await logger;
  if (!schedule.isActive) {
    resolvedLogger.info(`[SchedulerService/bullmq] Schedule ${schedule.id} is not active. Not adding job.`);
    return;
  }

  const data = { scheduleId: schedule.id };

  if (schedule.frequency === 'once') {
    const runAtMs = new Date(schedule.nextRunAt).getTime();
    const delayMs = runAtMs - Date.now();
    if (delayMs <= 0) {
      resolvedLogger.info(`[SchedulerService/bullmq] 'once' schedule ${schedule.id} is in the past. Deactivating.`);
      await privilegedDb.update(testPlanSchedules).set({ isActive: false, updatedAt: new Date() }).where(eq(testPlanSchedules.id, schedule.id));
      return;
    }
    await testExecutionQueue.add(TRIGGER_SCHEDULE_JOB, data, { delay: delayMs, jobId: onceJobId(schedule.id) });
    resolvedLogger.info(`[SchedulerService/bullmq] Scheduled one-time job for schedule ${schedule.id} in ${delayMs}ms.`);
    return;
  }

  const pattern = frequencyToCronPattern(schedule.frequency, new Date(schedule.nextRunAt), scheduleZone(schedule));
  if (!pattern) {
    resolvedLogger.error(`[SchedulerService/bullmq] Could not derive a cron pattern for schedule ${schedule.id} (frequency: ${schedule.frequency}). Not adding job.`);
    return;
  }
  // The job-scheduler id is the schedule id, so upsert is idempotent (safe re-runs).
  await testExecutionQueue.upsertJobScheduler(
    schedule.id,
    { pattern, tz: scheduleZone(schedule) },
    { name: TRIGGER_SCHEDULE_JOB, data },
  );
  resolvedLogger.info(`[SchedulerService/bullmq] Upserted job scheduler for ${schedule.id} with pattern: ${pattern}`);
}

export async function bullmqRemoveScheduleJob(scheduleId: string): Promise<void> {
  await testExecutionQueue.removeJobScheduler(scheduleId).catch(() => {});
  await testExecutionQueue.remove(onceJobId(scheduleId)).catch(() => {});
}

export async function bullmqUpdateScheduleJob(schedule: TestPlanSchedule): Promise<void> {
  await bullmqRemoveScheduleJob(schedule.id);
  if (schedule.isActive) {
    await bullmqAddScheduleJob(schedule);
  }
}

export async function bullmqInitializeScheduler(): Promise<void> {
  const resolvedLogger = await logger;
  resolvedLogger.info('[SchedulerService/bullmq] Initializing BullMQ schedulers...');
  const activeSchedules = await privilegedDb.select().from(testPlanSchedules).where(eq(testPlanSchedules.isActive, true));
  const activeIds = new Set(activeSchedules.map((s) => s.id));

  // Reconcile: drop any Redis job schedulers that no longer map to an active schedule.
  try {
    const existing = await testExecutionQueue.getJobSchedulers(0, -1);
    for (const js of existing) {
      if (js.key && !activeIds.has(js.key)) {
        await testExecutionQueue.removeJobScheduler(js.key).catch(() => {});
      }
    }
  } catch (e) {
    resolvedLogger.error('[SchedulerService/bullmq] Failed to reconcile existing job schedulers', e);
  }

  for (const schedule of activeSchedules) {
    if (schedule.frequency === 'once' && new Date(schedule.nextRunAt).getTime() <= Date.now()) {
      await privilegedDb.update(testPlanSchedules).set({ isActive: false, updatedAt: new Date() }).where(eq(testPlanSchedules.id, schedule.id));
      continue;
    }
    await bullmqAddScheduleJob(schedule);
  }
  resolvedLogger.info(`[SchedulerService/bullmq] Initialized ${activeSchedules.length} schedule(s).`);
}

export async function bullmqShutdownScheduler(): Promise<void> {
  // BullMQ job schedulers live in Redis by design; nothing to stop in-process.
}

// ─── Backend dispatch (public API used by index.ts / routes.ts) ─────────────────
export default {
  initializeScheduler: () =>
    SCHEDULER_BACKEND === 'bullmq' ? bullmqInitializeScheduler() : initializeScheduler(),
  addScheduleJob: (schedule: TestPlanSchedule) =>
    SCHEDULER_BACKEND === 'bullmq' ? bullmqAddScheduleJob(schedule) : addScheduleJob(schedule),
  updateScheduleJob: (schedule: TestPlanSchedule) =>
    SCHEDULER_BACKEND === 'bullmq' ? bullmqUpdateScheduleJob(schedule) : updateScheduleJob(schedule),
  removeScheduleJob: (scheduleId: string) =>
    SCHEDULER_BACKEND === 'bullmq' ? bullmqRemoveScheduleJob(scheduleId) : removeScheduleJob(scheduleId),
  shutdownScheduler: () =>
    SCHEDULER_BACKEND === 'bullmq' ? bullmqShutdownScheduler() : shutdownScheduler(),
};
