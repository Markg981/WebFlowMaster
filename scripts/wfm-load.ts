import { randomUUID } from 'node:crypto';
/**
 * A load test of a WebFlowMaster installation: how fast it answers while busy, and whether its run
 * queue holds under a burst — each organization's limit on runs in progress kept, every run
 * finished, none lost.
 *
 *   npx tsx scripts/wfm-load.ts --url https://wfm.example.com \
 *     --target <api key>:<plan id> [--target <key>:<plan id> …] [options]
 *
 * It speaks /api/v1 only, with keys (scopes plans:read, runs:read, runs:write), so it measures what
 * a pipeline meets and needs nothing else. Each target is a key and a plan of one organization;
 * give one per organization to see how they share the runners. It creates no data of its own: the
 * plan it runs is yours — make it cheap (one API test against something nearby) unless the browsers
 * are what you want to load — and its runs stay in the plan's history.
 *
 * Two phases:
 *   1. Reads: --readers clients for --read-seconds, listing plans and runs. Latency percentiles,
 *      requests a second, errors. 429 is the rate limit doing its job and is counted apart.
 *   2. Runs: --runs runs of each target's plan started at once; their progress is watched until
 *      every one has ended (or --run-timeout). How long they waited and ran, how they ended, how
 *      many 429 queue_full, and the most seen in progress at once for each organization, which
 *      must not exceed --max-concurrent (the installation's ORG_MAX_CONCURRENT_RUNS).
 *
 * Exit codes: 0 within the thresholds, 1 a threshold was breached, 2 the test could not be run.
 */

export const EXIT_OK = 0;
export const EXIT_BREACHED = 1;
export const EXIT_TOOL_ERROR = 2;

export interface Target {
  key: string;
  planId: string;
}

export interface LoadOptions {
  baseUrl: string;
  targets: Target[];
  readers: number;
  readSeconds: number;
  runs: number;
  maxConcurrent: number;
  runTimeoutSeconds: number;
  pollSeconds: number;
  maxP95Ms: number;
  maxErrorRate: number;
  soakSeconds?: number;
  intervalSeconds?: number;
  requestTimeoutSeconds?: number;
  jsonPath?: string;
}

const DEFAULTS: Omit<LoadOptions, 'baseUrl' | 'targets'> = {
  readers: 10,
  readSeconds: 30,
  runs: 10,
  maxConcurrent: 2,
  runTimeoutSeconds: 600,
  pollSeconds: 2,
  maxP95Ms: 1000,
  maxErrorRate: 0,
  soakSeconds: 0,
  intervalSeconds: 30,
  requestTimeoutSeconds: 30,
};

/** What a run is in /api/v1, as far as this needs it. */
interface Run {
  id: string;
  status: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  failure: { code: string; message: string } | null;
}

const TERMINAL = new Set(['completed', 'failed', 'error', 'cancelled', 'timed_out']);

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): LoadOptions | { error: string } {
  const options: Partial<LoadOptions> & { targets: Target[] } = { ...DEFAULTS, targets: [] };
  const numbers: Record<string, keyof LoadOptions> = {
    '--soak-seconds': 'soakSeconds',
    '--interval-seconds': 'intervalSeconds',
    '--request-timeout': 'requestTimeoutSeconds',
    '--readers': 'readers',
    '--read-seconds': 'readSeconds',
    '--runs': 'runs',
    '--max-concurrent': 'maxConcurrent',
    '--run-timeout': 'runTimeoutSeconds',
    '--poll': 'pollSeconds',
    '--max-p95-ms': 'maxP95Ms',
    '--max-error-rate': 'maxErrorRate',
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--url') options.baseUrl = value;
    else if (flag === '--json') options.jsonPath = value;
    else if (flag === '--target') {
      const at = value?.lastIndexOf(':') ?? -1;
      if (at <= 0 || at === value.length - 1) return { error: `--target is <api key>:<plan id>, not "${value ?? ''}".` };
      options.targets.push({ key: value.slice(0, at), planId: value.slice(at + 1) });
    } else if (flag in numbers) {
      const n = Number(value);
      if (!value || value.trim() === '' || !Number.isFinite(n) || n < 0) return { error: `${flag} takes a number, not "${value ?? ''}".` };
      (options as Record<string, unknown>)[numbers[flag]] = n;
    } else return { error: `Unknown option ${flag}.` };
    i++;
  }
  options.baseUrl = (options.baseUrl ?? env.WFM_URL)?.replace(/\/+$/, '');
  if (!options.baseUrl) return { error: 'Name the installation: --url or WFM_URL.' };
  if (options.targets.length === 0) return { error: 'Name at least one --target <api key>:<plan id>.' };
  for (const field of ['readers', 'runs', 'maxConcurrent'] as const) {
    if (!Number.isSafeInteger(options[field])) return { error: `${field} must be an integer.` };
  }
  if (options.readers! < 1 || options.maxConcurrent! < 1 || options.pollSeconds! <= 0 || options.runTimeoutSeconds! <= 0 || options.intervalSeconds! <= 0 || options.requestTimeoutSeconds! <= 0) return { error: 'Readers, concurrency, poll, run timeout, interval and request timeout must be positive.' };
  if (options.maxErrorRate! > 1) return { error: '--max-error-rate is a fraction from 0 to 1.' };
  if (options.runs! > 100) return { error: '--runs is at most 100 per target.' };
  return options as LoadOptions;
}

// ─── Arithmetic ─────────────────────────────────────────────────────────────────

/** Nearest rank, as the API tests' performance check computes it: p95 of 20 values is the 19th. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export interface Sample {
  ms: number;
  /** 0 when the request could not be made. */
  status: number;
}

export interface ReadSummary {
  requests: number;
  /** Latency percentiles use a uniform reservoir of at most 10,000 requests. */
  latencySampleSize?: number;
  perSecond: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  slowest: number | null;
  /** HTTP errors (except 429) and requests that could not be made. */
  errors: number;
  errorRate: number;
  /** 429: the installation's rate limit. */
  limited: number;
}

export function summariseReads(samples: Sample[], seconds: number): ReadSummary {
  const answered = samples.filter((s) => s.status !== 429);
  const times = answered.filter((s) => s.status > 0).map((s) => s.ms);
  const errors = answered.filter((s) => s.status === 0 || s.status >= 400).length;
  return {
    requests: samples.length,
    perSecond: seconds > 0 ? Math.round((samples.length / seconds) * 10) / 10 : 0,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    slowest: times.length ? Math.max(...times) : null,
    errors,
    errorRate: answered.length ? errors / answered.length : 0,
    limited: samples.length - answered.length,
  };
}

export interface RunSummary {
  started: number;
  /** Requested run starts in this target/cycle. */
  requested?: number;
  /** Explicit 429 queue_quota_exceeded/queue_full: the organization's queue was full. */
  refused: number;
  /** Any other answer to starting a run. */
  startErrors: string[];
  statuses: Record<string, number>;
  /** Runs still not ended at --run-timeout. */
  unfinished: number;
  /** Accepted IDs never retrieved successfully before the run deadline. */
  missing?: number;
  waitP50: number | null;
  waitP95: number | null;
  durationP50: number | null;
  durationP95: number | null;
  /** The most of this target's runs in progress at once: from their start and end times, or as seen while polling. */
  maxRunning: number;
  /** When its first run started and its last ended, ms since the burst. */
  firstStartMs: number | null;
  lastEndMs: number | null;
}

const time = (value: string | null) => (value ? Date.parse(value) : NaN);

/**
 * The most runs in progress at once, from when each started and ended. Polling alone misses it:
 * runs shorter than the poll interval are never seen running. A run not ended counts until now.
 */
export function maxOverlap(runs: Array<Pick<Run, 'startedAt' | 'completedAt'>>, now = Date.now()): number {
  const events: Array<[number, number]> = [];
  for (const run of runs) {
    const start = time(run.startedAt);
    if (!Number.isFinite(start)) continue;
    const end = time(run.completedAt);
    events.push([start, 1], [Number.isFinite(end) ? end : now, -1]);
  }
  // At the same instant an end comes before a start: one run handing over to the next is not two at once.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let most = 0;
  for (const [, delta] of events) {
    current += delta;
    most = Math.max(most, current);
  }
  return most;
}

export function summariseRuns(runs: Run[], refused: number, startErrors: string[], maxRunning: number, burstAt: number): RunSummary {
  const statuses: Record<string, number> = {};
  for (const run of runs) statuses[run.status] = (statuses[run.status] ?? 0) + 1;
  const waits = runs.map((r) => time(r.startedAt) - time(r.queuedAt)).filter((n) => Number.isFinite(n) && n >= 0);
  const durations = runs
    .filter((r) => TERMINAL.has(r.status))
    .map((r) => r.durationMs ?? time(r.completedAt) - time(r.startedAt))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const starts = runs.map((r) => time(r.startedAt)).filter(Number.isFinite);
  const ends = runs.map((r) => time(r.completedAt)).filter(Number.isFinite);
  return {
    started: runs.length,
    refused,
    startErrors,
    statuses,
    unfinished: runs.filter((r) => !TERMINAL.has(r.status)).length,
    waitP50: percentile(waits, 50),
    waitP95: percentile(waits, 95),
    durationP50: percentile(durations, 50),
    durationP95: percentile(durations, 95),
    maxRunning: Math.max(maxRunning, maxOverlap(runs)),
    firstStartMs: starts.length ? Math.min(...starts) - burstAt : null,
    lastEndMs: ends.length ? Math.max(...ends) - burstAt : null,
  };
}

/** What breached a threshold, in words; empty when nothing did. */
export function breaches(reads: ReadSummary, runs: RunSummary[], options: Pick<LoadOptions, 'maxP95Ms' | 'maxErrorRate' | 'maxConcurrent'>): string[] {
  const found: string[] = [];
  if (reads.p95 !== null && reads.p95 > options.maxP95Ms) found.push(`reads: p95 ${reads.p95} ms > ${options.maxP95Ms} ms`);
  if (reads.errorRate > options.maxErrorRate) found.push(`reads: ${reads.errors} errors (${(reads.errorRate * 100).toFixed(1)}%)`);
  runs.forEach((run, index) => {
    const name = `target ${index + 1}`;
    if (run.maxRunning > options.maxConcurrent) found.push(`${name}: ${run.maxRunning} runs in progress at once > ${options.maxConcurrent}`);
    if ((run.requested ?? 0) > 0 && run.started === 0) found.push(`${name}: no runs accepted for requested workload`);
    if ((run.missing ?? 0) > 0) found.push(`${name}: ${run.missing} accepted runs never retrieved`);
    if (run.unfinished > 0) found.push(`${name}: ${run.unfinished} runs not ended in time`);
    const lost = Object.entries(run.statuses).filter(([status]) => status !== 'completed' && TERMINAL.has(status));
    for (const [status, count] of lost) found.push(`${name}: ${count} runs ended ${status}`);
    if (run.startErrors.length > 0) found.push(`${name}: ${run.startErrors.length} runs could not be started (${run.startErrors[0]})`);
  });
  return found;
}

// ─── Talking to the installation ────────────────────────────────────────────────

export interface LoadIo {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

const defaultIo: LoadIo = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (line) => console.log(line),
};

async function request<T>(io: LoadIo, url: string, init: RequestInit, timeoutSeconds: number, consume: (res: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('HTTP request deadline exceeded')); }, timeoutSeconds * 1000);
  });
  try {
    return await Promise.race([io.fetch(url, { ...init, signal: controller.signal }).then(consume), timeout]);
  } finally { clearTimeout(timer!); }
}

async function timed(io: LoadIo, url: string, init: RequestInit, timeoutSeconds: number): Promise<Sample & { retryAfter?: number }> {
  const start = io.now();
  try {
    return await request(io, url, init, timeoutSeconds, async res => {
      await res.text();
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      return { ms: io.now() - start, status: res.status, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}) };
    });
  } catch {
    return { ms: io.now() - start, status: 0 };
  }
}

const auth = (key: string) => ({ Authorization: `Bearer ${key}`, Accept: 'application/json' });

class ReadAccumulator {
  // Uniform reservoir: percentiles use at most 10,000 samples, counters cover every request.
  private samples: Sample[] = [];
  private requests = 0;
  private errors = 0;
  private limited = 0;
  private slowest: number | null = null;
  add(sample: Sample) {
    this.requests++;
    if (sample.status === 429) this.limited++;
    else if (sample.status === 0 || sample.status >= 400) this.errors++;
    if (sample.status > 0 && sample.status !== 429) this.slowest = Math.max(this.slowest ?? 0, sample.ms);
    if (this.samples.length < 10000) this.samples.push(sample);
    else { const slot = Math.floor(Math.random() * this.requests); if (slot < 10000) this.samples[slot] = sample; }
  }
  summary(seconds: number): ReadSummary {
    return { ...summariseReads(this.samples, seconds), requests: this.requests, latencySampleSize: this.samples.length,
      perSecond: seconds > 0 ? Math.round(this.requests / seconds * 10) / 10 : 0,
      errors: this.errors, limited: this.limited, slowest: this.slowest,
      errorRate: this.requests > this.limited ? this.errors / (this.requests - this.limited) : 0 };
  }
}

async function readPhase(options: LoadOptions, io: LoadIo, stopped: () => boolean = () => false, aggregate?: ReadAccumulator): Promise<ReadSummary> {
  const samples = new ReadAccumulator();
  const deadline = io.now() + options.readSeconds * 1000;
  const paths = ['/api/v1/plans?limit=20', '/api/v1/runs?limit=20'];
  let turn = 0;
  const reader = async () => {
    while (io.now() < deadline && !stopped()) {
      const target = options.targets[turn % options.targets.length];
      const path = paths[turn++ % paths.length];
      const sample = await timed(io, `${options.baseUrl}${path}`, { headers: auth(target.key) }, options.requestTimeoutSeconds ?? 30);
      samples.add(sample);
      aggregate?.add(sample);
      // A limited client waits as told, as a well-behaved pipeline does.
      if (sample.status === 429) await io.sleep(Math.min(sample.retryAfter ?? 1, 10) * 1000);
    }
  };
  const started = io.now();
  await Promise.all(Array.from({ length: Math.max(1, options.readers) }, reader));
  return samples.summary((io.now() - started) / 1000);
}

async function runPhase(options: LoadOptions, io: LoadIo, invocation: string, cycle = 0, seenIds = new Set<string>()): Promise<RunSummary[]> {
  const burstAt = io.now();
  const started = await Promise.all(
    options.targets.map(async (target, t) => {
      const ids: string[] = [];
      let refused = 0;
      const errors: string[] = [];
      await Promise.all(
        Array.from({ length: options.runs }, async (_, i) => {
          try {
            const answer = await request(io, `${options.baseUrl}/api/v1/plans/${encodeURIComponent(target.planId)}/runs`, {
              method: 'POST',
              headers: { ...auth(target.key), 'Content-Type': 'application/json', 'Idempotency-Key': `wfm-load-${invocation}-${cycle}-${t}-${i}` },
              body: '{}',
            }, options.requestTimeoutSeconds ?? 30, async res => ({ status: res.status, body: await res.json().catch(() => ({})) }));
            const res = answer;
            const body = answer.body as { id?: string; error?: { code?: string; message?: string } };
            if (res.status === 202 && typeof body.id === 'string' && body.id) {
              if (seenIds.has(body.id)) errors.push(`duplicate returned run ID ${body.id}`);
              else { seenIds.add(body.id); ids.push(body.id); }
            }
            else if (res.status === 429 && ['queue_quota_exceeded', 'queue_full'].includes(body.error?.code ?? 'unknown_error')) refused++;
            else errors.push(`${res.status} ${body.error?.code ?? 'unknown_error'}`.trim());
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }),
      );
      return { ids: new Set(ids), refused, errors };
    }),
  );
  io.log(`Runs started: ${started.map((s, t) => `target ${t + 1} ${s.ids.size}${s.refused ? ` (+${s.refused} refused)` : ''}`).join(', ')}`);

  const latest = started.map(() => new Map<string, Run>());
  const maxRunning = started.map(() => 0);
  const deadline = burstAt + options.runTimeoutSeconds * 1000;
  while (true) {
    await Promise.all(
      options.targets.map(async (target, t) => {
        if (started[t].ids.size === 0) return;
        await Promise.all([...started[t].ids].map(async id => {
          if (TERMINAL.has(latest[t].get(id)?.status ?? '')) return;
          try {
            const answer = await request(io, `${options.baseUrl}/api/v1/runs/${encodeURIComponent(id)}`, { headers: auth(target.key) }, options.requestTimeoutSeconds ?? 30,
              async res => ({ ok: res.ok, body: await res.json() }));
            if (answer.ok && answer.body?.id === id) latest[t].set(id, answer.body as Run);
          } catch { /* Retry until the run deadline; missing runs remain unfinished. */ }
        }));
        const running = [...latest[t].values()].filter(r => r.status === 'running' || r.status === 'cancelling').length;
        maxRunning[t] = Math.max(maxRunning[t], running);
      }),
    );
    const open = latest.reduce((sum, runs, t) => sum + started[t].ids.size - [...runs.values()].filter((r) => TERMINAL.has(r.status)).length, 0);
    if (open === 0 || io.now() >= deadline) break;
    await io.sleep(Math.min(options.pollSeconds * 1000, Math.max(0, deadline - io.now())));
  }
  return started.map((s, t) => {
    // A run never retrieved individually is reported as still queued: it did not end where anyone could see.
    const runs = [...s.ids].map((id) => latest[t].get(id) ?? { id, status: 'queued', queuedAt: null, startedAt: null, completedAt: null, durationMs: null, failure: null });
    return { ...summariseRuns(runs, s.refused, s.errors, maxRunning[t], burstAt), missing: s.ids.size - latest[t].size, requested: options.runs };
  });
}

const ms = (value: number | null) => (value === null ? '—' : `${value} ms`);
const seconds = (value: number | null) => (value === null ? '—' : `${(value / 1000).toFixed(1)} s`);

export function report(reads: ReadSummary, runs: RunSummary[], found: string[]): string {
  const lines = [
    '',
    'Reads',
    `  ${reads.requests} requests, ${reads.perSecond}/s · p50 ${ms(reads.p50)} · p95 ${ms(reads.p95)} · p99 ${ms(reads.p99)} · slowest ${ms(reads.slowest)}`,
    `  errors ${reads.errors} (${(reads.errorRate * 100).toFixed(1)}%) · limited (429) ${reads.limited}`,
    '',
    'Runs',
    ...runs.flatMap((run, index) => [
      `  target ${index + 1}: ${run.started} started${run.refused ? `, ${run.refused} refused (queue full)` : ''} · ${Object.entries(run.statuses).map(([s, n]) => `${n} ${s}`).join(', ') || 'none'}`,
      `    waited p50 ${seconds(run.waitP50)}, p95 ${seconds(run.waitP95)} · ran p50 ${seconds(run.durationP50)}, p95 ${seconds(run.durationP95)} · at most ${run.maxRunning} in progress · first start ${seconds(run.firstStartMs)}, last end ${seconds(run.lastEndMs)}`,
    ]),
    '',
    found.length === 0 ? 'Within the thresholds.' : `Breached:\n${found.map((f) => `  ✗ ${f}`).join('\n')}`,
  ];
  return lines.join('\n');
}

export interface LoadCycle {
  cycle: number;
  startedAt: string;
  elapsedSeconds: number;
  reads: ReadSummary;
  runs: RunSummary[];
  breaches: string[];
}

export async function runLoad(options: LoadOptions, io: LoadIo = defaultIo): Promise<{ code: number; reads: ReadSummary; runs: RunSummary[]; breaches: string[]; cycles?: LoadCycle[] }> {
  const invocation = randomUUID();
  if ((options.soakSeconds ?? 0) > 0) {
    const start = io.now();
    const deadline = start + options.soakSeconds! * 1000;
    const cycles: LoadCycle[] = [];
    const allReads = new ReadAccumulator();
    const seenIds = new Set<string>();
    while (io.now() < deadline) {
      const cycleStart = io.now();
      let stopped = false;
      const cycle = cycles.length + 1;
      const runsPromise = (async () => {
        try {
          const runs = await runPhase(options, io, invocation, cycle, seenIds);
          const pause = Math.min(deadline, cycleStart + (options.intervalSeconds ?? 30) * 1000) - io.now();
          if (pause > 0) await io.sleep(pause);
          return runs;
        } finally { stopped = true; }
      })();
      const [runs, reads] = await Promise.all([runsPromise,
        readPhase({ ...options, readSeconds: Math.max(0, (deadline - io.now()) / 1000) }, io, () => stopped, allReads)]);
      const found = breaches(reads, runs, options);
      const metrics = { cycle, startedAt: new Date(cycleStart).toISOString(), elapsedSeconds: (io.now() - cycleStart) / 1000, reads, runs, breaches: found };
      cycles.push(metrics);
      io.log(JSON.stringify(metrics));
    }
    const reads = allReads.summary((io.now() - start) / 1000);
    const found = cycles.flatMap(c => c.breaches.map(b => `cycle ${c.cycle}: ${b}`));
    // The complete per-cycle run metrics are in cycles; retain the final cycle for burst consumers.
    const runs = cycles.at(-1)?.runs ?? [];
    io.log(`Soak: ${cycles.length} cycles, ${(io.now() - start) / 1000} s, ${found.length} breaches`);
    return { code: found.length ? EXIT_BREACHED : EXIT_OK, reads, runs, breaches: found, cycles };
  }
  io.log(`Reads: ${options.readers} clients for ${options.readSeconds} s against ${options.baseUrl}`);
  const reads = await readPhase(options, io);
  io.log(`Runs: ${options.runs} at once for each of ${options.targets.length} target(s)`);
  const runs = await runPhase(options, io, invocation);
  const found = breaches(reads, runs, options);
  io.log(report(reads, runs, found));
  return { code: found.length === 0 ? EXIT_OK : EXIT_BREACHED, reads, runs, breaches: found };
}

export async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if ('error' in options) {
    console.error(`${options.error}\nUsage: wfm-load --url <installation> --target <api key>:<plan id> [--target …] [--readers 10] [--read-seconds 30] [--runs 10] [--max-concurrent 2] [--run-timeout 600] [--max-p95-ms 1000] [--max-error-rate 0] [--soak-seconds 3600] [--interval-seconds 30] [--request-timeout 30] [--json report.json]`);
    return EXIT_TOOL_ERROR;
  }
  try {
    const result = await runLoad(options);
    if (options.jsonPath) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(options.jsonPath, JSON.stringify({ at: new Date().toISOString(), baseUrl: options.baseUrl, reads: result.reads, runs: result.runs, breaches: result.breaches, cycles: result.cycles }, null, 2));
    }
    return result.code;
  } catch (error) {
    console.error(`The load test could not be run: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_TOOL_ERROR;
  }
}

if (process.argv[1] && /wfm-load(\.m?[tj]s)?$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
