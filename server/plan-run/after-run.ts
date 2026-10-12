/**
 * What follows a run's verdict: the retry of a failed attempt, the issues its failures file, the
 * results sent to a test management tool, and the notification. None of it can fail the run.
 */
import { eq } from 'drizzle-orm';
import { testPlanSchedules, type TestPlanExecution } from '@shared/schema';
import loggerPromise from '../logger';
import { getTenantOrgId, withTenantTransaction } from '../middleware/tenancy';
import { getWsEmitter, type ExecutionLogEntry } from '../websocket';
import { executionOrchestrator } from '../execution-orchestrator';
import { fileFailure, loadTracker, markResolved } from '../issue-store';
import { publishExecution } from '../test-management';
import { mailRunFinished } from '../run-mail';
import { organizationMailConfigured } from '../mailer';
import {
  describeUnsupported,
  mergeNotificationSettings,
  sendRunNotification,
  type RunSummary,
} from '../notifications';

/** How long a failed scheduled attempt waits before the next: long enough for a blip to pass. */
export const RETRY_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 30_000;

/**
 * Queues the next attempt of a run that ended failed, when its request allowed one.
 *
 * Never throws: the verdict of this attempt is already written, and a retry that cannot be
 * queued leaves that verdict as the final one — which is then announced like any other.
 */
export async function queueRetryIfAllowed(
  finished: TestPlanExecution,
): Promise<TestPlanExecution | null> {
  try {
    return await executionOrchestrator.retryFailedRun(finished, RETRY_DELAY_MS);
  } catch (error: any) {
    const resolvedLogger = await loggerPromise;
    resolvedLogger.error({
      message: 'Could not queue the retry of a failed run',
      executionId: finished.id,
      error: error?.message,
    });
    return null;
  }
}

/**
 * Files this run's failures where the plan said to file them.
 *
 * Only when the plan opted in and named a tracker: filing a bug is an action in somebody else's
 * system, and a build that starts doing it on its own is one nobody forgives.
 *
 * Like the notification below, it cannot fail the run. The verdict is already written, and a
 * Jira that is down, a token that expired or a project somebody renamed must cost a line in the
 * console and nothing more — a run that crashed because it could not file a bug would have
 * turned a recorded result into no result at all.
 *
 * A test that passed and had an issue open gets a comment saying so. Only a comment: whether
 * the bug is fixed depends on what else is in it, and software that closes somebody's ticket
 * off one green run is software they switch off.
 */
export async function fileFailuresIfConfigured(input: {
  plan:
    { name?: string; issueTrackerId?: string | null; createIssuesOnFailure?: boolean } | undefined;
  planId: string;
  executionId: string;
  organizationId: number;
  results: Array<{
    testName: string;
    browser?: string | null;
    status: string;
    reasonForFailure?: string | null;
    startedAt?: Date | null;
    uiTestId?: number | null;
    testVersion?: number | null;
    quarantined?: boolean | null;
  }>;
}): Promise<void> {
  const resolvedLogger = await loggerPromise;
  const wsEmitter = getWsEmitter();
  const say = (level: 'info' | 'warn', message: string) => {
    const entry: ExecutionLogEntry = {
      level,
      source: 'system',
      message,
      timestamp: new Date().toISOString(),
    };
    if (level === 'warn') resolvedLogger.warn(entry);
    else resolvedLogger.info(entry);
    wsEmitter.emitExecutionLog(input.executionId, entry);
  };

  try {
    if (!input.plan?.createIssuesOnFailure || !input.plan.issueTrackerId) return;

    const tracker = await loadTracker(input.plan.issueTrackerId);
    if (!tracker) {
      say(
        'warn',
        'This plan is set to file failures, but the issue tracker it names no longer exists.',
      );
      return;
    }

    for (const row of input.results) {
      const failure = {
        planId: input.planId,
        planName: input.plan.name ?? null,
        executionId: input.executionId,
        testName: row.testName,
        browser: row.browser ?? null,
        status: row.status,
        testVersion: row.testVersion ?? null,
        reason: row.reasonForFailure ?? null,
        startedAt: row.startedAt ?? null,
      };

      const status = String(row.status).toLowerCase();
      if (status === 'failed' || status === 'error') {
        // Somebody already knows this test is unreliable, and said so by quarantining it: a new
        // issue for each of its failures is the noise quarantine exists to stop.
        if (row.quarantined) continue;
        const outcome = await fileFailure({
          organizationId: input.organizationId,
          tracker,
          uiTestId: row.uiTestId ?? null,
          failure,
        });
        if (outcome.action === 'created') {
          say(
            'info',
            `Filed ${outcome.issueKey} in ${tracker.name} for "${row.testName}": ${outcome.issueUrl}`,
          );
        } else if (outcome.action === 'commented') {
          say(
            'info',
            `"${row.testName}" has failed ${outcome.occurrences} times; commented on ${outcome.issueKey}.`,
          );
        } else if (outcome.action === 'failed') {
          say('warn', `Could not file "${row.testName}" in ${tracker.name}: ${outcome.error}`);
        }
        continue;
      }

      if (status === 'passed') {
        // Cheap for the common case: this reads the link table and only reaches the tracker
        // when there is an open issue to say it about.
        const outcome = await markResolved({ tracker, failure });
        if (outcome.action === 'commented') {
          say('info', `"${row.testName}" passed again; said so on ${outcome.issueKey}.`);
        } else if (outcome.action === 'failed') {
          say('warn', `Could not comment on the issue for "${row.testName}": ${outcome.error}`);
        }
      }
    }
  } catch (error: any) {
    say('warn', `Issue filing could not be attempted: ${error?.message ?? error}`);
  }
}

/**
 * Sends the finished run to the plan's TestRail, Xray or Zephyr Scale (server/test-management.ts).
 *
 * Like issue filing, it cannot fail the run: whatever the tool answered is recorded against the
 * run and said in its log, and the report offers to publish again.
 */
export async function publishToTestManagement(executionId: string): Promise<void> {
  const resolvedLogger = await loggerPromise;
  const say = (level: 'info' | 'warn', message: string) => {
    const entry: ExecutionLogEntry = {
      level,
      source: 'system',
      message,
      timestamp: new Date().toISOString(),
    };
    if (level === 'warn') resolvedLogger.warn(entry);
    else resolvedLogger.info(entry);
    getWsEmitter().emitExecutionLog(executionId, entry);
  };
  try {
    const publication = await publishExecution(executionId);
    if (!publication) return;
    const unmapped = publication.unmappedCount
      ? ` ${publication.unmappedCount} tests have no case there and were not sent.`
      : '';
    if (publication.status === 'published') {
      say(
        'info',
        `Published ${publication.publishedCount} results to ${publication.connectionName} as ${publication.externalKey}.${unmapped}`,
      );
      if (publication.message)
        say(
          'warn',
          `${publication.connectionName} did not take every result: ${publication.message}`,
        );
    } else {
      say(
        'warn',
        `Not published to ${publication.connectionName}: ${publication.message ?? publication.status}`,
      );
    }
  } catch (error: any) {
    say(
      'warn',
      `Publishing to the test management tool could not be attempted: ${error?.message ?? error}`,
    );
  }
}

/**
 * Tells whoever the plan named that the run is over.
 *
 * Wrapped in its own try/catch and never allowed to throw: the run has already happened and
 * its verdict has already been written, and a notification that cannot be delivered must not
 * turn a recorded result into a crashed job.
 */
export async function notifyRunFinished(input: {
  plan: { notificationSettings?: unknown } | undefined;
  execution: { scheduleId?: string | null; requestedByUserId?: number | null };
  summary: RunSummary;
}): Promise<void> {
  const resolvedLogger = await loggerPromise;
  const wsEmitter = getWsEmitter();
  try {
    // A schedule may override the plan's settings — most usefully the destination, so a
    // nightly run can report somewhere other than wherever manual runs report.
    let override: unknown;
    if (input.execution.scheduleId) {
      const schedule = await withTenantTransaction((tx) =>
        tx
          .select({ notificationConfigOverride: testPlanSchedules.notificationConfigOverride })
          .from(testPlanSchedules)
          .where(eq(testPlanSchedules.id, input.execution.scheduleId as string))
          .limit(1),
      );
      override = schedule[0]?.notificationConfigOverride;
    }

    const settings = mergeNotificationSettings(input.plan?.notificationSettings, override);

    // E-mail first, on its own: the plan's addresses and the person who started the run
    // (server/run-mail.ts). A mail server that refuses is said on the run's console.
    try {
      for (const outcome of await mailRunFinished(
        settings,
        input.execution.requestedByUserId,
        input.summary,
      )) {
        wsEmitter.emitExecutionLog(input.summary.executionId, {
          level: outcome.sent ? 'info' : 'warn',
          source: 'system',
          message: outcome.sent
            ? `Run notification e-mailed to ${outcome.to}.`
            : `Run notification not e-mailed to ${outcome.to}: ${outcome.error}`,
          timestamp: new Date().toISOString(),
        });
      }
      for (const note of describeUnsupported(
        settings,
        await organizationMailConfigured(getTenantOrgId()),
      )) {
        resolvedLogger.warn({ message: note, executionId: input.summary.executionId });
        wsEmitter.emitExecutionLog(input.summary.executionId, {
          level: 'warn',
          source: 'system',
          message: note,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      resolvedLogger.warn({
        message: `Run notification e-mail could not be attempted: ${error?.message ?? error}`,
        executionId: input.summary.executionId,
      });
    }

    const result = await sendRunNotification(settings, input.summary);
    if (result.delivered) {
      wsEmitter.emitExecutionLog(input.summary.executionId, {
        level: 'info',
        source: 'system',
        message: 'Run notification delivered.',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (result.error) {
      resolvedLogger.warn({ message: result.error, executionId: input.summary.executionId });
      wsEmitter.emitExecutionLog(input.summary.executionId, {
        level: 'warn',
        source: 'system',
        message: result.error,
        timestamp: new Date().toISOString(),
      });
    } else if (result.reason) {
      resolvedLogger.debug({ message: result.reason, executionId: input.summary.executionId });
    }
  } catch (error: any) {
    resolvedLogger.warn({
      message: `Run notification could not be attempted: ${error?.message ?? error}`,
      executionId: input.summary.executionId,
    });
  }
}
