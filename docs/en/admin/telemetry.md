# Metrics and distributed tracing

WebFlowMaster can expose Prometheus metrics and export OpenTelemetry spans using OTLP/HTTP JSON. Both integrations are disabled by default. Existing correlation IDs remain in logs; structured logs also include `traceId` and `spanId` when a span is active.

## Enable metrics

Set `WFM_METRICS_ENABLED=true` and `WFM_METRICS_TOKEN` on API and worker processes. A missing token prevents startup. The dedicated listener binds to `127.0.0.1` by default, port **9464** for API and **9465** for worker. Set `WFM_METRICS_HOST` and `WFM_METRICS_PORT` per process when necessary. Only authenticated `GET /metrics` is served; the listener does not use application sessions.

```bash
curl -H "Authorization: Bearer $WFM_METRICS_TOKEN" http://127.0.0.1:9464/metrics
curl -H "Authorization: Bearer $WFM_METRICS_TOKEN" http://127.0.0.1:9465/metrics
```

For Compose, use `docker compose -f docker-compose.yml -f docker-compose.telemetry.yml up -d --build`. The overlay passes telemetry settings to API and worker and exposes their metric ports **only inside the Compose network**. Run Prometheus on that network or explicitly route to the listeners; the overlay does not install a backend. Protect network access and use TLS when crossing an untrusted network.

Example Prometheus configuration (mount a file containing the token as `/run/secrets/wfm_metrics_token`):

```yaml
scrape_configs:
  - job_name: wfm-api
    static_configs:
      - targets: ['api:9464']
    authorization:
      type: Bearer
      credentials_file: /run/secrets/wfm_metrics_token
  - job_name: wfm-worker
    static_configs:
      - targets: ['worker:9465']
    authorization:
      type: Bearer
      credentials_file: /run/secrets/wfm_metrics_token
```

Discover and scrape **each worker replica separately**. A single load-balanced target would hide unsampled workers.

| Metric | Meaning |
| --- | --- |
| `wfm_http_duration_seconds` | Request duration by method, route template and status; histogram count provides request/error rates. Unmatched routes use a fixed label. |
| `wfm_job_wait_seconds` | Job age when a worker starts an attempt; includes deliberate delays, quota deferrals and retries, not just Redis scheduling latency. |
| `wfm_job_duration_seconds` | Duration of each processing attempt on either execution or browser-task queue. |
| `wfm_jobs_total` | Attempts ending in `success`, `error` or `deferred`; deferral is not a completed run. |
| `wfm_worker_active_jobs`, `wfm_worker_capacity` | In-flight attempts and configured concurrency per queue and worker process. Capacity remains configured capacity while a worker is drained. |
| `wfm_queue_jobs` | Global queue depth by queue/state, exported by workers. Redis scrape errors return HTTP 503 rather than a stale success. |
| `wfm_agent_connected`, `wfm_agent_capacity`, `wfm_agent_active_sessions` | Local relay aggregates: connected agents, slots offered by non-draining agents, and active sessions. Sum these over API replicas. |
| Other `wfm_*` process metrics | Node CPU, memory, event-loop lag and garbage collection from the Prometheus client. |

Queue depths are duplicated across worker replicas: use `max by (queue, state) (wfm_queue_jobs)`, **not a sum**. Worker utilization is `sum by (queue) (wfm_worker_active_jobs) / sum by (queue) (wfm_worker_capacity)`. Example wait p95: `histogram_quantile(0.95, sum by (le, queue) (rate(wfm_job_wait_seconds_bucket[5m])))`. Counters describe worker attempts and infrastructure errors; a test assertion failure returned as a normal result is still a successfully processed job.

## Enable tracing

Set these on the API, every worker and updated local agents:

```dotenv
WFM_TRACING_ENABLED=true
WFM_TRACE_SAMPLE_RATIO=0.1
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces
```

Use an existing collector with an OTLP HTTP receiver; exporter format is **JSON**. Optionally set `OTEL_EXPORTER_OTLP_TRACES_HEADERS` for collector authentication and `OTEL_SERVICE_NAME` to override the default `webflowmaster-api`, `webflowmaster-worker` or `webflowmaster-agent`. Endpoint and authentication follow the [OpenTelemetry exporter configuration](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/). Sampling is parent-based with a root ratio between 0 and 1; incoming trace sampling decisions are preserved. Set ratio `1` for an acceptance check, then choose an operational rate.

The span chain is HTTP request → queue submission → worker attempt → agent client operation → agent session. W3C `traceparent`/`tracestate` travel in job data and signed relay tickets. Scheduled jobs without a request start a new trace; shards inherit their submitting worker's trace. Browser connection spans measure acquisition, while the agent session span lasts until release. API/BDD client spans include slot wait and request execution. An agent session covers BDD execution without instrumenting customer step code in its child process.

Only trace fields cross boundaries: no baggage, payloads, target URLs, exception messages, user or tenant labels are exported. Older agents ignore the optional trace field and continue working, but export no agent-side spans. Rebuild/reinstall the updated standalone agent with the dependency command under [Local agents](../LOCAL_AGENT.md), and configure its collector independently. Agents still open no inbound listener for telemetry.

## Verify

1. Enable metrics and tracing with ratio `1`, rebuild API, worker and the agent, and configure a reachable collector.
2. Check unauthorized scrapes return 401, authorized scrapes return 200, and the worker exposes both queue names and concurrency gauges.
3. Queue a plan and a browser preview, including one using a local agent. Observe queue depth, active slots, wait and processing histograms; provoke an infrastructure failure and check the error counter.
4. In the tracing backend confirm API, producer, worker and agent spans share a trace ID. Look up the same `traceId` in structured logs. Check deferrals count as `deferred` and the active-job gauge returns to zero.

Automated coverage validates HTTP route privacy, listener authentication, job accounting, W3C propagation, OTLP delivery and agent relay regressions. Backend deployment and production load behavior require the operational check above.
