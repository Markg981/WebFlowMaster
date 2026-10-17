# Platform load and endurance testing

For local acceptance, `npm run collaudo:carico` prepares two tenants and removes its trial data.
The runner uses the current Node executable with the `tsx` loader, including on Windows,
without putting API keys through a shell. Retain the JSON before another run. To measure capacity
without the API rate limit, disable it only on the trial stack and restore its original value
afterwards; record this setting along with duration, concurrency and machine resources.

Use API keys with `plans:read`, `runs:read` and `runs:write`, and one inexpensive existing plan per organization. Runs remain in plan history and consume the installation's runners.

```sh
npx tsx scripts/wfm-load.ts --url https://wfm.example.com \
  --target <key-org-a>:<plan-a> --target <key-org-b>:<plan-b> \
  --readers 10 --runs 10 --max-concurrent 2 \
  --soak-seconds 3600 --interval-seconds 30 \
  --run-timeout 600 --request-timeout 30 --json endurance.json
```

Without `--soak-seconds`, the existing read phase followed by a single burst runs once. With a positive soak duration, each cycle starts bursts concurrently across targets while readers continuously list plans and runs. The next cycle waits for the previous burst to finish and for the minimum start-to-start interval to elapse. Cycles do not overlap. The final accepted burst is watched to completion or `--run-timeout`, so total elapsed time can exceed the soak duration. Reads stop at the soak deadline; in-flight requests can finish up to their HTTP deadline.

Each cycle emits JSON metrics and is included in the report's `cycles` array: start time, elapsed seconds, read statistics, per-target run statistics and breaches. Top-level reads cover the whole soak; top-level runs describe the final cycle. Counters cover every request. Latency percentiles use a uniform reservoir of at most 10,000 requests per cycle and for the whole soak (`latencySampleSize`), so percentiles are estimates for larger samples. Latency sample memory stays bounded; cycle summaries and accepted IDs are retained for reporting and duplicate detection.

Every invocation/cycle uses distinct idempotency keys. Accepted IDs are polled individually, so a busy plan's latest-100 listing cannot hide them. Duplicate returned IDs, failed terminal statuses, missing IDs, unfinished runs, start errors and threshold breaches fail the test. A missing ID means it was never successfully retrieved before the deadline; investigate API/network availability as well as possible lost runs. Read responses with status `429` count separately as rate limiting. For run starts, only explicit `queue_quota_exceeded` (or legacy `queue_full`) responses count as expected queue refusals; `rate_limited` and unknown `429` responses are start errors. A positive run workload with zero accepted starts fails for that target/cycle, even when every rejection is an expected queue refusal. `--max-concurrent` measures only this test's runs; use otherwise idle organizations to validate their configured concurrency limit.

Readers and concurrency must be positive integers; runs must be an integer from 0 to 100 per target/cycle. Poll, interval, HTTP deadline and run timeout must be positive. The read error-rate threshold is a fraction between 0 and 1. HTTP deadlines cover response headers and bodies and abort hung requests.

Exit codes: `0` within thresholds, `1` breaches, `2` tool/setup failure. Run `npx vitest run scripts/wfm-load.test.ts` for virtual-clock coverage. Simulations do not establish live platform endurance. Record a real run's report, environment/version, organization limits and runner/worker logs before making that claim.

## Sizing a load worker

The [load tests](../guide/load-tests) users run from the **Load tests** page are not the script
above: each run is a `load-run` job on the `load-queue`, and a worker executes it with the engine
in `server/api-tests/load-runner.ts`. The web process only queues the run (`queued`), and the worker that
takes it marks it `running` with its name, writes the summary every two seconds and beats every
`WORK_ITEM_HEARTBEAT_MS`; a run whose worker goes quiet for `STALE_CLAIM_MS` ends as
`worker_lost`. A web restart changes nothing for a run; a worker restart with
`WORKER_SHUTDOWN_GRACE_MS` long enough lets its run finish first.

A load run is HTTP traffic, not a browser: a worker sending 200 virtual users through a scenario
of a few requests uses one CPU core in part and a few hundred megabytes, far less than one plan
run. What limits it is the network between the worker and the system under test, and the
system's own capacity — a worker that saturates its own uplink measures the uplink. Keep it on
the same network as the system under test, or at least on one with a known, stable latency, and
not on the host serving the web process.

- `LOAD_WORKER_CONCURRENCY` (default `1`) is how many load runs one worker executes at once. One
  is the honest value: two runs on one worker share its CPU and uplink and measure each other.
  `0` makes a worker take no load runs, for workers kept for plans.
- `LOAD_MAX_VIRTUAL_USERS` and `LOAD_MAX_DURATION_S` (defaults `200` and `3600`) cap what a run
  may ask for; the web process refuses a test or a run beyond them, naming the limit, and the
  worker caps the run at its own value. Raise them once the workers and the network have shown
  they can carry it. The editor's fields stop at the shipped defaults; higher values go through
  the API.
- `LOAD_MAX_RUNS_PER_ORGANIZATION` (default `1`) is how many runs of one organization may be
  queued or running at once. Several organizations each get their own.

A run is executed by one worker, whole: its virtual users are not split across workers. The way
beyond what one worker can send is several workers running several runs — of several
organizations, or of one with its limit raised — each measuring its own scenario. Every worker
listens to the load queue, so scaling the workers scales the load runs with the plan runs:

```sh
docker compose up -d --scale worker=3
```

With `LOAD_WORKER_CONCURRENCY=1` that stack executes three load runs at once, one per worker, and
a fourth waits as `queued` until one ends. The queue's depth and the workers' capacity are on the
worker's metrics endpoint as `load-queue` (see [Telemetry](./telemetry)).

## Volume testing

`npm run volume` answers a different question from the load test: how the log and result tables behave after a year of runs. It generates months of runs, results and log lines directly in PostgreSQL, then times the hot queries with `EXPLAIN (ANALYZE, BUFFERS)` as the application role under row-level security, and probes how long deleting one month takes.

```sh
npm run volume -- --database-url postgres://postgres:PASSWORD@HOST:PORT/wfm_volume
```

Safety: the tool writes millions of rows, so it needs a dedicated scratch database, owned by a superuser or the owner of the schema, with the migrations applied. It never reads `DATABASE_URL`, because that names the installation's own database. It refuses a database that holds organizations not created by itself (named `wfm-volume-N`). Never point it at production.

Options (defaults in brackets): `--months` [12], `--runs-per-day` [300], `--orgs`, `--plans`, `--tests`, `--results-per-run` [20], `--logs-per-run` [40], `--repeat` (samples per query, median reported), `--max-ms` [250] and `--seq-scan-rows` [50000] (thresholds), `--json PATH` (report file, default `.local/volume/`), `--measure-only` (skip generation), `--reset` (drop previously generated data), `--no-delete-probe`.

Phases: generate, ANALYZE, measure, delete probe (one month of runs with the cascade to results and logs, in a transaction that is rolled back), report. Exit codes: `0` within thresholds, `1` a query is slower than `--max-ms` or sequentially scans more than `--seq-scan-rows` rows of a run table, `2` setup failure or refused database. Run `npx vitest run scripts/wfm-volume.test.ts` for the unit tests.

### Measured results

12 months, 300 runs a day over 3 organizations: 103,800 runs, 2.08 million results, 4.15 million log lines (about 1.2 GB of tables, 0.6 GB of indexes), PostgreSQL 16, median of the samples.

| Query                                               |                   Before |  After |
| --------------------------------------------------- | -----------------------: | -----: |
| Logs console of a run (recent or 11 months old)     |                   0.1 ms | 0.1 ms |
| Results of a run                                    |                   0.1 ms | 0.1 ms |
| Retention sweep (partial index from migration 0026) |                   0.0 ms | 0.0 ms |
| Run history, first page                             |                    39 ms | 0.1 ms |
| Dashboard, 30-day totals                            |                   747 ms |  94 ms |
| Dashboard, recent runs                              | 660 ms (sequential scan) | 1.5 ms |
| Results of one test, last 30 days                   |                    19 ms |  24 ms |

The dashboard and the run history sort by `coalesce(started_at, queued_at)` inside one organization; with no index on that expression the database read and sorted every run of the organization. Migration 0088 adds `test_plan_executions_org_run_time_idx (organization_id, coalesce(started_at, queued_at) DESC)`. The log and result lookups were already served by their indexes.

### Partitioning by month

Deleting one month (3,000 runs with their results and logs) takes about 1 s at this size, so dropping a monthly partition would not be a gain today. Reconsider partitioning only well beyond it, for example tens of millions of rows a month, or once row retention exists. Today only artifacts are purged by retention: `execution_logs` and `report_test_case_results` have no row retention, so they grow linearly with the number of runs.

## Automatic resilience scenarios

```sh
npm run test:resilience
npm run load:resilience -- --cycles 3 --recovery-timeout 180 --observation-seconds 40
```

Requires Node.js 22.19+ and Docker Compose with resources to build the production API/worker images and run PostgreSQL, Redis and two real Chromium agents. The command builds a fresh, randomly named local stack and two organizations. It accepts no existing project, URL or credentials; only its own containers and volumes are removed. Reports remain in `.local/resilience/<id>/`. Generated credentials and artifacts are excluded from Git and Docker build contexts.

The baseline reuses the endurance runner for public API reads and concurrent plan bursts. Every cycle then exercises one-off BullMQ schedules due while the worker is stopped, queued runs, a graceful worker restart (SIGTERM) during an observed agent browser session, and a Redis stop/start with durable AOF queue storage. Agent processes are restarted between runs and must reconnect and complete fresh work. Redis restart tests retained data, not loss of Redis persistence. Agent termination during active work is outside this scenario.

Use `npm run load:resilience -- --worker-restart crash` separately to verify SIGKILL handling. Exactly the run observed active before the kill must terminate as `error` with `failureCode: worker_lost`; every other run must complete. The interrupted run must remain present with the same ID and must not be replayed. This is crash detection, not successful continuation: the report labels `scenarioPurpose`, `expectedWorkerLostIds`, `crashDetectionPassed` and `successfulRecovery: false`. Default `--worker-restart graceful` accepts no failed runs and must report `successfulRecovery: true`. A crash diagnostic can exit 0 only when all these expectations pass; other errors, missing runs and duplicates still fail it. Worker shutdown waits for active jobs within its existing 30-second grace period; larger jobs require a drain procedure before restart.

Accepted intents are replayed with the same idempotency key and must return the same run ID. Paginated inventory is reconciled against every accepted ID plus exactly one execution per schedule. Missing/extra IDs, duplicate executions, incomplete/failed runs, missing/duplicate/failed test results and inaccessible or empty screenshot artifacts fail the command. Final artifacts include byte counts and SHA-256 checksums. An observation window of at least 40 seconds follows recovery to catch stalled-job redelivery; this is bounded evidence, not a guarantee against duplicates after the window.

`resilience.json` records revision, dirty checkout, image identities, settings, phase durations, accepted/scheduled/observed IDs, artifacts, violations and cleanup failures. `operations.log` and `containers.log` support diagnosis. Exit `0` means all scenarios and cleanup passed; any scenario, prerequisite, deadline or cleanup failure exits `1` and leaves a failed report. Default: one cycle, 180-second recovery deadline, 40-second observation. Up to 100 cycles are supported; total runtime also includes builds, per-scenario deadlines and observation windows. A successful synthetic local run does not establish production RTO, S3 resilience, device/grid resilience or manual acceptance. Procedure: `collaudo/automatic-resilience.md`.

## Growth to ten times {#benchmark}

```sh
npm run test:benchmark
WFM_BENCHMARK_CONFIG=bench.json npm run benchmark -- --profile baseline
WFM_BENCHMARK_CONFIG=bench.json npm run benchmark -- --profile tenfold-tests     # N → 10N plans and tests
WFM_BENCHMARK_CONFIG=bench.json npm run benchmark -- --profile tenfold-readers   # U → 10U API clients
WFM_BENCHMARK_CONFIG=bench.json npm run benchmark -- --profile tenfold-runs      # R → 10R run starts and history
```

`scripts/wfm-benchmark.mjs` is not a second load engine: it calls `main(argv)` of `wfm-load` and `wfm-volume` in its own process, scrapes the worker's metrics endpoints before, during and after them, prices what was used and returns one verdict. Each profile multiplies **one** axis by ten; `tenfold-combined` runs only when the configuration names an agreed `combination` (`axes`, `agreedBy`). Run the baseline first: later profiles compare themselves with the latest baseline of the same environment.

**Where it runs.** On a dedicated installation and a dedicated scratch database only. The configuration file named by `WFM_BENCHMARK_CONFIG` is refused when it is missing, when `environment.production` is not explicitly `false` or the name says _prod_, when `target.url` is the installation in use (`WFM_URL`, `WEBFLOW_PUBLIC_URL`), or when the scratch DSN equals the application's `DATABASE_URL`. There is no default target.

**Credentials.** The file only names variables: `keyEnv`, `tokenEnv` and `databaseUrlEnv` must be `WFM_BENCHMARK_*`. A key, token, password or DSN written into the file is refused. Since both tools run in-process, keys and DSNs never appear in operating-system process arguments; everything printed and the report are redacted.

The configuration records what the numbers were measured on and what they are judged against:

| Section       | Content                                                                                                                                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment` | `name`, `production: false`, `version`, `browser`, `hardware`, `concurrency` (`WORKER_CONCURRENCY`, `BROWSER_TASK_CONCURRENCY`, `ORG_MAX_CONCURRENT_RUNS`), `steps`, `artifacts`, `mix` `{ web, api }`                                                                                                     |
| `target`      | `url`, `targets` `[{ keyEnv, planId }]`, `maxConcurrent`, `metrics` `[{ name, url, tokenEnv }]` — one entry per worker replica                                                                                                                                                                             |
| `volume`      | `databaseUrlEnv`: the scratch database `wfm-volume` resets                                                                                                                                                                                                                                                 |
| `baseline`    | `plans`, `tests`, `readers`, `runs`, `readSeconds`, `months`, `runsPerDay`, `orgs` — N, U and R                                                                                                                                                                                                            |
| `slo`         | `approvedBy`, `approvedAt`, `maxP95Ms`, `maxErrorRate`, `maxQueueWaitP95Ms`, `maxQueryMs`, `maxSeqScanRows`; optional `maxRunP95Ms`, `max429Rate`, `maxBrowserResidentBytes`, `maxCostPerSuccessfulRun`                                                                                                    |
| `cost`        | `basis` (`tariff`, or `on-prem` with `amortisation`), `currency`, `rateSource`, `rates` (`infrastructurePerHour`, `storagePerGbMonth`, `trafficPerGb`, `aiPerRun` when `ai.used`), `retentionDays`, `trafficBytesPerArtifactByte`, `monthlyRuns`, `peakFactor`, `assumptions`, `exclusions`, `maintenance` |

**Report.** `.local/benchmark/<profile>-<time>.json` (or `output.dir`), next to the raw `load.json` and `volume.json`. `measured` holds only measurements: API p50/p95/p99, errors and 429s; runs admitted, refused, completed, failed, queue wait and duration p50/p95, time to the first failure and completed runs per hour; peak memory and CPU of the worker and of the browsers it started; artifact bytes per attempt; database bytes per run and the `EXPLAIN (ANALYZE, BUFFERS)` probes. `cost` holds the estimates: `usage`, `rates`, `currency`, `rateSource`, `assumptions`, `exclusions`, `costPerRun`, `costPerSuccessfulRun`, `monthlyCostBaseline`, `monthlyCost10x`. Failed attempts and the capacity provisioned for the whole window are priced: retries are never free. A rate that is not given is listed in `cost.missing`, the totals stay `null` — never zero — and `cost.gate` stays `unvalidated`. Human maintenance time is reported apart, under `cost.maintenance`, from the pilot. `verdict` lists every breached threshold; `limits` says whether this scale is sustainable; `comparison` divides the key figures by the baseline's.

**Exit codes.** `0` within the approved SLO, `1` a threshold was breached (the profile failed; the report still carries every number), `2` refused or a tool could not run.

**Reading saturation.** Pressure must end as an explicit queue (`wfm_queue_jobs{state="waiting"}`, queue wait) or a refusal (HTTP 429), never as a crash, lost results or a quota violation: a changed process start time during a profile is a breach (likely out of memory), and `missing` runs fail `wfm-load`. `WORKER_CONCURRENCY` and `BROWSER_TASK_CONCURRENCY` are **per worker process**; `ORG_MAX_CONCURRENT_RUNS` is per organization. Add a global browser-session budget only if the numbers show that per-process limits are not enough. Before changing an index or a query, measure it with `wfm-volume` (`EXPLAIN (ANALYZE, BUFFERS)`).

A result is a measurement on that environment under those assumptions: it promises neither ten times the throughput nor any saving elsewhere.
