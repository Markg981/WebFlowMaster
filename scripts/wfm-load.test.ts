import { describe, it, expect, vi } from 'vitest';
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
      if (url.pathname.startsWith('/api/v1/runs/')) {
        const run = runs.find(r => r.id === url.pathname.split('/').at(-1));
        if (!run) return json(404, {});
        return json(200, { ...run, queuedAt: iso(run.queuedAt), startedAt: iso(run.startedAt), completedAt: iso(run.completedAt), durationMs: run.completedAt ? run.completedAt - run.startedAt! : null, failure: null });
      }
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

describe('endurance safeguards', () => {
  it.each([['--readers', '1.5'], ['--runs', '1.5'], ['--poll', '0'], ['--interval-seconds', '0'], ['--target', 'k:']])('rejects invalid %s=%s', (flag, value) => {
    expect(parseArgs(['--url', 'https://wfm.test', '--target', 'k:p', flag, value], {})).toHaveProperty('error');
  });

  it('cycles bursts with reads and fresh idempotency keys, polling IDs directly', async () => {
    const sim = installation();
    const keys: string[] = [];
    const individual: string[] = [];
    const original = sim.io.fetch;
    sim.io.fetch = (async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST') keys.push(new Headers(init.headers).get('Idempotency-Key')!);
      if (new URL(input).pathname.startsWith('/api/v1/runs/')) individual.push(input);
      return original(input, init);
    }) as typeof fetch;
    const result = await runLoad(options({ soakSeconds: 20, intervalSeconds: 1, readers: 1, runs: 1, maxP95Ms: 10000 }), sim.io);
    expect(result.code).toBe(EXIT_OK);
    expect(result.cycles!.length).toBeGreaterThan(1);
    expect(result.cycles!.every(c => c.reads.requests > 0)).toBe(true);
    expect(individual.length).toBeGreaterThan(0);
    const again = await runLoad(options({ readSeconds: 0, runs: 1 }), sim.io);
    expect(again.code).toBe(EXIT_OK);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reports duplicate IDs as a breach', async () => {
    const sim = installation();
    const original = sim.io.fetch;
    sim.io.fetch = (async (input: string, init?: RequestInit) => {
      const response = await original(input, init);
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'duplicate' }), { status: 202 });
      return response;
    }) as typeof fetch;
    const result = await runLoad(options({ readSeconds: 0, runs: 2, runTimeoutSeconds: 1 }), sim.io);
    expect(result.breaches.some(b => b.includes('duplicate'))).toBe(true);
  });
});


describe('long-running request handling', () => {
  it('bounds latency samples while counting every read', async () => {
    const result = await runLoad(options({ readSeconds: 300, readers: 1, runs: 0 }), installation().io);
    expect(result.reads.requests).toBeGreaterThan(10000);
    expect(result.reads.latencySampleSize).toBe(10000);
  });

  it('detects accepted IDs missing from individual polling', async () => {
    const sim = installation();
    const original = sim.io.fetch;
    sim.io.fetch = (async (input: string, init?: RequestInit) => {
      if (new URL(input).pathname.startsWith('/api/v1/runs/')) return new Response('{}', { status: 404 });
      return original(input, init);
    }) as typeof fetch;
    const result = await runLoad(options({ readSeconds: 0, runs: 1, runTimeoutSeconds: 1 }), sim.io);
    expect(result.runs[0].missing).toBe(1);
    expect(result.breaches.some(b => b.includes('never retrieved'))).toBe(true);
  });

  it('bounds a hung HTTP start request and aborts it', async () => {
    vi.useFakeTimers();
    try {
      const sim = installation();
      const signals: AbortSignal[] = [];
      sim.io.fetch = (async (_input: string, init?: RequestInit) => {
        signals.push(init!.signal!);
        return new Promise<Response>(() => {});
      }) as typeof fetch;
      const pending = runLoad(options({ readSeconds: 0, runs: 1, requestTimeoutSeconds: 0.01 }), sim.io);
      await vi.advanceTimersByTimeAsync(11);
      const result = await pending;
      expect(result.code).toBe(EXIT_BREACHED);
      expect(signals.every(s => s.aborted)).toBe(true);
      expect(result.runs[0].startErrors).toContain('HTTP request deadline exceeded');
    } finally { vi.useRealTimers(); }
  });
});

describe('read authorization failures', () => {
  it('fails HTTP client errors and still counts 429 separately', () => {
    const summary = summariseReads([{ ms: 1, status: 401 }, { ms: 1, status: 403 }, { ms: 1, status: 404 }, { ms: 1, status: 429 }], 1);
    expect(summary).toMatchObject({ errors: 3, limited: 1, errorRate: 1 });
    expect(breaches(summary, [], { maxP95Ms: 1000, maxErrorRate: 0, maxConcurrent: 2 })).toHaveLength(1);
  });
});

describe('run-start limiting', () => {
  it.each(['rate_limited', 'queue_quota_exceeded', 'unknown', undefined])('fails a positive workload with no accepted starts (%s)', async code => {
    const sim = installation();
    sim.io.fetch = (async () => new Response(JSON.stringify(code ? { error: { code } } : {}), { status: 429 })) as typeof fetch;
    const result = await runLoad(options({ readSeconds: 0, runs: 1 }), sim.io);
    expect(result.code).toBe(EXIT_BREACHED);
    expect(result.breaches.some(b => b.includes('no runs accepted'))).toBe(true);
    if (code !== 'queue_quota_exceeded') expect(result.runs[0].startErrors).toContain(`429 ${code ?? 'unknown_error'}`);
  });

  it('allows explicit production queue rejection when some starts are accepted', async () => {
    const sim = installation({ queueCap: 1 });
    const original = sim.io.fetch;
    sim.io.fetch = (async (input: string, init?: RequestInit) => {
      const response = await original(input, init);
      if (response.status === 429) return new Response(JSON.stringify({ error: { code: 'queue_quota_exceeded' } }), { status: 429 });
      return response;
    }) as typeof fetch;
    const result = await runLoad(options({ readSeconds: 0, runs: 3 }), sim.io);
    expect(result.code).toBe(EXIT_OK);
    expect(result.runs[0]).toMatchObject({ started: 1, refused: 2, startErrors: [] });
  });
});
