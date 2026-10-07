import { z } from "zod";
import { percentile } from "./api-performance";

/**
 * A load test: API tests run in sequence by virtual users, for a duration, with the number of users
 * following a profile of stages — up, held, down — instead of a fixed count of repetitions.
 *
 * The performance check of an API test (shared/api-performance.ts) repeats one request inside a
 * functional run, so it is capped to what a functional run can afford. A load test is run on its
 * own (server/load-runner.ts), never as part of a plan: it takes minutes and it is meant to stress
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

export const LOAD_LIMITS = {
  virtualUsers: 200,
  durationSec: 3600,
  stages: 10,
  steps: 20,
  thinkTimeMs: 60_000,
  /** Load runs one server process may hold at once, all organizations included. */
  runsPerProcess: 2,
} as const;

export const LOAD_DATA_MODES = ["vu", "iteration"] as const;
export type LoadDataMode = (typeof LOAD_DATA_MODES)[number];

export const LOAD_RUN_STATUSES = ["running", "passed", "failed", "cancelled", "error"] as const;
export type LoadRunStatus = (typeof LOAD_RUN_STATUSES)[number];

const ms = z.number().int().positive().max(600_000);

export const loadStepSchema = z
  .object({
    apiTestId: z.number().int().positive(),
    /** Pause after the step, as a user reading the answer would. */
    thinkTimeMs: z.number().int().min(0).max(LOAD_LIMITS.thinkTimeMs).default(0),
  })
  .strict();

export const loadStageSchema = z
  .object({
    durationSec: z.number().int().min(1).max(LOAD_LIMITS.durationSec),
    targetVus: z.number().int().min(0).max(LOAD_LIMITS.virtualUsers),
  })
  .strict();

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

export const loadTestSchema = z
  .object({
    name: z.string().trim().min(1, "A name is required.").max(200),
    description: z.string().max(2000).optional().nullable(),
    projectId: z.number().int().positive().optional().nullable(),
    steps: z.array(loadStepSchema).min(1, "Add at least one API test.").max(LOAD_LIMITS.steps),
    stages: z.array(loadStageSchema).min(1, "Add at least one stage.").max(LOAD_LIMITS.stages),
    warmUpSec: z.number().int().min(0).max(LOAD_LIMITS.durationSec).default(0),
    dataSetId: z.number().int().positive().optional().nullable(),
    dataMode: z.enum(LOAD_DATA_MODES).default("vu"),
    thresholds: loadThresholdsSchema.default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    const total = totalDurationSec(value.stages);
    if (total > LOAD_LIMITS.durationSec) {
      ctx.addIssue({ code: "custom", path: ["stages"], message: `The stages last ${total} s; the limit is ${LOAD_LIMITS.durationSec} s.` });
    }
    if (peakVus(value.stages) === 0) {
      ctx.addIssue({ code: "custom", path: ["stages"], message: "At least one stage needs virtual users." });
    }
    if (value.warmUpSec >= total) {
      ctx.addIssue({ code: "custom", path: ["warmUpSec"], message: "The warm-up must end before the last stage does." });
    }
  });

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
export function dataSetProblem(definition: Pick<LoadTestDefinition, "dataMode" | "stages">, rows: number): string | null {
  if (rows === 0) return "The data set has no rows.";
  const peak = peakVus(definition.stages);
  if (definition.dataMode === "vu" && rows < peak) {
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
  return { requests: 0, errors: 0, errorRatePct: 0, minMs: 0, meanMs: 0, p50Ms: 0, p90Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
}

/** The statistics of `requests`, of which `errors` failed, with `sample` their (sampled) durations. */
export function statsOf(requests: number, errors: number, sum: number, min: number, max: number, sample: number[]): LoadStats {
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

/** One line per threshold exceeded, as the API performance check writes them. */
export function loadBreaches(overall: LoadStats & { rps: number }, thresholds: LoadThresholds): string[] {
  if (overall.requests === 0) return ["no request was measured after the warm-up"];
  const breaches: string[] = [];
  const { p50Ms, p95Ms, p99Ms, maxMs, errorRatePct, minRps } = thresholds;
  if (p50Ms !== undefined && overall.p50Ms > p50Ms) breaches.push(`p50 ${overall.p50Ms} ms > ${p50Ms} ms`);
  if (p95Ms !== undefined && overall.p95Ms > p95Ms) breaches.push(`p95 ${overall.p95Ms} ms > ${p95Ms} ms`);
  if (p99Ms !== undefined && overall.p99Ms > p99Ms) breaches.push(`p99 ${overall.p99Ms} ms > ${p99Ms} ms`);
  if (maxMs !== undefined && overall.maxMs > maxMs) breaches.push(`max ${overall.maxMs} ms > ${maxMs} ms`);
  if (errorRatePct !== undefined && overall.errorRatePct > errorRatePct) {
    breaches.push(`errors ${overall.errorRatePct}% > ${errorRatePct}% (${overall.errors} of ${overall.requests})`);
  }
  if (minRps !== undefined && overall.rps < minRps) breaches.push(`throughput ${overall.rps} req/s < ${minRps} req/s`);
  return breaches;
}
