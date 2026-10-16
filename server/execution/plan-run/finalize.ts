/** The end of a run: its verdict, how it is recorded, and who hears about it. */
import { eq } from 'drizzle-orm';
import {
  reportTestCaseResults as reportTestCaseResultsTable,
  type TestPlanExecution,
} from '@shared/schema';
import type { RunSummary } from '../../integrations/notifications';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { transitionExecution } from '../execution-state';
import { failuresOf, type VerdictRow } from '../../authoring/test-quarantine';
import {
  fileFailuresIfConfigured,
  notifyRunFinished,
  publishToTestManagement,
  queueRetryIfAllowed,
} from './after-run';
import { emit, type PlanJobResult, type PlanRun } from './context';
import type { Pass } from './browsers';
import type { RunInputs } from './inputs';
import type { LaneResults } from './execute-lanes';

export interface Tally {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: ReturnType<typeof failuresOf>;
}

export function tallyResults(rows: VerdictRow[]): Tally {
  return {
    total: rows.length,
    passed: rows.filter((r) => r.status === 'Passed').length,
    failed: rows.filter((r) => r.status === 'Failed').length,
    skipped: rows.filter((r) => r.status === 'Skipped').length,
    failures: failuresOf(rows),
  };
}

export type Verdict = 'completed' | 'failed' | 'error';

/**
 * The verdict of a run from its results. Failures of quarantined tests are counted but do not
 * decide it; skips alone do not fail it.
 *
 * `incomplete` is a browser that would not start or a test that could not be executed: a plan
 * that asked for three browsers and got two did not do what it was asked, whatever the tests
 * that did run reported — and neither did one whose test never executed at all, or whose result
 * could not be written down: the rows that were saved say nothing of the one that was lost.
 * Saying "completed" for any of these is how a gap in coverage comes to look like coverage.
 */
export function verdictOf(tally: Tally, plannedTests: number, incomplete: boolean): Verdict {
  const verdict: Verdict =
    tally.total === 0 && plannedTests > 0
      ? 'error' // No results recorded but tests were expected
      : tally.failures.holding > 0
        ? 'failed'
        : // Every test passed, none failed outright (some skipped, or waiting for a person), or
          // there was nothing to run.
          'completed';
  return incomplete && verdict === 'completed' ? 'error' : verdict;
}

export async function finalizeRun(
  run: PlanRun,
  inputs: RunInputs,
  { usablePasses, startupFailures }: { usablePasses: Pass[]; startupFailures: string[] },
  { legacy, unitFailures }: LaneResults,
): Promise<PlanJobResult> {
  const { planId, executionId, logger, watch } = run;
  const { snapshot, execution } = inputs;
  // After all tests have run, calculate final aggregates from reportTestCaseResultsTable
  const finalDetailedResults = await withTenantTransaction((tx) =>
    tx
      .select()
      .from(reportTestCaseResultsTable)
      .where(eq(reportTestCaseResultsTable.testPlanExecutionId, executionId)),
  );
  const tally = tallyResults(finalDetailedResults);
  const finalOverallStatus = verdictOf(
    tally,
    snapshot.selectedTests.length,
    startupFailures.length > 0 || unitFailures.length > 0,
  );

  const overallCompletedAt = Date.now();
  const durationMs = overallCompletedAt - run.startedAt;
  const summary = (status: RunSummary['status']): RunSummary => ({
    planId,
    planName: snapshot.plan.name || planId,
    executionId,
    status,
    totalTests: tally.total,
    passedTests: tally.passed,
    failedTests: tally.failed,
    skippedTests: tally.skipped,
    quarantinedFailures: tally.failures.quarantined,
    durationMs,
    triggeredBy: execution.triggeredBy ?? 'manual',
    ci: execution.ciContext ?? null,
    browsers: usablePasses.flatMap((b) => (b ? [b.label] : [])),
  });

  try {
    const aggregates = {
      results: JSON.stringify(legacy), // Keep the old JSON blob for now
      totalTests: tally.total,
      passedTests: tally.passed,
      failedTests: tally.failed,
      skippedTests: tally.skipped,
      quarantinedFailures: tally.failures.quarantined,
      executionDurationMs: durationMs,
    };

    // How the run ends. A stop the watch saw decides it: a cancelled run is cancelled and a run
    // past its limit timed out, whatever the tests that did run said. Otherwise the verdict —
    // which only a run still running can be given, so an ending that arrived meanwhile stands.
    let ending: 'verdict' | 'cancelled' | 'timed_out' =
      watch.cause === 'cancelled'
        ? 'cancelled'
        : watch.cause === 'timed_out'
          ? 'timed_out'
          : 'verdict';
    let finished: TestPlanExecution | null = null;
    if (ending === 'timed_out') {
      finished = await transitionExecution(executionId, 'timed_out', {
        ...aggregates,
        failureCode: 'run_timed_out',
        failureMessage:
          watch.stopReason?.replace(/^Not run: /, '') ?? 'The run went past its time limit.',
      });
    } else if (ending === 'cancelled') {
      finished = await transitionExecution(executionId, 'cancelled', aggregates);
    } else {
      finished = await transitionExecution(executionId, finalOverallStatus, {
        ...aggregates,
        ...(finalOverallStatus === 'error'
          ? {
              failureCode: 'run_incomplete',
              // The reason itself when there is one: "Not every browser produced a result" sends
              // somebody looking for which, when the run already knows.
              failureMessage: [
                'Not every browser or test in the plan produced a recorded result.',
                ...startupFailures,
                ...unitFailures,
              ]
                .join(' ')
                .slice(0, 2000),
            }
          : {}),
      });
    }
    if (!finished && ending !== 'cancelled') {
      // A cancellation asked for after the watch last looked: the run is `cancelling`, and it is
      // this worker that finishes stopping it.
      finished = await transitionExecution(executionId, 'cancelled', aggregates);
      if (finished) ending = 'cancelled';
    }

    if (!finished) {
      // The run was no longer running: something else ended it while the tests were going.
      // Its ending stands, and nothing is filed or announced for a verdict that was not recorded.
      logger.warn({
        message: `Verdict not recorded: the execution had already ended`,
        planId,
        testPlanRunId: executionId,
        verdict: finalOverallStatus,
      });
      return {
        startedAt: Math.floor(run.startedAt / 1000),
        status: 'error',
        error: 'Failed to finalize database record, but execution attempted.',
      };
    }

    if (ending === 'cancelled') {
      // Nobody is told and nothing is filed about a run somebody chose to stop.
      logger.info({
        message: 'Test plan execution cancelled',
        planId,
        testPlanRunId: executionId,
        testsRun: tally.total,
      });
      return finished;
    }

    if (ending === 'timed_out') {
      // Announced — a nightly run that never finished is exactly what somebody needs to hear
      // about — but not filed: which tests would have failed is not known.
      await notifyRunFinished({
        plan: { notificationSettings: snapshot.notificationSettings },
        execution,
        summary: summary('timed_out'),
      });
      return finished;
    }

    logger.info({
      message: `Test plan execution COMPLETED and DB updated`,
      planId,
      testPlanRunId: executionId,
      overallStatus: finalOverallStatus,
      testsRun: tally.total,
    });

    // A failed attempt with attempts left is not the verdict yet: the next attempt is queued,
    // and the issues and the notification wait for the attempt that decides. Filing a bug for
    // a failure the retry then clears is exactly the noise that gets retry policies switched off.
    const retry = await queueRetryIfAllowed(finished);
    if (retry) {
      emit(run, {
        level: 'info',
        message:
          `Attempt ${finished.attempt} of ${finished.maxAttempts} ended ${finalOverallStatus}; ` +
          `attempt ${retry.attempt} is queued as run ${retry.id}.`,
        metadata: { retryExecutionId: retry.id, attempt: retry.attempt },
      });
      return finished;
    }

    // Before the notification, so a message that says "3 failed" arrives after the issues
    // those failures produced already exist to be linked to.
    await fileFailuresIfConfigured({
      plan: {
        name: snapshot.plan.name,
        issueTrackerId: snapshot.issues.trackerId,
        createIssuesOnFailure: snapshot.issues.createOnFailure,
      },
      planId,
      executionId,
      organizationId: inputs.organizationId,
      results: finalDetailedResults,
    });
    if (snapshot.testManagement?.connectionId) await publishToTestManagement(executionId);
    await notifyRunFinished({
      plan: { notificationSettings: snapshot.notificationSettings },
      execution,
      summary: summary(finalOverallStatus),
    });
    return finished;
  } catch (dbError: unknown) {
    logger.error({
      message: 'CRITICAL: Failed to update TestPlanRun with final aggregates in DB',
      planId,
      testPlanRunId: executionId,
      error: (dbError as Error).message,
    });
    return {
      id: executionId,
      testPlanId: planId,
      status: 'error',
      results: JSON.stringify(legacy),
      startedAt: Math.floor(run.startedAt / 1000),
      completedAt: new Date(overallCompletedAt),
      error: `DB error during final aggregate update: ${(dbError as Error).message}`,
    };
  }
}
