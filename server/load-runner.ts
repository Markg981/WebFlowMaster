import { and, eq, inArray } from 'drizzle-orm';
import { apiTests, loadTestRuns, loadTests, testDataSets } from '@shared/schema';
import {
  LOAD_LIMITS,
  dataSetProblem,
  loadBreaches,
  statsOf,
  totalDurationSec,
  vusAt,
  type LoadDataMode,
  type LoadRunStatus,
  type LoadStage,
  type LoadSummary,
  type LoadThresholds,
  type LoadTimelinePoint,
} from '@shared/load-test';
import { DATA_PREFIX } from '@shared/test-data';
import { apiTestSpec, runApiRequest, type ApiRequestSpec, type OneConnectionFetch } from './api-test-runner';
import { failureOf } from './api-performance';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { withExecutionUsage } from './execution-usage';
import { resolveVariables } from './variables';
import loggerPromise from './logger';

/**
 * Runs a load test (shared/load-test.ts) in this server process, apart from plans and their runners.
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
    return statsOf(this.requests, this.errors, this.sum, this.requests ? this.min : 0, this.max, this.sample);
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
  warmUpSec: number;
  thresholds: LoadThresholds;
  steps: Array<{ name: string; thinkTimeMs: number }>;
  /** The data set the virtual users read their rows from, when there is one. */
  data?: { set: string; columns: string[]; rows: Array<Record<string, string>>; mode: LoadDataMode } | null;
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

export async function runLoad(plan: LoadPlan, baseVars: Record<string, string>, deps: LoadEngineDeps): Promise<LoadOutcome> {
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
    if (!found) buckets.set(index, (found = { acc: new Accumulator(BUCKET_SAMPLE_SIZE, random), vus: 0 }));
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
    for (const column of plan.data!.columns) vars[`${DATA_PREFIX}.${plan.data!.set}.${column}`] = row[column] ?? '';
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
    const ownRow = plan.data?.mode === 'vu' ? rowVars(plan.data.rows[slot % plan.data.rows.length]) : {};
    let iteration = 0;
    try {
      while (!over() && slot < target) {
        iteration += 1;
        const row =
          plan.data?.mode === 'iteration' ? rowVars(plan.data.rows[globalIteration++ % plan.data.rows.length]) : ownRow;
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
        return { t: index * bucketSec, vus, requests: s.requests, errors: s.errors, p95Ms: s.p95Ms };
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
    target = Math.min(LOAD_LIMITS.virtualUsers, vusAt(plan.stages, now / 1000));
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
export const loadRunnerDeps: { fetch?: OneConnectionFetch; tickMs?: number; progressMs?: number } = {};

/** Load runs this process holds now: LOAD_LIMITS.runsPerProcess at most. */
let localRuns = 0;
/** Takes one of the process's load slots, or answers false when they are all taken. */
export function reserveLoadSlot(): boolean {
  if (localRuns >= LOAD_LIMITS.runsPerProcess) return false;
  localRuns += 1;
  return true;
}
export function releaseLoadSlot(): void {
  localRuns = Math.max(0, localRuns - 1);
}

/** A running run whose heartbeat is older than this was interrupted (restart, crash). */
export const LOAD_HEARTBEAT_STALE_MS = 60_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs the load test run `runId`, already written as "running" with its definition, on a slot taken
 * with reserveLoadSlot (released here). Never throws: whatever goes wrong is written on the run.
 */
export async function executeLoadRun(runId: string, organizationId: number, userId: number): Promise<void> {
  const logger = await loggerPromise;
  try {
    await runWithTenant(organizationId, async () => {
      const update = (values: Partial<typeof loadTestRuns.$inferInsert>) =>
        withTenantTransaction(async (tx) =>
          tx.update(loadTestRuns).set(values).where(eq(loadTestRuns.id, runId)).returning(),
        );
      try {
        const loaded = await withTenantTransaction(async (tx) => {
          const [run] = await tx.select().from(loadTestRuns).where(eq(loadTestRuns.id, runId)).limit(1);
          if (!run) return null;
          const definition = run.definition as unknown as LoadTestSnapshot;
          const ids = [...new Set(definition.steps.map((step) => step.apiTestId))];
          const tests = await tx.select().from(apiTests).where(inArray(apiTests.id, ids));
          const [dataSet] = definition.dataSetId
            ? await tx.select().from(testDataSets).where(and(eq(testDataSets.id, definition.dataSetId), eq(testDataSets.organizationId, organizationId))).limit(1)
            : [];
          return { run, definition, tests, dataSet };
        });
        if (!loaded) return;
        const { run, definition, tests, dataSet } = loaded;
        const byId = new Map(tests.map((test) => [test.id, test]));
        const missing = definition.steps.find((step) => !byId.has(step.apiTestId));
        if (missing) throw new LoadRunError(`API test #${missing.apiTestId} is no longer available.`);
        if (definition.dataSetId && !dataSet) throw new LoadRunError('The data set is no longer available.');
        if (dataSet) {
          const problem = dataSetProblem(definition, dataSet.rows.length);
          if (problem) throw new LoadRunError(problem);
        }
        const specs: ApiRequestSpec[] = definition.steps.map((step) => apiTestSpec(byId.get(step.apiTestId)!));
        const vars = await resolveVariables({ userId, organizationId, environmentId: run.environmentId });

        let cancelRequested = false;
        const outcome = await withExecutionUsage(
          'api',
          () =>
            runLoad(
              {
                stages: definition.stages,
                warmUpSec: definition.warmUpSec,
                thresholds: definition.thresholds ?? {},
                steps: definition.steps.map((step) => ({ name: byId.get(step.apiTestId)!.name, thinkTimeMs: step.thinkTimeMs ?? 0 })),
                data: dataSet ? { set: dataSet.name, columns: dataSet.columns, rows: dataSet.rows, mode: definition.dataMode } : null,
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
                  return { durationMs: result.durationMs, error: failureOf(result), extracted: result.extracted };
                },
                onProgress: async (summary) => {
                  const [row] = await update({ summary, heartbeatAt: new Date() });
                  cancelRequested = !!row?.cancelRequested;
                },
              },
            ),
          runId,
        );
        const status: LoadRunStatus = outcome.cancelled ? 'cancelled' : outcome.summary.breaches.length ? 'failed' : 'passed';
        await update({
          status,
          summary: outcome.summary,
          error: status === 'failed' ? outcome.summary.breaches.join('; ') : null,
          heartbeatAt: new Date(),
          finishedAt: new Date(),
        });
      } catch (error) {
        const message = error instanceof LoadRunError ? error.message : 'The load test could not run.';
        if (!(error instanceof LoadRunError)) logger.error({ message: 'Load run crashed', runId, error: String((error as Error)?.message ?? error) });
        await update({ status: 'error', error: message, finishedAt: new Date() }).catch(() => undefined);
      }
    }, { userId, role: 'editor' });
  } finally {
    releaseLoadSlot();
  }
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
