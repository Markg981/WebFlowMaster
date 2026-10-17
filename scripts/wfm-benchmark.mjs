import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localDir } from './local-dir.mjs';

/**
 * Growth to ten times, measured with the tools already here: a thin adapter over the main(argv)
 * of scripts/wfm-load.ts (the installation under API traffic and run bursts) and
 * scripts/wfm-volume.ts (the run tables after months of history, EXPLAIN (ANALYZE, BUFFERS)). It
 * adds no load engine of its own: it builds their arguments from an approved profile, scrapes the
 * worker's metrics around them, prices what was used and gives one verdict.
 *
 *   WFM_BENCHMARK_CONFIG=bench.json node --import tsx scripts/wfm-benchmark.mjs --profile baseline
 *
 * Profiles change one axis each, by ten: baseline, tenfold-tests (plans and tests: N -> 10N),
 * tenfold-readers (API clients: U -> 10U), tenfold-runs (run starts and run history: R -> 10R),
 * and tenfold-combined only when the configuration names an agreed combination.
 *
 * The configuration names the installation, the scratch database, the approved SLO and the rates;
 * credentials stay in WFM_BENCHMARK_* variables. Both tools run in this process, so no key or
 * DSN is put in the arguments of an operating-system process, and what they print is redacted.
 * Missing configuration, an unknown profile, a production environment, a literal secret in the
 * file or the application's own DSN are refused: there is no default towards the installation
 * in use.
 *
 * Exit codes: 0 within the approved SLO, 1 a threshold was breached, 2 refused or not run.
 */

export const EXIT_OK = 0;
export const EXIT_BREACHED = 1;
export const EXIT_TOOL_ERROR = 2;
export const FACTOR = 10;
export const SCHEMA = 'wfm-benchmark/1';

/** The axis each profile multiplies; baseline multiplies none. */
export const PROFILES = {
  baseline: [],
  'tenfold-tests': ['definitions'],
  'tenfold-readers': ['readers'],
  'tenfold-runs': ['runs'],
  'tenfold-combined': null, // the axes of config.combination, when agreed
};

const CREDENTIAL_ENV = /^WFM_BENCHMARK_[A-Z0-9_]+$/;
const LITERAL_SECRETS = /^(key|apikey|token|password|secret|databaseurl|dsn|connectionstring)$/i;
const PRODUCTION = /\bprod(uction)?\b/i;
const HOURS_A_MONTH = 730;
const GB = 1e9;

// ─── Configuration ──────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--profile') options.profile = value;
    else if (flag === '--out') options.out = value;
    else return { error: `Unknown option ${flag}.` };
    if (!value || value.startsWith('--')) return { error: `${flag} takes a value.` };
    i++;
  }
  if (!options.profile)
    return { error: `Name a profile: --profile ${Object.keys(PROFILES).join(' | ')}.` };
  return options;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const fraction = (value) => typeof value === 'number' && value >= 0 && value <= 1;

/** Paths of keys that look like a credential written into the file instead of named by variable. */
function literalSecrets(value, at = '') {
  if (Array.isArray(value)) return value.flatMap((item, i) => literalSecrets(item, `${at}[${i}]`));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(LITERAL_SECRETS.test(key) ? [`${at}${at ? '.' : ''}${key}`] : []),
    ...literalSecrets(item, `${at}${at ? '.' : ''}${key}`),
  ]);
}

const origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * Reads WFM_BENCHMARK_CONFIG and checks it against the profile. Returns the configuration with
 * its credentials resolved, or the first reason it is refused. Credentials are never echoed.
 */
export function loadConfig(
  profile,
  env = process.env,
  read = (file) => readFileSync(file, 'utf8'),
) {
  if (!(profile in PROFILES))
    return { error: `Unknown profile "${profile}": ${Object.keys(PROFILES).join(', ')}.` };
  const file = env.WFM_BENCHMARK_CONFIG;
  if (!file)
    return { error: 'Set WFM_BENCHMARK_CONFIG to the approved benchmark configuration file.' };
  let config;
  try {
    config = JSON.parse(read(file));
  } catch (error) {
    return { error: `WFM_BENCHMARK_CONFIG could not be read as JSON: ${error.message}` };
  }
  if (!isObject(config)) return { error: 'The benchmark configuration is not a JSON object.' };
  const secrets = literalSecrets(config);
  if (secrets.length)
    return {
      error: `Credentials belong in WFM_BENCHMARK_* variables, not in the file: ${secrets.join(', ')}.`,
    };

  const { environment, target, volume, baseline, slo } = config;
  if (!isObject(environment) || typeof environment.name !== 'string' || !environment.name)
    return { error: 'environment.name is required.' };
  if (environment.production !== false || PRODUCTION.test(environment.name))
    return {
      error:
        'A benchmark never runs against production: declare environment.production false on a dedicated installation.',
    };
  for (const field of ['version', 'browser'])
    if (typeof environment[field] !== 'string' || !environment[field])
      return { error: `environment.${field} is required.` };
  for (const field of ['hardware', 'concurrency', 'steps', 'artifacts'])
    if (!isObject(environment[field]) || Object.keys(environment[field]).length === 0)
      return {
        error: `environment.${field} is required: record what the numbers were measured on.`,
      };
  if (
    !isObject(environment.mix) ||
    !fraction(environment.mix.web) ||
    !fraction(environment.mix.api) ||
    Math.abs(environment.mix.web + environment.mix.api - 1) > 1e-9
  )
    return { error: 'environment.mix is { web, api }, two fractions adding up to 1.' };

  if (!isObject(target) || !/^https?:\/\//.test(target.url ?? ''))
    return { error: 'target.url is the dedicated installation, http(s)://….' };
  for (const name of ['WFM_URL', 'WEBFLOW_PUBLIC_URL'])
    if (env[name] && origin(env[name]) === origin(target.url))
      return {
        error: `target.url is the installation in use (${name}); point it at a dedicated one.`,
      };
  if (!Array.isArray(target.targets) || target.targets.length === 0)
    return { error: 'target.targets lists at least one { keyEnv, planId }.' };
  if (!positiveInteger(target.maxConcurrent))
    return { error: "target.maxConcurrent is the installation's ORG_MAX_CONCURRENT_RUNS." };
  if (target.metrics !== undefined && !Array.isArray(target.metrics))
    return { error: 'target.metrics lists { name, url, tokenEnv } endpoints.' };

  const credentials = [];
  const resolve = (where, name) => {
    if (typeof name !== 'string' || !CREDENTIAL_ENV.test(name))
      return { error: `${where} names a dedicated variable WFM_BENCHMARK_…, not "${name ?? ''}".` };
    const value = env[name];
    if (!value) return { error: `${name} (${where}) is not set.` };
    credentials.push(value);
    return { value };
  };
  const targets = [];
  for (const [i, t] of target.targets.entries()) {
    if (!isObject(t) || typeof t.planId !== 'string' || !t.planId)
      return { error: `target.targets[${i}].planId is required.` };
    const key = resolve(`target.targets[${i}].keyEnv`, t.keyEnv);
    if (key.error) return key;
    targets.push({ key: key.value, planId: t.planId });
  }
  const metrics = [];
  for (const [i, m] of (target.metrics ?? []).entries()) {
    if (!isObject(m) || !/^https?:\/\//.test(m.url ?? ''))
      return { error: `target.metrics[${i}].url is required.` };
    const token = resolve(`target.metrics[${i}].tokenEnv`, m.tokenEnv);
    if (token.error) return token;
    metrics.push({ name: m.name ?? `endpoint ${i + 1}`, url: m.url, token: token.value });
  }

  if (!isObject(volume)) return { error: 'volume.databaseUrlEnv names the scratch database.' };
  const dsn = resolve('volume.databaseUrlEnv', volume.databaseUrlEnv);
  if (dsn.error) return dsn;
  const inherited = Object.entries(env).find(
    ([name, value]) =>
      !CREDENTIAL_ENV.test(name) && /DATABASE_URL$/.test(name) && value === dsn.value,
  );
  if (inherited)
    return {
      error: `The scratch database is the application's own (${inherited[0]}): use a dedicated one.`,
    };

  if (!isObject(baseline))
    return { error: 'baseline is required: the N, U and R the profiles multiply.' };
  for (const field of [
    'plans',
    'tests',
    'readers',
    'runs',
    'readSeconds',
    'months',
    'runsPerDay',
    'orgs',
  ])
    if (!positiveInteger(baseline[field]))
      return { error: `baseline.${field} must be a positive integer.` };

  if (
    !isObject(slo) ||
    typeof slo.approvedBy !== 'string' ||
    !slo.approvedBy ||
    typeof slo.approvedAt !== 'string'
  )
    return {
      error: 'slo needs approvedBy and approvedAt: thresholds nobody approved are not a verdict.',
    };
  for (const field of ['maxP95Ms', 'maxQueueWaitP95Ms', 'maxQueryMs', 'maxSeqScanRows'])
    if (!positive(slo[field])) return { error: `slo.${field} must be a positive number.` };
  if (!fraction(slo.maxErrorRate)) return { error: 'slo.maxErrorRate is a fraction from 0 to 1.' };

  let axes = PROFILES[profile];
  if (axes === null) {
    const combination = config.combination;
    if (
      !isObject(combination) ||
      !Array.isArray(combination.axes) ||
      combination.axes.length < 2 ||
      !combination.axes.every((a) => ['definitions', 'readers', 'runs'].includes(a)) ||
      typeof combination.agreedBy !== 'string' ||
      !combination.agreedBy
    )
      return {
        error:
          'tenfold-combined needs combination { axes: [two or more of definitions, readers, runs], agreedBy }.',
      };
    axes = [...new Set(combination.axes)];
  }
  if (axes.includes('runs') && baseline.runs * FACTOR > 100)
    return {
      error: `tenfold-runs starts ${baseline.runs * FACTOR} runs per target; wfm-load takes at most 100: lower baseline.runs or add targets.`,
    };

  return { config, profile, axes, targets, metrics, databaseUrl: dsn.value, credentials };
}

/** The workload of a profile: baseline numbers, with only its axes multiplied. */
export function workload(baseline, axes) {
  const times = (axis) => (axes.includes(axis) ? FACTOR : 1);
  return {
    plans: baseline.plans * times('definitions'),
    tests: baseline.tests * times('definitions'),
    readers: baseline.readers * times('readers'),
    runs: baseline.runs * times('runs'),
    runsPerDay: baseline.runsPerDay * times('runs'),
    readSeconds: baseline.readSeconds,
    months: baseline.months,
    orgs: baseline.orgs,
    resultsPerRun: baseline.resultsPerRun ?? 20,
    logsPerRun: baseline.logsPerRun ?? 40,
    repeat: baseline.repeat ?? 5,
    runTimeoutSeconds: baseline.runTimeoutSeconds ?? 600,
    requestTimeoutSeconds: baseline.requestTimeoutSeconds ?? 30,
  };
}

export function loadArgv(resolved, work, jsonPath) {
  const { config, targets } = resolved;
  return [
    '--url',
    config.target.url,
    ...targets.flatMap((t) => ['--target', `${t.key}:${t.planId}`]),
    '--readers',
    String(work.readers),
    '--read-seconds',
    String(work.readSeconds),
    '--runs',
    String(work.runs),
    '--max-concurrent',
    String(config.target.maxConcurrent),
    '--run-timeout',
    String(work.runTimeoutSeconds),
    '--request-timeout',
    String(work.requestTimeoutSeconds),
    '--max-p95-ms',
    String(config.slo.maxP95Ms),
    '--max-error-rate',
    String(config.slo.maxErrorRate),
    '--json',
    jsonPath,
  ];
}

export function volumeArgv(resolved, work, jsonPath) {
  return [
    '--database-url',
    resolved.databaseUrl,
    '--reset',
    '--months',
    String(work.months),
    '--runs-per-day',
    String(work.runsPerDay),
    '--orgs',
    String(work.orgs),
    '--plans',
    String(work.plans),
    '--tests',
    String(work.tests),
    '--results-per-run',
    String(work.resultsPerRun),
    '--logs-per-run',
    String(work.logsPerRun),
    '--repeat',
    String(work.repeat),
    '--max-ms',
    String(resolved.config.slo.maxQueryMs),
    '--seq-scan-rows',
    String(resolved.config.slo.maxSeqScanRows),
    '--json',
    jsonPath,
  ];
}

/** Replaces every credential, and the password of any DSN, wherever it appears. */
export function redactor(credentials) {
  const known = credentials.filter((c) => c.length >= 4).sort((a, b) => b.length - a.length);
  return (text) => {
    let out = String(text);
    for (const secret of known) out = out.split(secret).join('[redacted]');
    return out.replace(/(\w+:\/\/[^:/@\s]+:)[^@\s]+@/g, '$1[redacted]@');
  };
}

// ─── Metrics ────────────────────────────────────────────────────────────────────

export function parseMetrics(text) {
  const samples = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)/.exec(line);
    if (!match) continue;
    const labels = {};
    for (const [, name, value] of (match[2] ?? '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g))
      labels[name] = value;
    samples.push({ name: match[1], labels, value: Number(match[3]) });
  }
  return samples;
}

const matches = (sample, name, where) =>
  sample.name === name && Object.entries(where).every(([k, v]) => sample.labels[k] === v);

/** The sum of a metric's samples, or null when the endpoint does not expose it. */
export function total(samples, name, where = {}) {
  const found = samples.filter((s) => matches(s, name, where));
  return found.length ? found.reduce((sum, s) => sum + s.value, 0) : null;
}

/**
 * A quantile of what a histogram recorded between two scrapes, as the upper bound of its bucket:
 * an estimate no finer than the buckets. Null when nothing was recorded.
 */
export function histogramQuantile(before, after, name, where, q) {
  const counts = new Map();
  for (const [samples, sign] of [
    [after, 1],
    [before, -1],
  ])
    for (const s of samples)
      if (matches(s, `${name}_bucket`, where))
        counts.set(s.labels.le, (counts.get(s.labels.le) ?? 0) + sign * s.value);
  const count = counts.get('+Inf') ?? 0;
  if (count <= 0) return null;
  const bounds = [...counts.keys()]
    .filter((le) => le !== '+Inf')
    .map(Number)
    .sort((a, b) => a - b);
  for (const bound of bounds)
    if ((counts.get(String(bound)) ?? 0) >= q * count)
      return { upperBoundMs: bound * 1000, overflow: false };
  return { upperBoundMs: (bounds.at(-1) ?? 0) * 1000, overflow: true };
}

async function scrape(io, endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await io.fetch(endpoint.url, {
      headers: { Authorization: `Bearer ${endpoint.token}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return parseMetrics(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Scrapes every endpoint until stopped: first and last scrape for deltas, every one for peaks. */
export function sampler(io, endpoints, everyMs) {
  const series = endpoints.map(() => []);
  let unreachable = 0;
  let stopped = false;
  const round = async () => {
    const at = io.now();
    const scraped = await Promise.all(endpoints.map((e) => scrape(io, e)));
    scraped.forEach((samples, i) => (samples ? series[i].push({ at, samples }) : unreachable++));
  };
  const loop = (async () => {
    await round();
    while (!stopped) {
      await io.sleep(everyMs);
      if (!stopped) await round();
    }
  })();
  return {
    async stop() {
      stopped = true;
      await loop;
      await round();
      return { series, unreachable };
    },
  };
}

/** What the processes behind the endpoints used while the profile ran. */
export function summariseProcesses(endpoints, { series, unreachable }) {
  const delta = (name, where = {}) => {
    let sum = null;
    for (const points of series) {
      if (points.length < 2) continue;
      const first = total(points[0].samples, name, where);
      const last = total(points.at(-1).samples, name, where);
      if (first !== null && last !== null) sum = (sum ?? 0) + Math.max(0, last - first);
    }
    return sum;
  };
  const peak = (name, where = {}) => {
    let most = null;
    for (const points of series)
      for (const point of points) {
        const value = total(point.samples, name, where);
        if (value !== null) most = Math.max(most ?? 0, value);
      }
    return most;
  };
  // A process start time that changed is a restart: under pressure, likely out of memory.
  const restarts = series.reduce((sum, points) => {
    const starts = points
      .map((p) => total(p.samples, 'wfm_process_start_time_seconds'))
      .filter((v) => v !== null);
    return sum + starts.filter((v, i) => i > 0 && v !== starts[i - 1]).length;
  }, 0);
  const first = series.map((points) => points[0]?.samples ?? []).flat();
  const last = series.map((points) => points.at(-1)?.samples ?? []).flat();
  return {
    endpoints: endpoints.map((e, i) => ({ name: e.name, scrapes: series[i].length })),
    unreachableScrapes: unreachable,
    restarts,
    peakResidentBytes: peak('wfm_process_resident_memory_bytes'),
    peakBrowserResidentBytes: peak('wfm_worker_child_resident_bytes'),
    peakBrowserProcesses: peak('wfm_worker_child_processes'),
    cpuSeconds: delta('wfm_process_cpu_seconds_total'),
    browserCpuSeconds: delta('wfm_worker_child_cpu_seconds'),
    artifactBytes: delta('wfm_artifact_bytes_written_total'),
    peakQueueWaiting: peak('wfm_queue_jobs', { queue: 'test-execution-queue', state: 'waiting' }),
    workerErrors: delta('wfm_jobs_total', { queue: 'test-execution-queue', outcome: 'error' }),
    planWaitP95: histogramQuantile(
      first,
      last,
      'wfm_job_wait_seconds',
      { queue: 'test-execution-queue', job: 'execute-plan' },
      0.95,
    ),
  };
}

// ─── Arithmetic ─────────────────────────────────────────────────────────────────

const max = (values) => {
  const known = values.filter((v) => typeof v === 'number');
  return known.length ? Math.max(...known) : null;
};
const min = (values) => {
  const known = values.filter((v) => typeof v === 'number');
  return known.length ? Math.min(...known) : null;
};
const ratio = (a, b) => (typeof a === 'number' && typeof b === 'number' && b > 0 ? a / b : null);
const round = (value, digits = 6) =>
  typeof value === 'number' ? Math.round(value * 10 ** digits) / 10 ** digits : value;

/** What wfm-load saw of the runs, across targets: admitted, refused, ended, waited. */
export function summariseRunLoad(load) {
  const runs = load.runs ?? [];
  const statuses = {};
  for (const run of runs)
    for (const [status, n] of Object.entries(run.statuses ?? {}))
      statuses[status] = (statuses[status] ?? 0) + n;
  const admitted = runs.reduce((sum, r) => sum + r.started, 0);
  const successful = statuses.completed ?? 0;
  const windowMs = max(runs.map((r) => r.lastEndMs));
  return {
    requested: runs.reduce((sum, r) => sum + (r.requested ?? 0), 0),
    admitted,
    refused429: runs.reduce((sum, r) => sum + r.refused, 0),
    successful,
    failed: admitted - successful - runs.reduce((sum, r) => sum + r.unfinished, 0),
    unfinished: runs.reduce((sum, r) => sum + r.unfinished, 0),
    missing: runs.reduce((sum, r) => sum + (r.missing ?? 0), 0),
    statuses,
    queueWaitP50Ms: max(runs.map((r) => r.waitP50)),
    queueWaitP95Ms: max(runs.map((r) => r.waitP95)),
    durationP50Ms: max(runs.map((r) => r.durationP50)),
    durationP95Ms: max(runs.map((r) => r.durationP95)),
    timeToFirstFailureMs: min(runs.map((r) => r.firstFailureMs)),
    maxRunning: max(runs.map((r) => r.maxRunning)),
    windowSeconds: windowMs === null ? null : windowMs / 1000,
    successfulPerHour: windowMs ? round((successful / windowMs) * 3_600_000, 2) : null,
  };
}

/** Database bytes per run of history: the run tables' size over the runs generated. */
export function databaseBytesPerRun(volume) {
  const runs = volume.sizes?.find((s) => s.table === 'test_plan_executions')?.rows;
  const bytes = (volume.sizes ?? []).reduce((sum, s) => sum + s.tableBytes + s.indexBytes, 0);
  return runs > 0 ? round(bytes / runs, 0) : null;
}

/**
 * Runtime cost from measured usage and the rates given. Every rate it needs and does not have is
 * named in `missing` and leaves the totals null, never zero: the economic gate is then still to be
 * validated. Failed attempts are priced like successful ones, and the capacity provisioned is
 * priced for the whole window, used or not.
 */
export function priceRuns(cost = {}, usage) {
  const rates = { ...(cost.rates ?? {}) };
  const missing = [];
  const need = (name, value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) missing.push(name);
  };
  need('rates.infrastructurePerHour', rates.infrastructurePerHour);
  need('rates.storagePerGbMonth', rates.storagePerGbMonth);
  need('rates.trafficPerGb', rates.trafficPerGb);
  const aiUsed = cost.ai?.used === true;
  if (aiUsed) need('rates.aiPerRun', rates.aiPerRun);
  need('retentionDays', cost.retentionDays);
  need('trafficBytesPerArtifactByte', cost.trafficBytesPerArtifactByte);
  need('monthlyRuns', cost.monthlyRuns);
  need('peakFactor', cost.peakFactor);
  if (typeof cost.currency !== 'string' || !cost.currency) missing.push('currency');
  if (typeof cost.rateSource !== 'string' || !cost.rateSource) missing.push('rateSource');
  if (cost.basis === 'on-prem' && !cost.amortisation) missing.push('amortisation');
  if (!['tariff', 'on-prem'].includes(cost.basis)) missing.push('basis');
  for (const [name, value] of Object.entries({
    'usage.admittedRuns': usage.admittedRuns || null,
    'usage.runWindowSeconds': usage.runWindowSeconds,
    'usage.artifactBytes': usage.artifactBytes,
    'usage.databaseBytesPerRun': usage.databaseBytesPerRun,
    'usage.successfulPerHour': usage.successfulPerHour || null,
  }))
    if (value === null || value === undefined) missing.push(name);

  const assumptions = [
    ...(cost.assumptions ?? []),
    'Storage is held for retentionDays, priced per GB-month (30 days).',
    'Traffic is estimated as artifact bytes × trafficBytesPerArtifactByte: not measured.',
    'Monthly capacity is units of the measured environment, enough for monthlyRuns at peakFactor.',
  ];
  const result = {
    basis: cost.basis ?? null,
    currency: cost.currency ?? null,
    rateSource: cost.rateSource ?? null,
    amortisation: cost.amortisation ?? null,
    rates: {
      infrastructurePerHour: rates.infrastructurePerHour ?? null,
      storagePerGbMonth: rates.storagePerGbMonth ?? null,
      trafficPerGb: rates.trafficPerGb ?? null,
      aiPerRun: aiUsed ? (rates.aiPerRun ?? null) : 0,
    },
    usage: { ...usage, aiUsed, trafficBytes: null },
    assumptions,
    exclusions: [
      ...(cost.exclusions ?? []),
      ...(aiUsed ? [] : ['AI: not used by the benchmarked plans.']),
      'Human maintenance time: measured in the pilot, reported apart under maintenance.',
    ],
    missing,
    costPerRun: null,
    costPerSuccessfulRun: null,
    monthlyCostBaseline: null,
    monthlyCost10x: null,
    capacityUnitsBaseline: null,
    capacityUnits10x: null,
    gate: 'unvalidated',
    maintenance: {
      humanHoursPerMonth: cost.maintenance?.humanHoursPerMonth ?? null,
      source: cost.maintenance?.source ?? null,
      note: 'Not runtime cost: tracked separately from the pilot.',
    },
  };
  if (missing.length) return result;

  const trafficBytes = usage.artifactBytes * cost.trafficBytesPerArtifactByte;
  const storedBytes = usage.artifactBytes + usage.databaseBytesPerRun * usage.admittedRuns;
  const variable =
    (storedBytes / GB) * rates.storagePerGbMonth * (cost.retentionDays / 30) +
    (trafficBytes / GB) * rates.trafficPerGb +
    (aiUsed ? rates.aiPerRun * usage.admittedRuns : 0);
  const capacity = rates.infrastructurePerHour * (usage.runWindowSeconds / 3600);
  const variablePerRun = variable / usage.admittedRuns;
  const units = (runs) =>
    Math.max(1, Math.ceil(((runs / HOURS_A_MONTH) * cost.peakFactor) / usage.successfulPerHour));
  const monthly = (runs) =>
    units(runs) * rates.infrastructurePerHour * HOURS_A_MONTH + variablePerRun * runs;
  return {
    ...result,
    usage: { ...result.usage, trafficBytes: round(trafficBytes, 0) },
    costPerRun: round((capacity + variable) / usage.admittedRuns),
    costPerSuccessfulRun:
      usage.successfulRuns > 0 ? round((capacity + variable) / usage.successfulRuns) : null,
    monthlyCostBaseline: round(monthly(cost.monthlyRuns), 2),
    monthlyCost10x: round(monthly(cost.monthlyRuns * FACTOR), 2),
    capacityUnitsBaseline: units(cost.monthlyRuns),
    capacityUnits10x: units(cost.monthlyRuns * FACTOR),
    gate: usage.successfulRuns > 0 ? 'computed' : 'unvalidated',
  };
}

/** Everything that fails the profile. A breach is a result: it is reported, never left out. */
export function verdict(slo, report) {
  const found = [...report.sources.loadBreaches, ...report.sources.volumeBreaches];
  const runs = report.measured.runs;
  const processes = report.measured.processes;
  if (runs.queueWaitP95Ms !== null && runs.queueWaitP95Ms > slo.maxQueueWaitP95Ms)
    found.push(`queue wait p95 ${runs.queueWaitP95Ms} ms > ${slo.maxQueueWaitP95Ms} ms`);
  if (
    positive(slo.maxRunP95Ms) &&
    runs.durationP95Ms !== null &&
    runs.durationP95Ms > slo.maxRunP95Ms
  )
    found.push(`run duration p95 ${runs.durationP95Ms} ms > ${slo.maxRunP95Ms} ms`);
  if (
    positive(slo.max429Rate) &&
    runs.requested > 0 &&
    runs.refused429 / runs.requested > slo.max429Rate
  )
    found.push(
      `${runs.refused429} of ${runs.requested} run starts refused (429) > ${slo.max429Rate}`,
    );
  if (processes.restarts > 0)
    found.push(
      `${processes.restarts} process restart(s) during the profile: pressure must queue or refuse, not crash`,
    );
  if (
    positive(slo.maxBrowserResidentBytes) &&
    (processes.peakBrowserResidentBytes ?? 0) > slo.maxBrowserResidentBytes
  )
    found.push(
      `browser memory peak ${processes.peakBrowserResidentBytes} B > ${slo.maxBrowserResidentBytes} B`,
    );
  if (
    positive(slo.maxCostPerSuccessfulRun) &&
    report.cost.costPerSuccessfulRun !== null &&
    report.cost.costPerSuccessfulRun > slo.maxCostPerSuccessfulRun
  )
    found.push(
      `cost per successful run ${report.cost.costPerSuccessfulRun} ${report.cost.currency} > ${slo.maxCostPerSuccessfulRun}`,
    );
  return { passed: found.length === 0, breaches: found, economicGate: report.cost.gate };
}

/** This profile against the latest baseline of the same environment: current ÷ baseline. */
export function compare(baseline, current) {
  if (!baseline) return null;
  const pick = (r) => ({
    apiP95Ms: r.measured.api.p95,
    queueWaitP95Ms: r.measured.runs.queueWaitP95Ms,
    runP95Ms: r.measured.runs.durationP95Ms,
    successfulPerHour: r.measured.runs.successfulPerHour,
    peakBrowserResidentBytes: r.measured.processes.peakBrowserResidentBytes,
    bytesPerAttempt: r.measured.artifacts.bytesPerAttempt,
    slowestQueryMs: max(r.measured.database.queries.map((q) => q.medianMs)),
    costPerSuccessfulRun: r.cost.costPerSuccessfulRun,
  });
  const before = pick(baseline);
  const after = pick(current);
  return {
    baseline: baseline.file ?? null,
    baselineAt: baseline.startedAt,
    ratios: Object.fromEntries(
      Object.keys(after).map((k) => [k, round(ratio(after[k], before[k]), 3)]),
    ),
  };
}

function latestBaseline(dir, environment) {
  try {
    const files = readdirSync(dir)
      .filter((f) => /^baseline-.*\.json$/.test(f))
      .sort()
      .reverse();
    for (const file of files) {
      const report = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      if (report.schema === SCHEMA && report.environment?.name === environment && report.measured)
        return { ...report, file };
    }
  } catch {
    /* No earlier baseline: no comparison. */
  }
  return null;
}

// ─── Running a profile ──────────────────────────────────────────────────────────

const defaultIo = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (line) => console.log(line),
  importTool: (name) => import(new URL(name, import.meta.url).href),
};

/** Runs a tool's main in this process with everything it prints redacted. */
async function inProcess(run, redact, log) {
  const original = { log: console.log, error: console.error, warn: console.warn };
  const print = (...args) => log(redact(args.join(' ')));
  Object.assign(console, { log: print, error: print, warn: print });
  try {
    return await run(print);
  } finally {
    Object.assign(console, original);
  }
}

function revision() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export async function main(argv, { env = process.env, io = defaultIo } = {}) {
  const options = parseArgs(argv);
  if (options.error) {
    io.log(options.error);
    return EXIT_TOOL_ERROR;
  }
  const resolved = loadConfig(options.profile, env);
  if (resolved.error) {
    io.log(`Refused: ${resolved.error}`);
    return EXIT_TOOL_ERROR;
  }
  const { config, profile, axes, metrics } = resolved;
  const redact = redactor(resolved.credentials);
  const say = (line) => io.log(redact(line));
  const stamp = new Date(io.now()).toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(options.out ?? config.output?.dir ?? localDir('benchmark'));
  const runDir = path.join(outDir, `${profile}-${stamp}`);
  mkdirSync(runDir, { recursive: true });
  const work = workload(config.baseline, axes);
  const startedAt = new Date(io.now()).toISOString();
  say(
    `Benchmark ${profile} (${axes.length ? axes.map((a) => `${a} ×${FACTOR}`).join(', ') : 'baseline'}) on ${config.environment.name}`,
  );

  let load;
  let volume;
  let processes;
  let codes;
  try {
    const loadTool = await io.importTool('./wfm-load.ts');
    const volumeTool = await io.importTool('./wfm-volume.ts');
    const watch = sampler(io, metrics, (config.sampleSeconds ?? 5) * 1000);
    const loadCode = await inProcess(
      () => loadTool.main(loadArgv(resolved, work, path.join(runDir, 'load.json'))),
      redact,
      io.log,
    );
    processes = summariseProcesses(metrics, await watch.stop());
    const volumeCode = await inProcess(
      (print) =>
        volumeTool.main(volumeArgv(resolved, work, path.join(runDir, 'volume.json')), print),
      redact,
      io.log,
    );
    codes = { load: loadCode, volume: volumeCode };
    if (loadCode === EXIT_TOOL_ERROR || volumeCode === EXIT_TOOL_ERROR)
      throw new Error(`${loadCode === EXIT_TOOL_ERROR ? 'wfm-load' : 'wfm-volume'} could not run`);
    load = JSON.parse(readFileSync(path.join(runDir, 'load.json'), 'utf8'));
    volume = JSON.parse(readFileSync(path.join(runDir, 'volume.json'), 'utf8'));
  } catch (error) {
    const file = path.join(outDir, `${profile}-${stamp}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        { schema: SCHEMA, profile, startedAt, error: redact(error.message), codes },
        null,
        2,
      ),
    );
    say(`The benchmark could not be run: ${error.message}\nReport: ${file}`);
    return EXIT_TOOL_ERROR;
  }

  const runs = summariseRunLoad(load);
  const dbBytesPerRun = databaseBytesPerRun(volume);
  const usage = {
    admittedRuns: runs.admitted,
    successfulRuns: runs.successful,
    failedRuns: runs.failed,
    refusedRuns: runs.refused429,
    runWindowSeconds: runs.windowSeconds,
    successfulPerHour: runs.successfulPerHour,
    artifactBytes: processes.artifactBytes,
    databaseBytesPerRun: dbBytesPerRun,
    cpuSeconds: processes.cpuSeconds,
    browserCpuSeconds: processes.browserCpuSeconds,
  };
  const report = {
    schema: SCHEMA,
    profile,
    axes,
    factor: axes.length ? FACTOR : 1,
    startedAt,
    finishedAt: new Date(io.now()).toISOString(),
    environment: {
      ...config.environment,
      revision: revision(),
      runner: {
        platform: process.platform,
        node: process.version,
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model ?? null,
        memoryBytes: os.totalmem(),
      },
      targets: resolved.targets.length,
      maxConcurrentPerOrganization: config.target.maxConcurrent,
    },
    workload: work,
    measured: {
      api: {
        requests: load.reads.requests,
        perSecond: load.reads.perSecond,
        p50: load.reads.p50,
        p95: load.reads.p95,
        p99: load.reads.p99,
        errors: load.reads.errors,
        errorRate: load.reads.errorRate,
        limited429: load.reads.limited,
      },
      runs,
      processes,
      artifacts: {
        bytes: processes.artifactBytes,
        bytesPerAttempt: ratio(processes.artifactBytes, runs.admitted),
      },
      database: {
        postgres: volume.postgres,
        bytesPerRun: dbBytesPerRun,
        sizes: volume.sizes,
        queries: volume.measurements.map((m) => ({
          name: m.name,
          medianMs: m.medianMs,
          seqScans: m.seqScans,
          indexes: m.indexes,
        })),
      },
    },
    cost: priceRuns(config.cost, usage),
    slo: config.slo,
    sources: {
      load: path.join(runDir, 'load.json'),
      volume: path.join(runDir, 'volume.json'),
      loadBreaches: load.breaches ?? [],
      volumeBreaches: volume.breaches ?? [],
    },
  };
  report.verdict = verdict(config.slo, report);
  report.limits = {
    axes,
    workload: work,
    sustainable: report.verdict.passed,
    successfulPerHour: runs.successfulPerHour,
    note: report.verdict.passed
      ? 'Within the approved SLO at this scale on this environment.'
      : 'Beyond the approved SLO at this scale: the sustainable limit is below it.',
  };
  report.comparison =
    profile === 'baseline'
      ? null
      : compare(latestBaseline(outDir, config.environment.name), report);

  const file = path.join(outDir, `${profile}-${stamp}.json`);
  writeFileSync(file, redact(JSON.stringify(report, null, 2)));
  say('');
  say(
    `API p95 ${report.measured.api.p95 ?? '—'} ms · queue wait p95 ${runs.queueWaitP95Ms ?? '—'} ms · ${runs.successful}/${runs.admitted} runs completed, ${runs.refused429} refused`,
  );
  say(
    `Cost per successful run: ${report.cost.costPerSuccessfulRun ?? `missing (${report.cost.missing.join(', ')})`}${report.cost.currency ? ` ${report.cost.currency}` : ''}`,
  );
  say(
    report.verdict.passed
      ? 'Within the approved SLO.'
      : `Breached:\n${report.verdict.breaches.map((b) => `  ✗ ${b}`).join('\n')}`,
  );
  say(`Report: ${file}`);
  return report.verdict.passed ? EXIT_OK : EXIT_BREACHED;
}

if (process.argv[1] && /wfm-benchmark(\.m?js)?$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
