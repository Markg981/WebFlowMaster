# Platform load and endurance testing

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

Exit codes: `0` within thresholds, `1` breaches, `2` tool/setup failure. Run `npx vitest run scripts/wfm-load.test.ts` for virtual-clock coverage. Simulations do not establish live platform endurance. Record a real run's report, environment/version, organization limits and runner/worker logs before making that claim. Agent, scheduler, artifact and controlled-restart acceptance require their own live scenarios; this runner exercises `/api/v1` reads and plan execution queues.
