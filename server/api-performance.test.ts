import { describe, expect, it } from 'vitest';
import { ApiPerformanceSchema, percentile, readApiResultLog, summarise } from '@shared/api-performance';
import { runApiRequest, type ApiRequestSpec } from './api-test-runner';
import { runPerformance } from './api-performance';

/** The minimal performance check of an API test: repetitions, percentiles, thresholds. */

describe('percentiles and thresholds', () => {
  it('uses nearest rank, so p95 of 20 samples is the 19th', () => {
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    expect(percentile(sorted, 50)).toBe(100);
    expect(percentile(sorted, 95)).toBe(190);
    expect(percentile(sorted, 100)).toBe(200);
    expect(percentile([], 95)).toBe(0);
  });

  it('names every threshold exceeded, and counts failed requests as errors', () => {
    const samples = [...Array.from({ length: 18 }, () => ({ durationMs: 100 })), { durationMs: 500 }, { durationMs: 900, error: 'HTTP 503' }];
    const summary = summarise(samples, { iterations: 20, concurrency: 2, thresholds: { p50Ms: 150, p95Ms: 300, maxMs: 1000, errorRatePct: 1 } });
    expect(summary).toMatchObject({ iterations: 20, errors: 1, errorRatePct: 5, p50Ms: 100, p95Ms: 500, maxMs: 900, sampleErrors: ['HTTP 503'] });
    expect(summary.breaches).toEqual(['p95 500 ms > 300 ms', 'errors 5% > 1% (1 of 20)']);
  });

  it('refuses settings beyond the caps, so a functional run cannot become a load test', () => {
    expect(ApiPerformanceSchema.safeParse({ iterations: 20, concurrency: 5, thresholds: { p95Ms: 300 } }).success).toBe(true);
    expect(ApiPerformanceSchema.safeParse({ iterations: 5000, concurrency: 5, thresholds: {} }).success).toBe(false);
    expect(ApiPerformanceSchema.safeParse({ iterations: 20, concurrency: 50, thresholds: {} }).success).toBe(false);
    expect(ApiPerformanceSchema.safeParse({ iterations: 1, concurrency: 1, thresholds: {} }).success).toBe(false);
  });

  it('reads the summary back from a result log, and nothing from another kind of log', () => {
    const summary = summarise([{ durationMs: 10 }, { durationMs: 20 }], { iterations: 2, concurrency: 1, thresholds: {} });
    expect(readApiResultLog(JSON.stringify({ api: true, performance: summary }))?.performance.p95Ms).toBe(20);
    expect(readApiResultLog(JSON.stringify([{ name: 'step' }]))).toBeNull();
    expect(readApiResultLog('not json')).toBeNull();
  });
});

describe('runPerformance', () => {
  const spec: ApiRequestSpec = {
    method: 'GET',
    url: 'https://api.example.test/orders',
    assertions: [{ id: '00000000-0000-4000-8000-000000000001', source: 'status_code', comparison: 'equals', targetValue: '200', enabled: true } as any],
  };

  it('sends the request until the iterations are done, never more than the concurrency at once', async () => {
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      const n = calls;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      // Every fifth request fails.
      return new Response('{}', { status: n % 5 === 0 ? 503 : 200, headers: { 'content-type': 'application/json' } });
    }) as any;
    const first = await runApiRequest(spec, {}, fetchImpl);
    const summary = await runPerformance(spec, {}, { iterations: 20, concurrency: 3, thresholds: { errorRatePct: 10 } }, first, fetchImpl);
    expect(calls).toBe(20);
    expect(peak).toBeLessThanOrEqual(3);
    expect(summary.iterations).toBe(20);
    expect(summary.errors).toBe(4);
    expect(summary.sampleErrors[0]).toContain('status_code equals "200" — actual: 503');
    expect(summary.breaches).toEqual(['errors 20% > 10% (4 of 20)']);
  });

  it('stops sending when the run is cancelled', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as any;
    const first = await runApiRequest(spec, {}, fetchImpl);
    const summary = await runPerformance(spec, {}, { iterations: 50, concurrency: 1, thresholds: {} }, first, fetchImpl, () => calls >= 5);
    expect(calls).toBe(5);
    expect(summary.iterations).toBe(5);
  });
});
