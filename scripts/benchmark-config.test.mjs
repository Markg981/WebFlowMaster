import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EXIT_BREACHED,
  EXIT_OK,
  EXIT_TOOL_ERROR,
  PROFILES,
  histogramQuantile,
  loadArgv,
  loadConfig,
  main,
  parseMetrics,
  priceRuns,
  redactor,
  summariseProcesses,
  volumeArgv,
  workload,
} from './wfm-benchmark.mjs';

const KEY = 'wfm_live_benchmark_key_0123456789';
const DSN = 'postgres://bench:s3cret-pass@bench-db:5432/wfm_bench';
const TOKEN = 'metrics-token-abcdef';

const config = (over = {}) => ({
  environment: {
    name: 'bench-1',
    production: false,
    version: '3.4.0',
    browser: 'chromium 129',
    hardware: { worker: '4 vCPU / 8 GB', db: '2 vCPU / 4 GB' },
    concurrency: { WORKER_CONCURRENCY: 2, BROWSER_TASK_CONCURRENCY: 2 },
    steps: { perTest: 12 },
    artifacts: { screenshots: 'on failure', video: 'off' },
    mix: { web: 0.8, api: 0.2 },
  },
  target: {
    url: 'https://bench.example.test',
    targets: [{ keyEnv: 'WFM_BENCHMARK_KEY', planId: 'plan-1' }],
    maxConcurrent: 4,
    metrics: [
      {
        name: 'worker',
        url: 'http://bench-worker:9464/metrics',
        tokenEnv: 'WFM_BENCHMARK_METRICS_TOKEN',
      },
    ],
  },
  volume: { databaseUrlEnv: 'WFM_BENCHMARK_DATABASE_URL' },
  baseline: {
    plans: 5,
    tests: 50,
    readers: 4,
    runs: 6,
    readSeconds: 10,
    months: 1,
    runsPerDay: 100,
    orgs: 1,
  },
  slo: {
    approvedBy: 'ops lead',
    approvedAt: '2026-10-15',
    maxP95Ms: 800,
    maxErrorRate: 0.01,
    maxQueueWaitP95Ms: 60000,
    maxQueryMs: 200,
    maxSeqScanRows: 10000,
  },
  ...over,
});

const env = (cfg, extra = {}) => ({
  WFM_BENCHMARK_CONFIG: 'bench.json',
  WFM_BENCHMARK_KEY: KEY,
  WFM_BENCHMARK_DATABASE_URL: DSN,
  WFM_BENCHMARK_METRICS_TOKEN: TOKEN,
  ...extra,
  __config: cfg,
});
const read = (e) => () => JSON.stringify(e.__config);
const refuse = (profile, cfg, extra) => {
  const e = env(cfg, extra);
  return loadConfig(profile, e, read(e)).error;
};

describe('the benchmark configuration', () => {
  it('is read from WFM_BENCHMARK_CONFIG and never defaults', () => {
    assert.match(loadConfig('baseline', {}, () => '{}').error, /WFM_BENCHMARK_CONFIG/);
    assert.match(
      loadConfig('baseline', { WFM_BENCHMARK_CONFIG: 'x' }, () => 'not json').error,
      /JSON/,
    );
  });

  it('refuses an unknown profile', () => {
    assert.match(refuse('tenfold-everything', config()), /Unknown profile/);
  });

  it('refuses production, declared or named', () => {
    assert.match(
      refuse('baseline', config({ environment: { ...config().environment, production: true } })),
      /production/,
    );
    assert.match(
      refuse('baseline', config({ environment: { ...config().environment, name: 'eu-prod' } })),
      /production/,
    );
    const { production, ...undeclared } = config().environment;
    assert.ok(production === false);
    assert.match(refuse('baseline', config({ environment: undeclared })), /production/);
  });

  it("refuses the application's own DSN and the installation in use", () => {
    assert.match(
      refuse('baseline', config(), { DATABASE_URL: DSN }),
      /application's own \(DATABASE_URL\)/,
    );
    assert.match(
      refuse('baseline', config(), { WEBFLOW_PUBLIC_URL: 'https://bench.example.test/' }),
      /installation in use/,
    );
    assert.match(
      refuse('baseline', config(), { WFM_URL: 'https://bench.example.test' }),
      /installation in use/,
    );
  });

  it('takes credentials only from dedicated variables, never from the file', () => {
    const cfg = config();
    cfg.target.targets[0].keyEnv = 'WFM_API_KEY';
    assert.match(refuse('baseline', cfg), /WFM_BENCHMARK_/);
    const literal = config();
    literal.target.targets[0].key = KEY;
    const message = refuse('baseline', literal);
    assert.match(message, /target\.targets\[0\]\.key/);
    assert.ok(!message.includes(KEY));
    assert.match(
      refuse('baseline', config({ volume: { databaseUrl: DSN } })),
      /volume\.databaseUrl/,
    );
    assert.match(
      refuse('baseline', config(), { WFM_BENCHMARK_KEY: '' }),
      /WFM_BENCHMARK_KEY .* not set/,
    );
  });

  it('requires the environment record and an approved SLO', () => {
    const { hardware, ...noHardware } = config().environment;
    assert.ok(hardware);
    assert.match(refuse('baseline', config({ environment: noHardware })), /hardware/);
    const { approvedBy, ...unapproved } = config().slo;
    assert.ok(approvedBy);
    assert.match(refuse('baseline', config({ slo: unapproved })), /approvedBy/);
    assert.match(
      refuse(
        'baseline',
        config({ environment: { ...config().environment, mix: { web: 0.5, api: 0.2 } } }),
      ),
      /mix/,
    );
  });

  it('runs the combined profile only when a combination was agreed', () => {
    assert.match(refuse('tenfold-combined', config()), /combination/);
    const e = env(
      config({ combination: { axes: ['readers', 'definitions'], agreedBy: 'ops lead' } }),
    );
    assert.deepEqual(loadConfig('tenfold-combined', e, read(e)).axes, ['readers', 'definitions']);
  });

  it('refuses tenfold-runs beyond what wfm-load takes per target', () => {
    assert.match(
      refuse('tenfold-runs', config({ baseline: { ...config().baseline, runs: 11 } })),
      /at most 100/,
    );
  });
});

describe('the profiles', () => {
  const base = config().baseline;
  const axes = ['plans', 'tests', 'readers', 'runs', 'runsPerDay'];
  const changed = (profile) => {
    const w = workload(base, PROFILES[profile]);
    const b = workload(base, []);
    return axes.filter((k) => w[k] !== b[k]).map((k) => [k, w[k] / b[k]]);
  };

  it('change exactly one axis each, by ten', () => {
    assert.deepEqual(changed('baseline'), []);
    assert.deepEqual(changed('tenfold-tests'), [
      ['plans', 10],
      ['tests', 10],
    ]);
    assert.deepEqual(changed('tenfold-readers'), [['readers', 10]]);
    assert.deepEqual(changed('tenfold-runs'), [
      ['runs', 10],
      ['runsPerDay', 10],
    ]);
  });

  it('pass the URL, the approved thresholds and the DSN only as in-process arguments', () => {
    const e = env(config());
    const resolved = loadConfig('tenfold-readers', e, read(e));
    const work = workload(resolved.config.baseline, resolved.axes);
    const load = loadArgv(resolved, work, 'load.json');
    assert.deepEqual(load.slice(0, 4), [
      '--url',
      'https://bench.example.test',
      '--target',
      `${KEY}:plan-1`,
    ]);
    assert.equal(load[load.indexOf('--readers') + 1], '40');
    assert.equal(load[load.indexOf('--max-p95-ms') + 1], '800');
    const volume = volumeArgv(resolved, work, 'volume.json');
    assert.equal(volume[volume.indexOf('--database-url') + 1], DSN);
    assert.ok(volume.includes('--reset'));
    assert.equal(volume[volume.indexOf('--max-ms') + 1], '200');
  });
});

describe('redaction', () => {
  it('removes credentials and DSN passwords wherever they appear', () => {
    const redact = redactor([KEY, TOKEN, DSN]);
    const out = redact(`key ${KEY} token=${TOKEN} db ${DSN} other postgres://u:pw@h/db`);
    for (const secret of [KEY, TOKEN, DSN, 's3cret-pass', ':pw@'])
      assert.ok(!out.includes(secret), secret);
    assert.match(out, /postgres:\/\/u:\[redacted\]@h\/db/);
  });
});

describe('the metrics read around a profile', () => {
  const scrape = (wait, rss, child, artifacts, start = 100) =>
    parseMetrics(
      [
        '# HELP wfm_job_wait_seconds wait',
        `wfm_job_wait_seconds_bucket{queue="test-execution-queue",job="execute-plan",le="1"} ${wait[0]}`,
        `wfm_job_wait_seconds_bucket{queue="test-execution-queue",job="execute-plan",le="10"} ${wait[1]}`,
        `wfm_job_wait_seconds_bucket{queue="test-execution-queue",job="execute-plan",le="+Inf"} ${wait[2]}`,
        `wfm_process_resident_memory_bytes ${rss}`,
        `wfm_worker_child_resident_bytes ${child}`,
        `wfm_artifact_bytes_written_total ${artifacts}`,
        `wfm_process_cpu_seconds_total ${rss / 1000}`,
        `wfm_process_start_time_seconds ${start}`,
        'wfm_queue_jobs{queue="test-execution-queue",state="waiting"} 7',
      ].join('\n'),
    );

  it('estimates the wait p95 from bucket deltas, as an upper bound', () => {
    const before = scrape([5, 5, 5], 1, 1, 0);
    const after = scrape([6, 20, 25], 1, 1, 0);
    // 20 waits recorded: 1 under 1 s, 14 under 10 s, 5 beyond the last bucket.
    assert.deepEqual(
      histogramQuantile(before, after, 'wfm_job_wait_seconds', { job: 'execute-plan' }, 0.5),
      { upperBoundMs: 10000, overflow: false },
    );
    assert.deepEqual(
      histogramQuantile(before, after, 'wfm_job_wait_seconds', { job: 'execute-plan' }, 0.95),
      { upperBoundMs: 10000, overflow: true },
    );
    assert.equal(histogramQuantile(before, before, 'wfm_job_wait_seconds', {}, 0.95), null);
  });

  it('takes peaks and deltas, and counts a changed start time as a restart', () => {
    const points = [
      scrape([0, 0, 0], 1000, 10, 0),
      scrape([0, 0, 0], 5000, 900, 300),
      scrape([0, 0, 0], 2000, 50, 800, 200),
    ];
    const summary = summariseProcesses([{ name: 'worker' }], {
      series: [points.map((samples, at) => ({ at, samples }))],
      unreachable: 1,
    });
    assert.equal(summary.peakResidentBytes, 5000);
    assert.equal(summary.peakBrowserResidentBytes, 900);
    assert.equal(summary.artifactBytes, 800);
    assert.equal(summary.peakQueueWaiting, 7);
    assert.equal(summary.restarts, 1);
    assert.equal(summary.unreachableScrapes, 1);
  });
});

describe('the cost', () => {
  const usage = {
    admittedRuns: 10,
    successfulRuns: 8,
    failedRuns: 2,
    runWindowSeconds: 3600,
    successfulPerHour: 8,
    artifactBytes: 2e9,
    databaseBytesPerRun: 1e6,
  };
  const cost = {
    basis: 'tariff',
    currency: 'EUR',
    rateSource: 'contract 2026-04',
    rates: { infrastructurePerHour: 1, storagePerGbMonth: 0.1, trafficPerGb: 0.05 },
    retentionDays: 30,
    trafficBytesPerArtifactByte: 1,
    monthlyRuns: 5840,
    peakFactor: 1,
  };

  it('reports a missing rate as missing, never as zero, and leaves the gate to validate', () => {
    const { trafficPerGb, ...partial } = cost.rates;
    assert.ok(trafficPerGb);
    const priced = priceRuns({ ...cost, rates: partial }, usage);
    assert.deepEqual(priced.missing, ['rates.trafficPerGb']);
    assert.equal(priced.rates.trafficPerGb, null);
    for (const field of [
      'costPerRun',
      'costPerSuccessfulRun',
      'monthlyCostBaseline',
      'monthlyCost10x',
    ])
      assert.equal(priced[field], null);
    assert.equal(priced.gate, 'unvalidated');
    assert.equal(priceRuns(undefined, usage).gate, 'unvalidated');
    assert.ok(priceRuns({ ...cost, ai: { used: true } }, usage).missing.includes('rates.aiPerRun'));
    assert.ok(priceRuns({ ...cost, basis: 'on-prem' }, usage).missing.includes('amortisation'));
  });

  it('prices failed attempts and provisioned capacity: retries are not free', () => {
    const priced = priceRuns(cost, usage);
    // 1 h of capacity (1) + storage 2.01 GB × 0.1 + traffic 2 GB × 0.05 = 1.301 over 10 attempts.
    assert.equal(priced.costPerRun, 0.1301);
    assert.equal(priced.costPerSuccessfulRun, 0.162625);
    // 8 runs an hour: 1 unit at baseline (8/h), 10 at 10x; plus 0.0301 a run.
    assert.equal(priced.capacityUnitsBaseline, 1);
    assert.equal(priced.capacityUnits10x, 10);
    assert.equal(priced.monthlyCostBaseline, Math.round((730 + 0.0301 * 5840) * 100) / 100);
    assert.equal(priced.monthlyCost10x, Math.round((7300 + 0.0301 * 58400) * 100) / 100);
    assert.equal(priced.gate, 'computed');
    assert.ok(priced.exclusions.some((e) => /maintenance/i.test(e)));
    for (const field of ['usage', 'rates', 'currency', 'rateSource', 'assumptions', 'exclusions'])
      assert.ok(field in priced, field);
  });
});

describe('a profile run', () => {
  const loadReport = (p95) => ({
    at: '2026-10-17T00:00:00Z',
    baseUrl: 'https://bench.example.test',
    reads: {
      requests: 400,
      perSecond: 40,
      p50: 100,
      p95,
      p99: p95 + 50,
      errors: 0,
      errorRate: 0,
      limited: 0,
    },
    runs: [
      {
        started: 6,
        requested: 6,
        refused: 0,
        startErrors: [],
        statuses: { completed: 5, failed: 1 },
        unfinished: 0,
        missing: 0,
        waitP50: 1000,
        waitP95: 2000,
        durationP50: 30000,
        durationP95: 40000,
        maxRunning: 4,
        firstStartMs: 0,
        lastEndMs: 3600000,
        firstFailureMs: 20000,
      },
    ],
    breaches: p95 > 800 ? [`read p95 ${p95} ms > 800 ms`] : [],
    cycles: [],
  });
  const volumeReport = {
    postgres: '16.4',
    sizes: [{ table: 'test_plan_executions', rows: 3000, tableBytes: 2e6, indexBytes: 1e6 }],
    measurements: [
      { name: 'runs by plan', medianMs: 12, runsMs: [12], seqScans: [], indexes: ['idx'] },
    ],
    breaches: [],
  };
  const io = (p95, seen) => ({
    fetch: async (url, init) => {
      seen.push(init.headers.Authorization);
      return {
        ok: true,
        text: async () => 'wfm_artifact_bytes_written_total 0\nwfm_process_start_time_seconds 1',
      };
    },
    now: () => Date.parse('2026-10-17T10:00:00Z'),
    sleep: async () => {},
    log: (line) => seen.push(line),
    importTool: async (name) => ({
      main: async (argv) => {
        console.log(`tool ${name} got ${argv.join(' ')}`);
        const json = argv[argv.indexOf('--json') + 1];
        writeFileSync(json, JSON.stringify(name.includes('load') ? loadReport(p95) : volumeReport));
        return 0;
      },
    }),
  });

  const run = async (profile, p95, dir = mkdtempSync(path.join(os.tmpdir(), 'wfm-bench-'))) => {
    const e = env(config({ output: { dir } }));
    const file = path.join(dir, 'bench.json');
    writeFileSync(file, JSON.stringify(e.__config));
    e.WFM_BENCHMARK_CONFIG = file;
    const seen = [];
    const code = await main(['--profile', profile], { env: e, io: io(p95, seen) });
    const reports = readdirSync(dir).filter((f) => f.startsWith(profile) && f.endsWith('.json'));
    return {
      code,
      seen,
      dir,
      report: reports[0] && JSON.parse(readFileSync(path.join(dir, reports[0]), 'utf8')),
      raw: reports[0] && readFileSync(path.join(dir, reports[0]), 'utf8'),
    };
  };

  it('writes JSON with measurements, estimates and a verdict, and prints no credential', async () => {
    const { code, seen, report, raw } = await run('baseline', 300);
    assert.equal(code, EXIT_OK);
    assert.equal(report.schema, 'wfm-benchmark/1');
    assert.equal(report.measured.runs.admitted, 6);
    assert.equal(report.measured.runs.failed, 1);
    assert.equal(report.measured.runs.timeToFirstFailureMs, 20000);
    assert.equal(report.measured.database.bytesPerRun, 1000);
    assert.equal(report.cost.gate, 'unvalidated');
    assert.ok(report.cost.missing.length > 0);
    assert.equal(report.verdict.passed, true);
    assert.equal(report.environment.version, '3.4.0');
    const printed = seen.filter((s) => !s.startsWith('Bearer')).join('\n');
    for (const secret of [KEY, DSN, 's3cret-pass']) {
      assert.ok(!printed.includes(secret), `printed ${secret}`);
      assert.ok(!raw.includes(secret), `wrote ${secret}`);
    }
    assert.match(printed, /\[redacted\]/);
  });

  it('fails the profile on a breached threshold and compares it with the baseline', async () => {
    const { dir } = await run('baseline', 300);
    const { code, report } = await run('tenfold-readers', 1200, dir);
    assert.equal(code, EXIT_BREACHED);
    assert.equal(report.verdict.passed, false);
    assert.match(report.verdict.breaches[0], /p95 1200/);
    assert.equal(report.limits.sustainable, false);
    assert.equal(report.workload.readers, 40);
    assert.match(report.comparison.baseline, /^baseline-/);
    assert.equal(report.comparison.ratios.apiP95Ms, 4);
  });

  it('refuses before running anything', async () => {
    const seen = [];
    assert.equal(
      await main(['--profile', 'baseline'], { env: {}, io: io(0, seen) }),
      EXIT_TOOL_ERROR,
    );
    assert.match(seen[0], /Refused: .*WFM_BENCHMARK_CONFIG/);
    assert.equal(await main([], { env: {}, io: io(0, seen) }), EXIT_TOOL_ERROR);
  });
});
