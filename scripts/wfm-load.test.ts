import { describe, it, expect } from 'vitest';
import { EXIT_BREACHED, EXIT_OK, breaches, maxOverlap, parseArgs, percentile, runLoad, summariseReads, type LoadIo, type LoadOptions } from './wfm-load';

/**
 * The load test against a simulated installation on a virtual clock: a queue that starts at most
 * `limit` runs of an organization at once (or ignores it), runs that take three seconds, a queue
 * that refuses past `queueCap`. What matters is what the tool concludes from what it sees.
 */

interface SimRun { id: string; planId: string; status: string; queuedAt: number; startedAt: number | null; completedAt: number | null; ends: string }

function installation({ limit = 2, queueCap = 100, readMs = 20, endAs = () => 'completed' }: { limit?: number; queueCap?: number; readMs?: number; endAs?: (n: number) => string } = {}) {
  let t = 1_000_000;
  const runs: SimRun[] = [];
  const tick = () => {
    for (const run of runs) if (run.status === 'running' && t >= run.startedAt! + 3000) { run.status = run.ends; run.completedAt = run.startedAt! + 3000; }
    for (const planId of new Set(runs.map((r) => r.planId))) {
      const mine = runs.filter((r) => r.planId === planId);
      for (const run of mine.filter((r) => r.status === 'queued')) {
        if (mine.filter((r) => r.status === 'running').length >= limit) break;
        run.status = 'running';
        run.startedAt = t;
      }
    }
  };
  const iso = (n: number | null) => (n === null ? null : new Date(n).toISOString());
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers(headers) }) as unknown as Response;
  const io: LoadIo = {
    now: () => t,
    sleep: async (ms) => { t += ms; tick(); },
    log: () => {},
    fetch: (async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (init?.method === 'POST') {
        const planId = url.pathname.split('/')[4];
        if (runs.filter((r) => r.planId === planId && r.status === 'queued').length >= queueCap) return json(429, { error: { code: 'queue_full' } });
        const run: SimRun = { id: `r${runs.length}`, planId, status: 'queued', queuedAt: t, startedAt: null, completedAt: null, ends: endAs(runs.length) };
        runs.push(run);
        return json(202, { id: run.id });
      }
      t += readMs;
      tick();
      if (url.pathname === '/api/v1/runs' && url.searchParams.get('planId')) {
        const items = runs.filter((r) => r.planId === url.searchParams.get('planId')).map((r) => ({ ...r, queuedAt: iso(r.queuedAt), startedAt: iso(r.startedAt), completedAt: iso(r.completedAt), durationMs: r.completedAt ? r.completedAt - r.startedAt! : null, failure: null }));
        return json(200, { items });
      }
      return json(200, { items: [] });
    }) as unknown as typeof fetch,
  };
  return { io, runs };
}

const options = (overrides: Partial<LoadOptions> = {}): LoadOptions => ({
  baseUrl: 'https://wfm.test',
  targets: [{ key: 'wfm_a', planId: 'plan-a' }, { key: 'wfm_b', planId: 'plan-b' }],
  readers: 4,
  readSeconds: 2,
  runs: 6,
  maxConcurrent: 2,
  runTimeoutSeconds: 120,
  pollSeconds: 1,
  maxP95Ms: 1000,
  maxErrorRate: 0,
  ...overrides,
});

describe('reading its options', () => {
  it('takes targets as key:plan, and refuses what it cannot run', () => {
    const parsed = parseArgs(['--url', 'https://wfm.test/', '--target', 'wfm_abc:3f2a-plan', '--runs', '5'], {});
    expect(parsed).toMatchObject({ baseUrl: 'https://wfm.test', targets: [{ key: 'wfm_abc', planId: '3f2a-plan' }], runs: 5, readers: 10 });
    expect(parseArgs(['--target', 'k:p'], {})).toEqual({ error: expect.stringContaining('--url') });
    expect(parseArgs(['--url', 'u'], {})).toEqual({ error: expect.stringContaining('--target') });
    expect(parseArgs(['--url', 'u', '--target', 'nocolon'], {})).toEqual({ error: expect.stringContaining('--target') });
    expect(parseArgs(['--url', 'u', '--target', 'k:p', '--runs', 'many'], {})).toEqual({ error: expect.stringContaining('--runs') });
  });
});

describe('the arithmetic', () => {
  it('takes percentiles by nearest rank, and counts the rate limit apart from errors', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
    expect(percentile([], 95)).toBeNull();
    const reads = summariseReads([{ ms: 10, status: 200 }, { ms: 30, status: 200 }, { ms: 5, status: 429 }, { ms: 50, status: 503 }, { ms: 0, status: 0 }], 1);
    expect(reads).toMatchObject({ requests: 5, limited: 1, errors: 2, errorRate: 0.5, slowest: 50 });
  });
});

describe('runs in progress at once', () => {
  it('is worked out from start and end times, so runs shorter than a poll are counted', () => {
    const at = (s: number) => new Date(1_000_000 + s * 1000).toISOString();
    expect(maxOverlap([{ startedAt: at(0), completedAt: at(1) }, { startedAt: at(0.5), completedAt: at(2) }, { startedAt: at(0.7), completedAt: at(0.9) }])).toBe(3);
    // One ending as the next starts is not two at once.
    expect(maxOverlap([{ startedAt: at(0), completedAt: at(1) }, { startedAt: at(1), completedAt: at(2) }])).toBe(1);
    expect(maxOverlap([{ startedAt: null, completedAt: null }])).toBe(0);
  });
});

describe('a load test', () => {
  it('passes an installation that keeps each organization to its limit and finishes every run', async () => {
    const sim = installation({ limit: 2 });
    const result = await runLoad(options(), sim.io);
    expect(result.breaches).toEqual([]);
    expect(result.code).toBe(EXIT_OK);
    // One clock for four concurrent readers: each sees the others' requests too.
    expect(result.reads.p95).toBeGreaterThan(0);
    expect(result.reads.errors).toBe(0);
    for (const run of result.runs) {
      expect(run).toMatchObject({ started: 6, statuses: { completed: 6 }, unfinished: 0, maxRunning: 2 });
      // Six runs two at a time, three seconds each: the last waits two rounds.
      expect(run.waitP95).toBeGreaterThanOrEqual(6000);
    }
  });

  it('fails an installation that lets an organization run more than its limit', async () => {
    const result = await runLoad(options({ runs: 4 }), installation({ limit: 4 }).io);
    expect(result.code).toBe(EXIT_BREACHED);
    expect(result.breaches).toContain('target 1: 4 runs in progress at once > 2');
  });

  it('fails on runs that end in error, and on runs that never end', async () => {
    const lost = await runLoad(options({ runs: 2, targets: [{ key: 'k', planId: 'p' }] }), installation({ endAs: (n) => (n === 1 ? 'error' : 'completed') }).io);
    expect(lost.breaches).toContain('target 1: 1 runs ended error');
    const stuck = await runLoad(options({ runs: 2, runTimeoutSeconds: 2, targets: [{ key: 'k', planId: 'p' }] }), installation({ limit: 1 }).io);
    expect(stuck.breaches.some((b) => b.includes('not ended in time'))).toBe(true);
  });

  it('counts a full queue as refused, which is the queue doing its job', async () => {
    const result = await runLoad(options({ runs: 8, targets: [{ key: 'k', planId: 'p' }] }), installation({ queueCap: 3 }).io);
    expect(result.runs[0]).toMatchObject({ started: 3, refused: 5 });
    expect(result.code).toBe(EXIT_OK);
  });

  it('fails slow reads', () => {
    const reads = summariseReads(Array.from({ length: 20 }, (_, i) => ({ ms: i < 18 ? 100 : 2000, status: 200 })), 1);
    expect(breaches(reads, [], { maxP95Ms: 1000, maxErrorRate: 0, maxConcurrent: 2 })).toEqual(['reads: p95 2000 ms > 1000 ms']);
  });
});
