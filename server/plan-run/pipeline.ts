/**
 * A plan run, phase by phase.
 *
 *   take the run → results directory → inputs (snapshot) → browsers → settings → variables →
 *   definitions → quarantine → browser probe → lanes → execution → artifacts → verdict
 *
 * Each phase is a function of its own module that takes what it reads and returns what it
 * produces; this file only puts them in order. A phase that ends the run early returns `Ended`.
 * Runs in the job's tenant context (server/test-execution-service.ts establishes it).
 */
import path from 'path';
import { eq } from 'drizzle-orm';
import { testPlanExecutions as testPlanExecutionsTable } from '@shared/schema';
import loggerPromise from '../logger';
import { withTenantTransaction } from '../middleware/tenancy';
import { getWsEmitter } from '../websocket';
import { takeExecution } from '../execution-state';
import { watchRun } from '../run-watch';
import { publishArtifacts } from './artifacts';
import { probeBrowsers, resolveBrowsers } from './browsers';
import {
  isEnded,
  report,
  RunStop,
  type PlanJob,
  type PlanJobResult,
  type PlanRun,
  type RunLog,
} from './context';
import { freezeDefinitions, readQuarantine } from './definitions';
import { collectSharedResults, executeLanes } from './execute-lanes';
import { finalizeRun } from './finalize';
import { ensureResultsDir, loadVariables, resolveInputs } from './inputs';
import { onlyBdd, planLanes } from './lanes';
import { announceSettings } from './settings';

/** How long a run over its organization's limit waits before a worker looks at it again. */
export const RUN_DEFERRAL_MS = Number(process.env.RUN_DEFERRAL_MS) || 10_000;

export async function runPlanJob(job: PlanJob): Promise<PlanJobResult> {
  const log: RunLog = {
    executionId: job.executionId,
    logger: await loggerPromise,
    emitter: getWsEmitter(),
    // A helper repeats the coordinator's setup; its informational lines would only say everything twice.
    quiet: !!job.helper,
  };
  const { executionId } = job;

  if (job.helper) {
    // A helper does not take the run: it joins one that is running, and it is the coordinator's
    // to end. Its time limit counts from when the run started, not from when the helper did.
    const [row] = await withTenantTransaction((tx) =>
      tx
        .select({
          status: testPlanExecutionsTable.status,
          startedAt: testPlanExecutionsTable.startedAt,
        })
        .from(testPlanExecutionsTable)
        .where(eq(testPlanExecutionsTable.id, executionId))
        .limit(1),
    );
    if (row?.status !== 'running') {
      return {
        skipped: true,
        reason: `Execution is ${row?.status ?? 'missing'}, not running.`,
        testPlanRunId: executionId,
      };
    }
    return joinRun(job, log, row.startedAt?.getTime() ?? Date.now());
  }

  const startedAt = Date.now();
  // Take the run. Only a run that is still queued can be taken, and the database lets exactly
  // one worker do it: a job BullMQ delivers twice, or a run somebody cancelled while it waited,
  // gets nothing back here and stops — instead of running the whole plan a second time over the
  // results of the first. And only while its organization is within its limit of runs at once
  // (see server/tenant-quotas.ts): past it the run stays queued and the job comes back later.
  const take = await takeExecution(executionId);
  if (take.outcome === 'over_quota') {
    log.logger.info({
      message:
        take.reason === 'execution_quota_exceeded'
          ? 'Test plan execution deferred: monthly execution allowance exhausted'
          : 'Test plan execution deferred: its organization is at its limit of runs at once',
      testPlanRunId: executionId,
      running: take.running,
      maxConcurrentRuns: take.maxConcurrentRuns,
      reason: take.reason ?? 'concurrent_run_quota',
      periodEnd: take.periodEnd,
    });
    return {
      deferred: true,
      retryInMs: RUN_DEFERRAL_MS,
      testPlanRunId: executionId,
      reason: take.reason ?? 'concurrent_run_quota',
      periodEnd: take.periodEnd,
    };
  }
  if (take.outcome !== 'taken') {
    log.logger.warn({
      message: 'Test plan execution was not taken: it is no longer queued',
      testPlanRunId: executionId,
      status: take.status ?? 'missing',
    });
    return {
      skipped: true,
      reason: `Execution is ${take.status ?? 'missing'}, not queued.`,
      testPlanRunId: executionId,
    };
  }
  report(log, {
    level: 'info',
    message: `Starting background test plan execution for plan ${job.planId}`,
    timestamp: new Date(startedAt).toISOString(),
    metadata: { planId: job.planId, testPlanRunId: executionId, userId: job.userId },
  });
  return joinRun(job, log, startedAt);
}

/**
 * From here on the run is this worker's: it keeps a heartbeat on it, hears a cancellation, and
 * stops it at its time limit — see server/run-watch.ts. Stopped however the run ends.
 */
async function joinRun(job: PlanJob, log: RunLog, startedAt: number): Promise<PlanJobResult> {
  const watch = watchRun(job.executionId, {
    startedAt,
    onStop: (_cause, reason) =>
      report(log, {
        level: 'warn',
        message: `Stopping the run: ${reason.replace(/^Not run: /, '')}`,
      }),
  });
  try {
    // The same object as the log: a helper's console stops being quiet for everything holding it.
    const run: PlanRun = Object.assign(log, job, {
      startedAt,
      watch,
      resultsDir: path.join('./results', job.planId, job.executionId),
      stop: new RunStop(log),
    });
    return await runPhases(run);
  } finally {
    watch.stop();
  }
}

async function runPhases(run: PlanRun): Promise<PlanJobResult> {
  const noDir = await ensureResultsDir(run);
  if (noDir) return noDir.ended;

  const inputs = await resolveInputs(run);
  if (isEnded(inputs)) return inputs.ended;

  const browsers = await resolveBrowsers(run, inputs);
  const settings = announceSettings(run, inputs);
  const variables = await loadVariables(run, inputs);
  const tests = await freezeDefinitions(run, inputs);
  const quarantined = await readQuarantine(run, tests);
  const usable = await probeBrowsers(run, browsers.passes, { onlyBdd: onlyBdd(tests) });
  const lanes = planLanes(tests, usable.passes, inputs.snapshot.locales);

  const results = await executeLanes(
    { run, inputs, settings, variables, tests, quarantined, agentHttp: browsers.agentHttp },
    lanes,
  );

  // Whatever is left in the run's directory — a test that ended before it returned its own, a
  // file written outside any test — is published with the rest.
  await publishArtifacts(run.resultsDir, run.executionId);

  // A helper's share is done; ending the run is the coordinator's.
  if (run.helper) return { shard: run.helper.shard, testPlanRunId: run.executionId };
  await collectSharedResults(run, results);
  return finalizeRun(
    run,
    inputs,
    { usablePasses: usable.passes, startupFailures: usable.startupFailures },
    results,
  );
}
