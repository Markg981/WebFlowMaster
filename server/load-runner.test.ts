import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataSetProblem, loadBreaches, loadTestSchema, peakVus, statsOf, totalDurationSec, vusAt } from '@shared/load-test';
import { runLoad, type LoadEngineDeps, type LoadPlan, type StepOutcome } from './load-runner';

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * The load engine under a virtual clock: Date.now and setTimeout are vitest's fake timers, so a
 * minute of load runs in milliseconds and every count is exact.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function engine(send: LoadEngineDeps['send'], extra: Partial<LoadEngineDeps> = {}): LoadEngineDeps {
  return { now: () => Date.now(), sleep, send, random: () => 0.5, ...extra };
}

async function runFor(plan: LoadPlan, deps: LoadEngineDeps, vars: Record<string, string> = {}) {
  const outcome = runLoad(plan, vars, deps);
  await vi.advanceTimersByTimeAsync((plan.stages.reduce((s, x) => s + x.durationSec, 0) + 5) * 1000);
  return outcome;
}

const ok = (durationMs: number, extracted: Record<string, string> = {}): StepOutcome => ({ durationMs, error: null, extracted });

describe('the stage profile', () => {
  const stages = [
    { durationSec: 10, targetVus: 10 },
    { durationSec: 20, targetVus: 10 },
    { durationSec: 10, targetVus: 0 },
  ];

  it('ramps linearly from zero, holds, and ramps down', () => {
    expect(vusAt(stages, 0)).toBe(0);
    expect(vusAt(stages, 5)).toBe(5);
    expect(vusAt(stages, 10)).toBe(10);
    expect(vusAt(stages, 25)).toBe(10);
    expect(vusAt(stages, 35)).toBe(5);
    expect(vusAt(stages, 40)).toBe(0);
    expect(totalDurationSec(stages)).toBe(40);
    expect(peakVus(stages)).toBe(10);
  });

  it('refuses a profile that never has users, lasts too long, or warms up past its end', () => {
    const base = { name: 'Checkout', steps: [{ apiTestId: 1 }] };
    expect(loadTestSchema.safeParse({ ...base, stages: [{ durationSec: 30, targetVus: 0 }] }).success).toBe(false);
    expect(loadTestSchema.safeParse({ ...base, stages: [{ durationSec: 3000, targetVus: 5 }, { durationSec: 601, targetVus: 5 }] }).success).toBe(false);
    expect(loadTestSchema.safeParse({ ...base, stages: [{ durationSec: 30, targetVus: 5 }], warmUpSec: 30 }).success).toBe(false);
    expect(loadTestSchema.safeParse({ ...base, stages: [{ durationSec: 30, targetVus: 201 }] }).success).toBe(false);
    const parsed = loadTestSchema.parse({ ...base, stages: [{ durationSec: 30, targetVus: 5 }], warmUpSec: 10 });
    expect(parsed).toMatchObject({ dataMode: 'vu', thresholds: {}, steps: [{ apiTestId: 1, thinkTimeMs: 0 }] });
  });

  it('asks for a row per virtual user at the peak, unless rows rotate per iteration', () => {
    const stagesOf20 = [{ durationSec: 10, targetVus: 20 }];
    expect(dataSetProblem({ dataMode: 'vu', stages: stagesOf20 }, 19)).toMatch(/19 rows for 20 virtual users/);
    expect(dataSetProblem({ dataMode: 'vu', stages: stagesOf20 }, 20)).toBeNull();
    expect(dataSetProblem({ dataMode: 'iteration', stages: stagesOf20 }, 1)).toBeNull();
    expect(dataSetProblem({ dataMode: 'iteration', stages: stagesOf20 }, 0)).toMatch(/no rows/);
  });

  it('judges throughput and percentiles, and fails a run that measured nothing', () => {
    const stats = { ...statsOf(4, 1, 1000, 100, 400, [100, 200, 300, 400]), rps: 2 };
    expect(stats).toMatchObject({ p50Ms: 200, p95Ms: 400, p99Ms: 400, errorRatePct: 25, meanMs: 250 });
    expect(loadBreaches(stats, { p95Ms: 300, errorRatePct: 10, minRps: 5 })).toEqual([
      'p95 400 ms > 300 ms',
      'errors 25% > 10% (1 of 4)',
      'throughput 2 req/s < 5 req/s',
    ]);
    expect(loadBreaches({ ...statsOf(0, 0, 0, 0, 0, []), rps: 0 }, {})).toEqual(['no request was measured after the warm-up']);
  });
});

describe('runLoad', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('follows the ramp: the users in flight never exceed what the stage asks for', async () => {
    let inFlight = 0;
    const seen: Array<{ t: number; inFlight: number }> = [];
    const start = Date.now();
    const plan: LoadPlan = {
      stages: [{ durationSec: 10, targetVus: 8 }, { durationSec: 10, targetVus: 8 }, { durationSec: 10, targetVus: 0 }],
      warmUpSec: 0,
      thresholds: {},
      steps: [{ name: 'GET /items', thinkTimeMs: 0 }],
    };
    const { summary } = await runFor(plan, engine(async () => {
      inFlight += 1;
      seen.push({ t: (Date.now() - start) / 1000, inFlight });
      await sleep(100);
      inFlight -= 1;
      return ok(100);
    }));
    // During the hold, every one of the 8 users is busy.
    expect(Math.max(...seen.filter((s) => s.t >= 10 && s.t < 20).map((s) => s.inFlight))).toBe(8);
    // Ramping up, never more than the profile (plus one tick of rounding).
    for (const { t, inFlight: n } of seen.filter((s) => s.t < 10)) expect(n).toBeLessThanOrEqual(Math.round(0.8 * t) + 1);
    expect(summary.peakVus).toBe(8);
    expect(summary.activeVus).toBe(0);
    expect(summary.elapsedSec).toBe(30);
    // The timeline draws the ramp: up, flat, down.
    const vus = summary.timeline.map((p) => p.vus);
    expect(vus[0]).toBeLessThan(vus[15]);
    expect(vus[15]).toBe(8);
    expect(vus[vus.length - 1]).toBeLessThan(8);
    expect(summary.breaches).toEqual([]);
  });

  it('leaves the warm-up out of the verdict, and still shows it on the timeline', async () => {
    const start = Date.now();
    const plan: LoadPlan = {
      stages: [{ durationSec: 20, targetVus: 2 }],
      warmUpSec: 10,
      thresholds: { maxMs: 50 },
      steps: [{ name: 'GET /cold', thinkTimeMs: 0 }],
    };
    // Slow while caches are cold, fast afterwards.
    const { summary } = await runFor(plan, engine(async () => {
      const cold = Date.now() - start < 10_000;
      await sleep(cold ? 500 : 20);
      return ok(cold ? 500 : 20);
    }));
    expect(summary.warmUp.requests).toBeGreaterThan(0);
    expect(summary.overall.maxMs).toBe(20);
    expect(summary.breaches).toEqual([]);
    expect(Math.max(...summary.timeline.filter((p) => p.t < 10).map((p) => p.p95Ms))).toBe(500);
    // Throughput over the measured 10 s only: two users, 20 ms per request.
    expect(summary.overall.rps).toBeGreaterThan(50);
  });

  it('runs the scenario in order, sending what one step captured to the next one', async () => {
    const calls: Array<{ step: number; token?: string; vu: string; iteration: string }> = [];
    const plan: LoadPlan = {
      stages: [{ durationSec: 3, targetVus: 2 }],
      warmUpSec: 0,
      thresholds: {},
      steps: [{ name: 'POST /login', thinkTimeMs: 0 }, { name: 'GET /cart', thinkTimeMs: 200 }],
    };
    const { summary } = await runFor(plan, engine(async (step, vars) => {
      calls.push({ step, token: vars.token, vu: vars['load.vu'], iteration: vars['load.iteration'] });
      await sleep(50);
      return step === 0 ? ok(50, { token: `t-${vars['load.vu']}-${vars['load.iteration']}` }) : ok(50);
    }));
    const carts = calls.filter((c) => c.step === 1);
    expect(carts.length).toBeGreaterThan(0);
    for (const cart of carts) expect(cart.token).toBe(`t-${cart.vu}-${cart.iteration}`);
    expect(summary.steps.map((s) => s.name)).toEqual(['POST /login', 'GET /cart']);
    expect(summary.iterations.completed).toBeGreaterThan(0);
    expect(summary.iterations.failed).toBe(0);
  });

  it('gives each virtual user its own data row', async () => {
    const byVu = new Map<string, Set<string>>();
    const plan: LoadPlan = {
      stages: [{ durationSec: 4, targetVus: 3 }, { durationSec: 4, targetVus: 3 }],
      warmUpSec: 0,
      thresholds: {},
      steps: [{ name: 'POST /login', thinkTimeMs: 100 }],
      data: { set: 'users', columns: ['email'], rows: [{ email: 'a@x' }, { email: 'b@x' }, { email: 'c@x' }], mode: 'vu' },
    };
    await runFor(plan, engine(async (_step, vars) => {
      const vu = vars['load.vu'];
      byVu.set(vu, (byVu.get(vu) ?? new Set()).add(vars['data.users.email']));
      await sleep(30);
      return ok(30);
    }, { tickMs: 100 }), { 'data.users.email': 'first-row@x' });
    expect([...byVu.keys()].sort()).toEqual(['1', '2', '3']);
    expect([...byVu.values()].map((emails) => [...emails])).toEqual(expect.arrayContaining([['a@x'], ['b@x'], ['c@x']]));
  });

  it('rotates through the rows on every iteration when asked to', async () => {
    const emails: string[] = [];
    const plan: LoadPlan = {
      stages: [{ durationSec: 2, targetVus: 1 }, { durationSec: 3, targetVus: 1 }],
      warmUpSec: 0,
      thresholds: {},
      steps: [{ name: 'GET /search', thinkTimeMs: 0 }],
      data: { set: 'terms', columns: ['q'], rows: [{ q: 'red' }, { q: 'green' }], mode: 'iteration' },
    };
    await runFor(plan, engine(async (_step, vars) => {
      emails.push(vars['data.terms.q']);
      await sleep(400);
      return ok(400);
    }));
    expect(emails.slice(0, 4)).toEqual(['red', 'green', 'red', 'green']);
  });

  it('ends an iteration at its first failure and judges the errors', async () => {
    let n = 0;
    const plan: LoadPlan = {
      stages: [{ durationSec: 5, targetVus: 1 }, { durationSec: 5, targetVus: 1 }],
      warmUpSec: 0,
      thresholds: { errorRatePct: 10 },
      steps: [{ name: 'POST /order', thinkTimeMs: 0 }, { name: 'GET /order', thinkTimeMs: 0 }],
    };
    const sent: number[] = [];
    const { summary } = await runFor(plan, engine(async (step) => {
      sent.push(step);
      await sleep(100);
      if (step === 0 && ++n % 2 === 0) return { durationMs: 100, error: 'status_code equals "201" — actual: 503', extracted: {} };
      return ok(100);
    }));
    expect(summary.iterations.failed).toBeGreaterThan(0);
    // A failed order is never read back.
    expect(summary.steps[1].requests).toBe(summary.iterations.completed);
    // At most one order placed as the run ended, before it could be read back.
    expect(summary.steps[0].requests - summary.iterations.completed - summary.iterations.failed).toBeLessThanOrEqual(1);
    expect(sent.length).toBe(summary.steps[0].requests + summary.steps[1].requests);
    expect(summary.sampleErrors).toEqual(['POST /order: status_code equals "201" — actual: 503']);
    expect(summary.breaches[0]).toMatch(/^errors \d+(\.\d)?% > 10%/);
  });

  it('stops when cancelled, and says so', async () => {
    let stop = false;
    const progress: number[] = [];
    const plan: LoadPlan = { stages: [{ durationSec: 60, targetVus: 2 }], warmUpSec: 0, thresholds: {}, steps: [{ name: 'GET /', thinkTimeMs: 0 }] };
    const outcome = runLoad(plan, {}, engine(async () => { await sleep(100); return ok(100); }, {
      shouldStop: () => stop,
      onProgress: (s) => { progress.push(s.elapsedSec); },
    }));
    await vi.advanceTimersByTimeAsync(5_000);
    stop = true;
    await vi.advanceTimersByTimeAsync(1_000);
    const { cancelled, summary } = await outcome;
    expect(cancelled).toBe(true);
    expect(summary.elapsedSec).toBeLessThan(10);
    expect(progress.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the timeline to 240 points over an hour', async () => {
    const plan: LoadPlan = { stages: [{ durationSec: 3600, targetVus: 1 }], warmUpSec: 0, thresholds: {}, steps: [{ name: 'GET /', thinkTimeMs: 5_000 }] };
    const { summary } = await runFor(plan, engine(async () => { await sleep(10); return ok(10); }, { tickMs: 1_000 }));
    expect(summary.bucketSec).toBe(15);
    expect(summary.timeline.length).toBeLessThanOrEqual(240);
  });
});
