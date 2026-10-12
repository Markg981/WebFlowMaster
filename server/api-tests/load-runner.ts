import os from 'node:os';
import { z } from 'zod';
import { and, count, eq, inArray, lt, sql } from 'drizzle-orm';
import { apiTests, loadTestRuns, loadTests, testDataSets } from '@shared/schema';
import {
  LOAD_LIMITS,
  dataSetProblem,
  loadBreaches,
  profileProblem,
  statsOf,
  totalDurationSec,
  vusAt,
  type LoadDataMode,
  type LoadLimits,
  type LoadRunStatus,
  type LoadStage,
  type LoadSummary,
  type LoadThresholds,
  type LoadTimelinePoint,
} from '@shared/load-test';
import { DATA_PREFIX } from '@shared/test-data';
import {
  apiTestSpec,
  runApiRequest,
  type ApiRequestSpec,
  type OneConnectionFetch,
} from './api-test-runner';
import { failureOf } from './api-performance';
import {
  runWithTenant,
  withTenantTransaction,
  type TenantTx,
} from '../platform/middleware/tenancy';
import { STALE_CLAIM_MS, WORK_ITEM_HEARTBEAT_MS } from '../runtime/run-shards';
import { withExecutionUsage } from '../tenancy/execution-usage';
import { resolveVariables } from '../runtime/variables';
import logger from '../platform/logger';

/**
 * Runs a load test (shared/load-test.ts): the engine (runLoad), and around it the service a worker
 * executes a run with (processLoadRunJob) and the web process asks for one with (enqueueLoadRun).
 * A run is a BullMQ job on the load queue (server/platform/queue.ts), apart from plans and their runners:
 * it survives a web restart, and the limits are the installation's (loadLimits).
 *
 * A scheduler follows the stage profile: every tick it starts virtual users up to the number the
 * profile asks for; a user above that number stops at the end of its iteration, so a ramp down never
 * cuts a scenario in half. Each user repeats the scenario's steps in order, sending what one step
 * captured to the next ones, with its own data row. Requests started during the warm-up are counted
 * apart and left out of the verdict.
 *
 * Memory stays bounded whatever the duration: percentiles come from a uniform sample of at most
 * 10,000 durations (per step and overall), and the timeline has at most 240 points.
 */

const SAMPLE_SIZE = 10_000;
const BUCKET_SAMPLE_SIZE = 1_000;
const MAX_TIMELINE_POINTS = 240;
const MAX_SAMPLE_ERRORS = 3;

/** Durations, errors and a uniform sample of the durations (reservoir sampling). */
class Accumulator {
  requests = 0;
  errors = 0;
  private sum = 0;
  private min = Infinity;
  private max = 0;
  private sample: number[] = [];

  constructor(
    private readonly capacity: number,
    private readonly random: () => number,
  ) {}

  add(durationMs: number, failed: boolean) {
    this.requests += 1;
    if (failed) this.errors += 1;
    this.sum += durationMs;
    this.min = Math.min(this.min, durationMs);
    this.max = Math.max(this.max, durationMs);
    if (this.sample.length < this.capacity) this.sample.push(durationMs);
    else {
      const slot = Math.floor(this.random() * this.requests);
      if (slot < this.capacity) this.sample[slot] = durationMs;
    }
  }

  stats() {
    return statsOf(
      this.requests,
      this.errors,
      this.sum,
      this.requests ? this.min : 0,
      this.max,
      this.sample,
    );
  }
}

export interface StepOutcome {
  durationMs: number;
  /** Why the request failed — not made, or an assertion that did not hold — or null. */
  error: string | null;
  extracted: Record<string, string>;
}

export interface LoadPlan {
  stages: LoadStage[];
  /** Virtual users at most, whatever the stages ask for: the installation's limit. */
  maxVus?: number;
  warmUpSec: number;
  thresholds: LoadThresholds;
  steps: Array<{ name: string; thinkTimeMs: number }>;
  /** The data set the virtual users read their rows from, when there is one. */
  data?: {
    set: string;
    columns: string[];
    rows: Array<Record<string, string>>;
    mode: LoadDataMode;
  } | null;
}

export interface LoadEngineDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  send: (stepIndex: number, vars: Record<string, string>) => Promise<StepOutcome>;
  /** Asked every tick: true ends the run early (cancelled). */
  shouldStop?: () => boolean;
  /** The summary so far, every `progressMs`. */
  onProgress?: (summary: LoadSummary) => Promise<void> | void;
  random?: () => number;
  tickMs?: number;
  progressMs?: number;
}

export interface LoadOutcome {
  summary: LoadSummary;
  cancelled: boolean;
}

export async function runLoad(
  plan: LoadPlan,
  baseVars: Record<string, string>,
  deps: LoadEngineDeps,
): Promise<LoadOutcome> {
  const random = deps.random ?? Math.random;
  const tickMs = deps.tickMs ?? 250;
  const progressMs = deps.progressMs ?? 2_000;
  const totalSec = totalDurationSec(plan.stages);
  const totalMs = totalSec * 1000;
  const warmUpMs = plan.warmUpSec * 1000;
  const bucketSec = Math.max(1, Math.ceil(totalSec / MAX_TIMELINE_POINTS));

  const overall = new Accumulator(SAMPLE_SIZE, random);
  const perStep = plan.steps.map(() => new Accumulator(SAMPLE_SIZE, random));
  const buckets = new Map<number, { acc: Accumulator; vus: number }>();
  const warmUp = { requests: 0, errors: 0 };
  const iterations = { completed: 0, failed: 0 };
  const sampleErrors: string[] = [];

  const start = deps.now();
  const elapsed = () => deps.now() - start;
  let stopping = false;
  let cancelled = false;
  const over = () => stopping || elapsed() >= totalMs;

  const bucket = (offsetMs: number) => {
    const index = Math.floor(Math.max(0, Math.min(offsetMs, totalMs - 1)) / 1000 / bucketSec);
    let found = buckets.get(index);
    if (!found)
      buckets.set(index, (found = { acc: new Accumulator(BUCKET_SAMPLE_SIZE, random), vus: 0 }));
    return found;
  };

  const record = (stepIndex: number, startedAt: number, outcome: StepOutcome) => {
    const offset = startedAt - start;
    const failed = outcome.error !== null;
    bucket(offset).acc.add(outcome.durationMs, failed);
    if (offset < warmUpMs) {
      warmUp.requests += 1;
      if (failed) warmUp.errors += 1;
    } else {
      overall.add(outcome.durationMs, failed);
      perStep[stepIndex].add(outcome.durationMs, failed);
    }
    if (failed && sampleErrors.length < MAX_SAMPLE_ERRORS) {
      const message = `${plan.steps[stepIndex].name}: ${outcome.error}`.slice(0, 500);
      if (!sampleErrors.includes(message)) sampleErrors.push(message);
    }
  };

  const rowVars = (row: Record<string, string>): Record<string, string> => {
    const vars: Record<string, string> = {};
    for (const column of plan.data!.columns)
      vars[`${DATA_PREFIX}.${plan.data!.set}.${column}`] = row[column] ?? '';
    return vars;
  };

  // Slot i is the i-th virtual user: the one that keeps going longest, and the owner of row i.
  const slots: boolean[] = [];
  const running = new Set<Promise<void>>();
  let active = 0;
  let peak = 0;
  let target = 0;
  let globalIteration = 0;

  const virtualUser = async (slot: number) => {
    const ownRow =
      plan.data?.mode === 'vu' ? rowVars(plan.data.rows[slot % plan.data.rows.length]) : {};
    let iteration = 0;
    try {
      while (!over() && slot < target) {
        iteration += 1;
        const row =
          plan.data?.mode === 'iteration'
            ? rowVars(plan.data.rows[globalIteration++ % plan.data.rows.length])
            : ownRow;
        let vars: Record<string, string> = {
          ...baseVars,
          ...row,
          'load.vu': String(slot + 1),
          'load.iteration': String(iteration),
        };
        // true: every step passed; false: one failed and ended the iteration; null: the run ended it.
        let passed: boolean | null = true;
        for (let index = 0; index < plan.steps.length; index += 1) {
          if (over()) {
            passed = null;
            break;
          }
          const startedAt = deps.now();
          const outcome = await deps.send(index, vars);
          record(index, startedAt, outcome);
          // The next steps would send what this one did not capture: the iteration is over.
          if (outcome.error !== null) {
            passed = false;
            break;
          }
          vars = { ...vars, ...outcome.extracted };
          const think = plan.steps[index].thinkTimeMs;
          if (think > 0 && !over()) await deps.sleep(think);
        }
        if (passed === true) iterations.completed += 1;
        else if (passed === false) iterations.failed += 1;
      }
    } finally {
      slots[slot] = false;
      active -= 1;
    }
  };

  const summary = (): LoadSummary => {
    const now = Math.min(elapsed(), totalMs);
    const measuredSec = Math.max(0, now - warmUpMs) / 1000;
    const stats = overall.stats();
    const rps = measuredSec > 0 ? Math.round((stats.requests / measuredSec) * 10) / 10 : 0;
    const timeline: LoadTimelinePoint[] = [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, { acc, vus }]) => {
        const s = acc.stats();
        return {
          t: index * bucketSec,
          vus,
          requests: s.requests,
          errors: s.errors,
          p95Ms: s.p95Ms,
        };
      });
    const withRps = { ...stats, rps };
    return {
      elapsedSec: Math.round(now / 1000),
      totalSec,
      warmUpSec: plan.warmUpSec,
      activeVus: active,
      peakVus: peak,
      iterations: { ...iterations },
      warmUp: { ...warmUp },
      overall: withRps,
      steps: perStep.map((acc, index) => ({ name: plan.steps[index].name, ...acc.stats() })),
      timeline,
      bucketSec,
      breaches: loadBreaches(withRps, plan.thresholds),
      sampleErrors: [...sampleErrors],
    };
  };

  let lastProgress = deps.now();
  while (!over()) {
    if (deps.shouldStop?.()) {
      cancelled = true;
      break;
    }
    const now = elapsed();
    target = Math.min(plan.maxVus ?? LOAD_LIMITS.virtualUsers, vusAt(plan.stages, now / 1000));
    for (let slot = 0; slot < target && active < target; slot += 1) {
      if (slots[slot]) continue;
      slots[slot] = true;
      active += 1;
      const user = virtualUser(slot);
      running.add(user);
      void user.finally(() => running.delete(user));
    }
    peak = Math.max(peak, active);
    const current = bucket(now);
    current.vus = Math.max(current.vus, active);
    if (deps.now() - lastProgress >= progressMs) {
      lastProgress = deps.now();
      await deps.onProgress?.(summary());
    }
    await deps.sleep(tickMs);
  }
  stopping = true;
  // In-flight requests finish (each within its own timeout); no new one starts.
  await Promise.all([...running]);
  return { summary: summary(), cancelled };
}

/** Where a run's requests go. A field so the tests can send them to a stand-in server. */
export const loadRunnerDeps: { fetch?: OneConnectionFetch; tickMs?: number; progressMs?: number } =
  {};

// ─── Limits ────────────────────────────────────────────────────────────────────

/** The limits of this installation: LOAD_LIMITS, raised or lowered by the environment. */
export interface InstallationLoadLimits extends LoadLimits {
  /** Load runs of one organization queued or running at once. */
  runsPerOrganization: number;
  /** Load runs one worker process executes at once; 0: this worker takes none. */
  runsPerWorker: number;
}

function integerSetting(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(
      `${name} must be a whole number of at least ${min}; got "${env[name]}". Leave it unset for ${fallback}.`,
    );
  }
  return value;
}

/**
 * Reads the limits from the environment. A malformed value throws naming the variable, as PORT
 * does: a limit silently read as its default is a run that was allowed or refused for no reason
 * anyone can see.
 */
export function loadLimits(env: NodeJS.ProcessEnv = process.env): InstallationLoadLimits {
  return {
    virtualUsers: integerSetting(env, 'LOAD_MAX_VIRTUAL_USERS', LOAD_LIMITS.virtualUsers, 1),
    durationSec: integerSetting(env, 'LOAD_MAX_DURATION_S', LOAD_LIMITS.durationSec, 1),
    runsPerOrganization: integerSetting(
      env,
      'LOAD_MAX_RUNS_PER_ORGANIZATION',
      LOAD_LIMITS.runsPerOrganization,
      1,
    ),
    runsPerWorker: integerSetting(env, 'LOAD_WORKER_CONCURRENCY', LOAD_LIMITS.runsPerWorker, 0),
  };
}

/** Load runs this process holds now: loadLimits().runsPerWorker at most. */
let localRuns = 0;
/** Takes one of the process's load slots, or answers false when they are all taken. */
export function reserveLoadSlot(): boolean {
  if (localRuns >= loadLimits().runsPerWorker) return false;
  localRuns += 1;
  return true;
}
export function releaseLoadSlot(): void {
  localRuns = Math.max(0, localRuns - 1);
}

// ─── The job ───────────────────────────────────────────────────────────────────

/** What a load-run job carries (server/platform/queue.ts, LOAD_RUN_JOB). Read as untrusted input. */
export const LoadRunJobSchema = z
  .object({
    runId: z.string().min(1),
    organizationId: z.number().int().positive(),
    userId: z.number().int().positive(),
  })
  .passthrough();
export type LoadRunJob = z.infer<typeof LoadRunJobSchema>;

/** The job id of a run: asking twice for the same run queues it once. */
export const loadJobId = (runId: string) => `load-${runId}`;

/**
 * Queues the run `runId`, already written as "queued", for a load worker, and writes the job on
 * it. Throws when the queue refuses it: the caller ends the run as an error and says so.
 */
export async function enqueueLoadRun(
  runId: string,
  organizationId: number,
  userId: number,
): Promise<string> {
  const { LOAD_RUN_JOB, loadQueue } = await import('../platform/queue');
  const job = await loadQueue.add(
    LOAD_RUN_JOB,
    { runId, organizationId, userId } satisfies LoadRunJob,
    { jobId: loadJobId(runId) },
  );
  const jobId = String(job.id ?? loadJobId(runId));
  await runWithTenant(
    organizationId,
    () =>
      withTenantTransaction(async (tx) => {
        await tx.update(loadTestRuns).set({ jobId }).where(eq(loadTestRuns.id, runId));
      }),
    { userId, role: 'editor' },
  );
  return jobId;
}

/**
 * Takes a queued run's job off the queue, when it is still waiting there. False when it is not:
 * a worker has it (the cancel flag on the run stops it), or it was never queued.
 */
export async function removeQueuedLoadJob(jobId: string | null): Promise<boolean> {
  if (!jobId) return false;
  try {
    const { loadQueue } = await import('../platform/queue');
    const job = await loadQueue.getJob(jobId);
    if (!job) return false;
    const state = await job.getState();
    if (state !== 'waiting' && state !== 'delayed' && state !== 'prioritized') return false;
    await job.remove();
    return true;
  } catch {
    // Locked by the worker that just took it: it reads the flag at its next progress.
    return false;
  }
}

/** How often a worker confirms the run it holds, and how long one may go quiet before it is lost. */
export const LOAD_RUN_HEARTBEAT_MS = WORK_ITEM_HEARTBEAT_MS;
export const LOAD_RUN_STALE_AFTER_MS = STALE_CLAIM_MS;
/** @deprecated The name the first version used; the same value as LOAD_RUN_STALE_AFTER_MS. */
export const LOAD_HEARTBEAT_STALE_MS = LOAD_RUN_STALE_AFTER_MS;

/** This process, as the run it takes names it. */
export const loadWorkerId = () => `${os.hostname()}:${process.pid}`;

export type LoadJobOutcome =
  /** The run was executed, whatever its verdict. */
  | { outcome: 'done' }
  /** The run was no longer queued: cancelled meanwhile, taken by another worker, or gone. */
  | { outcome: 'skipped'; reason: string }
  /** The organization is at its limit of runs at once: the job goes back for `retryInMs`. */
  | { outcome: 'deferred'; retryInMs: number };

export interface LoadJobDeps {
  /** What executes the run once it is claimed. A field so the tests can stand it in. */
  execute?: (runId: string, organizationId: number, userId: number) => Promise<void>;
  heartbeatMs?: number;
  workerId?: string;
  retryInMs?: number;
}

/**
 * A worker's side of a load-run job: claims the queued run (queued → running, with this worker's
 * name), keeps its heartbeat while it runs, and executes it with executeLoadRun. The
 * per-organization limit is checked again here — the web process checked it when it queued the
 * run, and a worker that took two runs of one organization would have them measure each other.
 */
export async function processLoadRunJob(
  data: LoadRunJob,
  deps: LoadJobDeps = {},
): Promise<LoadJobOutcome> {
  const { runId, organizationId, userId } = data;
  const limits = loadLimits();
  const workerId = deps.workerId ?? loadWorkerId();
  const claimed = await runWithTenant(
    organizationId,
    () =>
      withTenantTransaction(async (tx): Promise<LoadJobOutcome | { outcome: 'claimed' }> => {
        const [run] = await tx
          .select({ status: loadTestRuns.status })
          .from(loadTestRuns)
          .where(eq(loadTestRuns.id, runId))
          .limit(1);
        if (!run) return { outcome: 'skipped', reason: 'the run no longer exists' };
        if (run.status !== 'queued')
          return { outcome: 'skipped', reason: `the run is ${run.status}` };
        const [{ running }] = await tx
          .select({ running: count() })
          .from(loadTestRuns)
          .where(
            and(
              eq(loadTestRuns.organizationId, organizationId),
              eq(loadTestRuns.status, 'running'),
            ),
          );
        if (running >= limits.runsPerOrganization)
          return { outcome: 'deferred', retryInMs: deps.retryInMs ?? 10_000 };
        const now = new Date();
        const [taken] = await tx
          .update(loadTestRuns)
          .set({ status: 'running', workerId, startedAt: now, heartbeatAt: now })
          .where(and(eq(loadTestRuns.id, runId), eq(loadTestRuns.status, 'queued')))
          .returning();
        return taken
          ? { outcome: 'claimed' }
          : { outcome: 'skipped', reason: 'another worker took the run' };
      }),
    { userId, role: 'editor' },
  );
  if (claimed.outcome !== 'claimed') return claimed;

  if (!reserveLoadSlot()) {
    // The queue's concurrency is the slot count, so this is a worker asked to take more than it
    // may: the run goes back to the queue for another one.
    await runWithTenant(
      organizationId,
      () =>
        withTenantTransaction(async (tx) => {
          await tx
            .update(loadTestRuns)
            .set({ status: 'queued', workerId: null })
            .where(and(eq(loadTestRuns.id, runId), eq(loadTestRuns.status, 'running')));
        }),
      { userId, role: 'editor' },
    );
    return { outcome: 'deferred', retryInMs: deps.retryInMs ?? 10_000 };
  }
  const beat = () =>
    runWithTenant(
      organizationId,
      () =>
        withTenantTransaction(async (tx) => {
          await tx
            .update(loadTestRuns)
            .set({ heartbeatAt: new Date() })
            .where(and(eq(loadTestRuns.id, runId), eq(loadTestRuns.status, 'running')));
        }),
      { userId, role: 'editor' },
    ).catch(() => undefined);
  const timer = setInterval(() => void beat(), deps.heartbeatMs ?? LOAD_RUN_HEARTBEAT_MS);
  timer.unref?.();
  try {
    await (deps.execute ?? executeLoadRun)(runId, organizationId, userId);
  } finally {
    clearInterval(timer);
    releaseLoadSlot();
  }
  return { outcome: 'done' };
}

/**
 * Ends the running runs whose worker stopped answering: a crash, an out-of-memory kill, a
 * redeploy that did not wait. The heartbeat is written every LOAD_RUN_HEARTBEAT_MS and with every
 * progress; one quiet for LOAD_RUN_STALE_AFTER_MS is a dead worker, and the run ends as
 * `worker_lost` with the summary it had reached. Called within the tenant's transaction by the
 * routes that read runs, so the page polling a run sees it end. Answers the ids it ended.
 */
export async function recoverLostLoadRuns(
  tx: TenantTx,
  options: { now?: Date; staleAfterMs?: number } = {},
): Promise<string[]> {
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - (options.staleAfterMs ?? LOAD_RUN_STALE_AFTER_MS));
  const lastSignOfLife = sql`coalesce(${loadTestRuns.heartbeatAt}, ${loadTestRuns.startedAt})`;
  const lost = await tx
    .update(loadTestRuns)
    .set({
      status: 'worker_lost',
      error: sql`'The worker running this stopped answering (last heard from at ' || to_char(${lastSignOfLife}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '). Its results up to then are kept; the run did not finish.'`,
      finishedAt: now,
    })
    .where(and(eq(loadTestRuns.status, 'running'), lt(lastSignOfLife, staleBefore)))
    .returning();
  return lost.map((row) => row.id);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executes the load test run `runId`, already written as "running" with its definition, in this
 * process: processLoadRunJob calls it once it has claimed the run. Never throws: whatever goes
 * wrong is written on the run.
 */
export async function executeLoadRun(
  runId: string,
  organizationId: number,
  userId: number,
): Promise<void> {
  const limits = loadLimits();
  await runWithTenant(
    organizationId,
    async () => {
      const update = (values: Partial<typeof loadTestRuns.$inferInsert>) =>
        withTenantTransaction(async (tx) =>
          tx.update(loadTestRuns).set(values).where(eq(loadTestRuns.id, runId)).returning(),
        );
      try {
        const loaded = await withTenantTransaction(async (tx) => {
          const [run] = await tx
            .select()
            .from(loadTestRuns)
            .where(eq(loadTestRuns.id, runId))
            .limit(1);
          if (!run) return null;
          const definition = run.definition as unknown as LoadTestSnapshot;
          const ids = [...new Set(definition.steps.map((step) => step.apiTestId))];
          const tests = await tx.select().from(apiTests).where(inArray(apiTests.id, ids));
          const [dataSet] = definition.dataSetId
            ? await tx
                .select()
                .from(testDataSets)
                .where(
                  and(
                    eq(testDataSets.id, definition.dataSetId),
                    eq(testDataSets.organizationId, organizationId),
                  ),
                )
                .limit(1)
            : [];
          return { run, definition, tests, dataSet };
        });
        if (!loaded) return;
        const { run, definition, tests, dataSet } = loaded;
        // The worker's limits, not the web process's: the two may be configured apart.
        const beyond = profileProblem(definition.stages, limits);
        if (beyond) throw new LoadRunError(beyond);
        const byId = new Map(tests.map((test) => [test.id, test]));
        const missing = definition.steps.find((step) => !byId.has(step.apiTestId));
        if (missing)
          throw new LoadRunError(`API test #${missing.apiTestId} is no longer available.`);
        if (definition.dataSetId && !dataSet)
          throw new LoadRunError('The data set is no longer available.');
        if (dataSet) {
          const problem = dataSetProblem(definition, dataSet.rows.length);
          if (problem) throw new LoadRunError(problem);
        }
        const specs: ApiRequestSpec[] = definition.steps.map((step) =>
          apiTestSpec(byId.get(step.apiTestId)!),
        );
        const vars = await resolveVariables({
          userId,
          organizationId,
          environmentId: run.environmentId,
        });

        let cancelRequested = run.cancelRequested;
        const outcome = await withExecutionUsage(
          'api',
          () =>
            runLoad(
              {
                stages: definition.stages,
                maxVus: limits.virtualUsers,
                warmUpSec: definition.warmUpSec,
                thresholds: definition.thresholds ?? {},
                steps: definition.steps.map((step) => ({
                  name: byId.get(step.apiTestId)!.name,
                  thinkTimeMs: step.thinkTimeMs ?? 0,
                })),
                data: dataSet
                  ? {
                      set: dataSet.name,
                      columns: dataSet.columns,
                      rows: dataSet.rows,
                      mode: definition.dataMode,
                    }
                  : null,
              },
              vars,
              {
                now: Date.now,
                sleep,
                tickMs: loadRunnerDeps.tickMs,
                progressMs: loadRunnerDeps.progressMs,
                shouldStop: () => cancelRequested,
                send: async (index, stepVars) => {
                  const result = await runApiRequest(specs[index], stepVars, loadRunnerDeps.fetch);
                  return {
                    durationMs: result.durationMs,
                    error: failureOf(result),
                    extracted: result.extracted,
                  };
                },
                onProgress: async (summary) => {
                  // The same statement that writes the progress reads the cancel flag: the web
                  // process sets it, and this is where the worker looks.
                  const [row] = await update({ summary, heartbeatAt: new Date() });
                  cancelRequested = !row || !!row.cancelRequested;
                },
              },
            ),
          runId,
        );
        const status: LoadRunStatus = outcome.cancelled
          ? 'cancelled'
          : outcome.summary.breaches.length
            ? 'failed'
            : 'passed';
        await update({
          status,
          summary: outcome.summary,
          error: status === 'failed' ? outcome.summary.breaches.join('; ') : null,
          heartbeatAt: new Date(),
          finishedAt: new Date(),
        });
      } catch (error) {
        const message =
          error instanceof LoadRunError ? error.message : 'The load test could not run.';
        if (!(error instanceof LoadRunError))
          logger.error({
            message: 'Load run crashed',
            runId,
            error: String((error as Error)?.message ?? error),
          });
        await update({ status: 'error', error: message, finishedAt: new Date() }).catch(
          () => undefined,
        );
      }
    },
    { userId, role: 'editor' },
  );
}

/** The definition a run keeps (load_test_runs.definition). */
export interface LoadTestSnapshot {
  name: string;
  steps: Array<{ apiTestId: number; thinkTimeMs?: number }>;
  stages: LoadStage[];
  warmUpSec: number;
  dataSetId: number | null;
  dataMode: LoadDataMode;
  thresholds: LoadThresholds;
}

export function snapshotOf(test: typeof loadTests.$inferSelect): LoadTestSnapshot {
  return {
    name: test.name,
    steps: test.steps,
    stages: test.stages,
    warmUpSec: test.warmUpSec,
    dataSetId: test.dataSetId,
    dataMode: test.dataMode,
    thresholds: test.thresholds,
  };
}

export class LoadRunError extends Error {}
