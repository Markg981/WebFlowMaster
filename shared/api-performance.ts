import { z } from "zod";

/**
 * A minimal performance check for an API test: the request sent N times, a few at once, and the
 * response times held against thresholds on percentiles and on the share of errors.
 *
 * One request's response time (the response_time assertion) is a sample of one: a garbage collection
 * or a cold cache decides it. Percentiles over a few dozen requests say how the endpoint behaves.
 * This is not a load test — the caps keep it to what a functional run can afford — but it answers
 * "did this endpoint get slower" on every run, with a verdict.
 */

export const PERFORMANCE_LIMITS = { iterations: 200, concurrency: 10 } as const;

const ms = z.number().int().positive().max(600_000);

export const ApiPerformanceSchema = z
  .object({
    /** How many requests, the functional one included. */
    iterations: z.number().int().min(2).max(PERFORMANCE_LIMITS.iterations),
    /** How many are in flight at once. */
    concurrency: z.number().int().min(1).max(PERFORMANCE_LIMITS.concurrency),
    thresholds: z
      .object({
        p50Ms: ms.optional(),
        p95Ms: ms.optional(),
        maxMs: ms.optional(),
        /** Percent of requests that may fail (could not be made, or failed an assertion). */
        errorRatePct: z.number().min(0).max(100).optional(),
      })
      .strict(),
  })
  .strict();

export type ApiPerformance = z.infer<typeof ApiPerformanceSchema>;

export interface PerformanceSummary {
  iterations: number;
  concurrency: number;
  errors: number;
  errorRatePct: number;
  minMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** One line per threshold exceeded: "p95 412 ms > 300 ms". Empty when within all of them. */
  breaches: string[];
  /** The first errors, so a failing endpoint says why, not only how often. */
  sampleErrors: string[];
}

/** The detailed_log of an API result that ran a performance check. */
export interface ApiResultLog {
  api: true;
  performance: PerformanceSummary;
}

/** Nearest-rank percentile: the smallest value with at least p% of the samples at or below it. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarise(
  samples: Array<{ durationMs: number; error?: string | null }>,
  settings: ApiPerformance,
): PerformanceSummary {
  const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
  const failed = samples.filter((s) => s.error);
  const errorRatePct = samples.length ? Math.round((failed.length / samples.length) * 1000) / 10 : 0;
  const summary: PerformanceSummary = {
    iterations: samples.length,
    concurrency: settings.concurrency,
    errors: failed.length,
    errorRatePct,
    minMs: durations[0] ?? 0,
    meanMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: durations[durations.length - 1] ?? 0,
    breaches: [],
    sampleErrors: Array.from(new Set(failed.map((s) => s.error!))).slice(0, 3),
  };
  const { p50Ms, p95Ms, maxMs, errorRatePct: maxErrors } = settings.thresholds;
  if (p50Ms !== undefined && summary.p50Ms > p50Ms) summary.breaches.push(`p50 ${summary.p50Ms} ms > ${p50Ms} ms`);
  if (p95Ms !== undefined && summary.p95Ms > p95Ms) summary.breaches.push(`p95 ${summary.p95Ms} ms > ${p95Ms} ms`);
  if (maxMs !== undefined && summary.maxMs > maxMs) summary.breaches.push(`max ${summary.maxMs} ms > ${maxMs} ms`);
  if (maxErrors !== undefined && summary.errorRatePct > maxErrors) {
    summary.breaches.push(`errors ${summary.errorRatePct}% > ${maxErrors}% (${summary.errors} of ${summary.iterations})`);
  }
  return summary;
}

/** The performance summary in a result's detailed_log, or null for any other result. */
export function readApiResultLog(detailedLog: string | null | undefined): ApiResultLog | null {
  if (!detailedLog) return null;
  try {
    const parsed = JSON.parse(detailedLog);
    return parsed && parsed.api === true && parsed.performance && typeof parsed.performance.p95Ms === "number" ? (parsed as ApiResultLog) : null;
  } catch {
    return null;
  }
}
