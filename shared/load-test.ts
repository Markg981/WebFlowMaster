import { z } from 'zod';
import { percentile } from './api-performance';

/**
 * A load test: API tests run in sequence by virtual users, for a duration, with the number of users
 * following a profile of stages — up, held, down — instead of a fixed count of repetitions.
 *
 * The performance check of an API test (shared/api-performance.ts) repeats one request inside a
 * functional run, so it is capped to what a functional run can afford. A load test is run on its
 * own (server/api-tests/load-runner.ts), never as part of a plan: it takes minutes and it is meant to stress
 * the system the functional tests are checking.
 *
 * - Stages: each one moves the number of virtual users linearly from where the previous one ended
 *   (0 at the start) to its target, over its duration. A stage with the same target holds it.
 * - Warm-up: the first seconds are run but not judged — caches, JIT and connection pools fill up.
 * - Scenario: the steps a virtual user repeats, in order; values one step captures are sent by the
 *   next ones of the same iteration, as in a plan.
 * - Data: with a data set, `{{data.<set>.<column>}}` is each virtual user's own row ("vu": as many
 *   rows as users at the peak, so no two users share one) or the next row on each iteration.
 */

/**
 * The limits as shipped. Virtual users and duration are configuration on the server
 * (LOAD_MAX_VIRTUAL_USERS, LOAD_MAX_DURATION_S: server/api-tests/load-runner.ts, loadLimits), and these are
 * their defaults; stages, steps and think time are fixed, and the database checks the first two.
 */
export const LOAD_LIMITS = {
  virtualUsers: 200,
  durationSec: 3600,
  stages: 10,
  steps: 20,
  thinkTimeMs: 60_000,
  /** Load runs of one organization queued or running at once (LOAD_MAX_RUNS_PER_ORGANIZATION). */
  runsPerOrganization: 1,
  /** Load runs one worker process executes at once (LOAD_WORKER_CONCURRENCY). */
  runsPerWorker: 1,
} as const;

/** What an installation may raise or lower; the rest of LOAD_LIMITS is fixed. */
export interface LoadLimits {
  virtualUsers: number;
  durationSec: number;
}

export const LOAD_DATA_MODES = ['vu', 'iteration'] as const;
export type LoadDataMode = (typeof LOAD_DATA_MODES)[number];

/**
 * A run is `queued` from the moment it is asked for until a load worker takes it, `running` from
 * then on, and ends as `passed`, `failed` (a threshold), `cancelled` (somebody stopped it, queued
 * or running), `error` (it could not run: a reference gone, a crash) or `worker_lost` (the worker
 * executing it stopped answering).
 */
export const LOAD_RUN_STATUSES = [
  'queued',
  'running',
  'passed',
  'failed',
  'cancelled',
  'error',
  'worker_lost',
] as const;
export type LoadRunStatus = (typeof LOAD_RUN_STATUSES)[number];

/** The statuses of a run that is not over: the page keeps polling it. */
export const LOAD_LIVE_RUN_STATUSES = ['queued', 'running'] as const satisfies LoadRunStatus[];
export function isLiveLoadRun(status: LoadRunStatus): boolean {
  return status === 'queued' || status === 'running';
}

const ms = z.number().int().positive().max(600_000);

export const loadStepSchema = z
  .object({
    apiTestId: z.number().int().positive(),
    /** Pause after the step, as a user reading the answer would. */
    thinkTimeMs: z.number().int().min(0).max(LOAD_LIMITS.thinkTimeMs).default(0),
  })
  .strict();

/** The stage schema under `limits`; its messages name the limit and the variable that sets it. */
export const loadStageSchemaFor = (limits: LoadLimits) =>
  z
    .object({
      durationSec: z
        .number()
        .int()
        .min(1)
        .max(limits.durationSec, {
          message: `A stage may last ${limits.durationSec} s at most (LOAD_MAX_DURATION_S).`,
        }),
      targetVus: z
        .number()
        .int()
        .min(0)
        .max(limits.virtualUsers, {
          message: `A stage may ask for ${limits.virtualUsers} virtual users at most (LOAD_MAX_VIRTUAL_USERS).`,
        }),
    })
    .strict();
export const loadStageSchema = loadStageSchemaFor(LOAD_LIMITS);

export const loadThresholdsSchema = z
  .object({
    p50Ms: ms.optional(),
    p95Ms: ms.optional(),
    p99Ms: ms.optional(),
    maxMs: ms.optional(),
    errorRatePct: z.number().min(0).max(100).optional(),
    /** Requests per second the system must at least sustain once warmed up. */
    minRps: z.number().positive().max(100_000).optional(),
  })
  .strict();

export type LoadStep = z.infer<typeof loadStepSchema>;
export type LoadStage = z.infer<typeof loadStageSchema>;
export type LoadThresholds = z.infer<typeof loadThresholdsSchema>;

/**
 * The definition schema under `limits`: the client checks with the shipped LOAD_LIMITS, the
 * server with the installation's (server/api-tests/load-runner.ts, loadLimits).
 */
export const loadTestSchemaFor = (limits: LoadLimits) =>
  z
    .object({
      name: z.string().trim().min(1, 'A name is required.').max(200),
      description: z.string().max(2000).optional().nullable(),
      projectId: z.number().int().positive().optional().nullable(),
      steps: z.array(loadStepSchema).min(1, 'Add at least one API test.').max(LOAD_LIMITS.steps),
      stages: z
        .array(loadStageSchemaFor(limits))
        .min(1, 'Add at least one stage.')
        .max(LOAD_LIMITS.stages),
      warmUpSec: z.number().int().min(0).max(limits.durationSec).default(0),
      dataSetId: z.number().int().positive().optional().nullable(),
      dataMode: z.enum(LOAD_DATA_MODES).default('vu'),
      thresholds: loadThresholdsSchema.default({}),
    })
    .strict()
    .superRefine((value, ctx) => {
      const problem = profileProblem(value.stages, limits);
      if (problem) ctx.addIssue({ code: 'custom', path: ['stages'], message: problem });
      if (peakVus(value.stages) === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['stages'],
          message: 'At least one stage needs virtual users.',
        });
      }
      if (value.warmUpSec >= totalDurationSec(value.stages)) {
        ctx.addIssue({
          code: 'custom',
          path: ['warmUpSec'],
          message: 'The warm-up must end before the last stage does.',
        });
      }
    });
export const loadTestSchema = loadTestSchemaFor(LOAD_LIMITS);

/**
 * Why a profile is beyond `limits`, naming the limit and the variable that sets it, or null. Asked
 * again when a run starts: a test saved under one limit may be run under a lower one.
 */
export function profileProblem(stages: readonly LoadStage[], limits: LoadLimits): string | null {
  const total = totalDurationSec(stages);
  if (total > limits.durationSec) {
    return `The stages last ${total} s; the limit is ${limits.durationSec} s (LOAD_MAX_DURATION_S).`;
  }
  const peak = peakVus(stages);
  if (peak > limits.virtualUsers) {
    return `The profile reaches ${peak} virtual users; the limit is ${limits.virtualUsers} (LOAD_MAX_VIRTUAL_USERS).`;
  }
  return null;
}

export type LoadTestDefinition = z.infer<typeof loadTestSchema>;

export function totalDurationSec(stages: readonly LoadStage[]): number {
  return stages.reduce((sum, stage) => sum + stage.durationSec, 0);
}

export function peakVus(stages: readonly LoadStage[]): number {
  return stages.reduce((max, stage) => Math.max(max, stage.targetVus), 0);
}

/** How many virtual users the profile asks for at `elapsedSec`: linear within each stage, from 0. */
export function vusAt(stages: readonly LoadStage[], elapsedSec: number): number {
  let from = 0;
  let start = 0;
  for (const stage of stages) {
    const end = start + stage.durationSec;
    if (elapsedSec < end) {
      const progress = Math.max(0, elapsedSec - start) / stage.durationSec;
      return Math.round(from + (stage.targetVus - from) * progress);
    }
    from = stage.targetVus;
    start = end;
  }
  return 0;
}

/** Why the data set cannot give each virtual user a row of its own, or null when it can. */
export function dataSetProblem(
  definition: Pick<LoadTestDefinition, 'dataMode' | 'stages'>,
  rows: number,
): string | null {
  if (rows === 0) return 'The data set has no rows.';
  const peak = peakVus(definition.stages);
  if (definition.dataMode === 'vu' && rows < peak) {
    return `The data set has ${rows} rows for ${peak} virtual users: each one needs a row of its own.`;
  }
  return null;
}

export interface LoadStats {
  requests: number;
  errors: number;
  errorRatePct: number;
  minMs: number;
  meanMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

/** A slice of the run: what the chart draws. */
export interface LoadTimelinePoint {
  /** Seconds from the start of the run. */
  t: number;
  vus: number;
  requests: number;
  errors: number;
  p95Ms: number;
}

export interface LoadSummary {
  elapsedSec: number;
  totalSec: number;
  warmUpSec: number;
  activeVus: number;
  peakVus: number;
  iterations: { completed: number; failed: number };
  /** What the warm-up sent; not part of the verdict. */
  warmUp: { requests: number; errors: number };
  /** After the warm-up. Percentiles over a uniform sample when there are more than 10,000. */
  overall: LoadStats & { rps: number };
  steps: Array<LoadStats & { name: string }>;
  timeline: LoadTimelinePoint[];
  bucketSec: number;
  breaches: string[];
  sampleErrors: string[];
}

export function emptyStats(): LoadStats {
  return {
    requests: 0,
    errors: 0,
    errorRatePct: 0,
    minMs: 0,
    meanMs: 0,
    p50Ms: 0,
    p90Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    maxMs: 0,
  };
}

/** The statistics of `requests`, of which `errors` failed, with `sample` their (sampled) durations. */
export function statsOf(
  requests: number,
  errors: number,
  sum: number,
  min: number,
  max: number,
  sample: number[],
): LoadStats {
  if (requests === 0) return emptyStats();
  const sorted = [...sample].sort((a, b) => a - b);
  return {
    requests,
    errors,
    errorRatePct: Math.round((errors / requests) * 1000) / 10,
    minMs: min,
    meanMs: Math.round(sum / requests),
    p50Ms: percentile(sorted, 50),
    p90Ms: percentile(sorted, 90),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: max,
  };
}

/** Without an `errorRatePct` threshold, a load answered by errors more often than this still fails. */
export const DEFAULT_ERROR_RATE_PCT = 50;

/** One line per threshold exceeded, as the API performance check writes them. */
export function loadBreaches(
  overall: LoadStats & { rps: number },
  thresholds: LoadThresholds,
): string[] {
  if (overall.requests === 0) return ['no request was measured after the warm-up'];
  const breaches: string[] = [];
  const { p50Ms, p95Ms, p99Ms, maxMs, minRps } = thresholds;
  const errorRatePct = thresholds.errorRatePct ?? DEFAULT_ERROR_RATE_PCT;
  if (p50Ms !== undefined && overall.p50Ms > p50Ms)
    breaches.push(`p50 ${overall.p50Ms} ms > ${p50Ms} ms`);
  if (p95Ms !== undefined && overall.p95Ms > p95Ms)
    breaches.push(`p95 ${overall.p95Ms} ms > ${p95Ms} ms`);
  if (p99Ms !== undefined && overall.p99Ms > p99Ms)
    breaches.push(`p99 ${overall.p99Ms} ms > ${p99Ms} ms`);
  if (maxMs !== undefined && overall.maxMs > maxMs)
    breaches.push(`max ${overall.maxMs} ms > ${maxMs} ms`);
  if (overall.errorRatePct > errorRatePct) {
    breaches.push(
      `errors ${overall.errorRatePct}% > ${errorRatePct}% (${overall.errors} of ${overall.requests})`,
    );
  }
  if (minRps !== undefined && overall.rps < minRps)
    breaches.push(`throughput ${overall.rps} req/s < ${minRps} req/s`);
  return breaches;
}
