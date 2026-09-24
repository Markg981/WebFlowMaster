# Configuration reference

Every environment variable the web process, the workers, the CLI and the local agent read,
with its default. Put them in a `.env` file next to the application (development) or in the
process environment (containers, systemd). `.env.example` in the repository lists the common
ones with the same explanations.

The **Read by** column says which process needs the value: **web** is `dist/index.js`,
**worker** is `dist/worker.js`, **both** means give both the same value. When in doubt, give
the web process and the workers the same environment: a value a process does not read does no
harm.

## Required

| Variable | Read by | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | both | `./data/local-pg` in `.env.example` | A `postgres://` connection string, or a directory path for an embedded PGlite database (development only). |
| `REDIS_URL` | both | `redis://localhost:6379` | Redis or Valkey: queues, sessions, schedules, the agent relay directory. |
| `SESSION_SECRET` | web | none: the web process does not start | Signs session cookies. A long random value; see [Secrets](./installation#secrets). |
| `ENCRYPTION_KEY` | both, and the migrator | none: fails when a secret is first read or written | Encrypts stored secrets with AES-256-GCM. 64 hexadecimal characters (32 bytes); any other string is hashed with SHA-256 into a key. **Never change it** on an installation with saved secrets. |
| `NODE_ENV` | both | unset | `production` in any real installation: secure cookies, JSON logs, closed diagnostic endpoints, and no TLS exemptions. |

## Web server and security

| Variable | Read by | Default | Description |
|---|---|---|---|
| `PORT` | web | `5000` | The port for the API and the web client. A malformed value stops the startup rather than falling back. In development, point the client dev server at it with `VITE_API_PORT`. |
| `SESSION_COOKIE_SECURE` | web | `true` when `NODE_ENV=production` | `true` or `false`; any other value is ignored. `false` sends the session cookie over plain HTTP: only for a local stack without TLS. |
| `CSRF_TRUSTED_ORIGINS` | web | none | Comma-separated origins accepted for state-changing requests besides the request's own `Host`. Needed when a proxy presents a different public origin, e.g. `https://app.example.com`. |
| `REGISTRATION` | web | `invitation` | `invitation`: accounts are created from an invitation, except the installation's first. `open`: anyone who reaches the server may register and gets an organization of their own. Any other value stops the startup. See [First sign-in](./installation#first-sign-in). |
| `MFA_ISSUER` | web | `WebFlowMaster` | The name authenticator apps show next to the codes. Set it per installation ("WebFlowMaster Staging") so people with several accounts can tell them apart. |
| `WEBFLOW_PUBLIC_URL` | both | none | This installation's public address. Used to link to a run from notifications and commit statuses; without it they carry no link. |
| `WORKSPACE_NAME` | web | `WebFlowMaster` | The name the sidebar shows. Only read the first time the installation starts. |

## Running plans

| Variable | Read by | Default | Description |
|---|---|---|---|
| `WORKER_CONCURRENCY` | worker | `1` | Plans one worker process runs at once. |
| `RUN_MAX_PARALLEL` | worker | `16` | The most browser sessions one run opens at once, whatever the plan asks for. |
| `ORG_MAX_CONCURRENT_RUNS` | both | `2` | Runs of one organization in progress at once. Further runs wait. |
| `ORG_MAX_QUEUED_RUNS` | web | `100` | Runs of one organization waiting at once. Past it, a new run is refused with `429`. |
| `RUN_DEFERRAL_MS` | worker | `10000` | How long a run held back by its organization's limit waits before it is looked at again. |
| `RUN_HEARTBEAT_INTERVAL_MS` | both | `15000` | How often a worker confirms that a run is still going. |
| `RUN_STALE_AFTER_MS` | web | the larger of 8 heartbeats and `120000` | A run whose heartbeat is quiet this long ends as *error: worker lost*. |
| `RUN_MAX_DURATION_MS` | both | `10800000` (3 hours) | Past this a run stops starting tests and ends as *timed out*. The web process enforces it too, five minutes later, in case the worker is stuck. |
| `SCHEDULER_BACKEND` | web | `cron` | `cron`: schedules run in the web process; fine for one web process. `bullmq`: schedules live in Redis, run once however many web processes there are, and survive restarts. Requires a worker. |

## Browser tasks

Previews, single test runs from the editor, page loads and element detection: the browsers a
person waits for.

| Variable | Read by | Default | Description |
|---|---|---|---|
| `BROWSER_TASKS` | web | `worker` | `worker` sends them to the workers, on their own queue. `inline` runs them in the web process: one process, fine for a laptop. Recording always runs in the web process, because its window opens on that machine. |
| `BROWSER_TASK_CONCURRENCY` | worker | `2` | Browser tasks one worker runs at once. |
| `BROWSER_TASK_TIMEOUT_MS` | web | `300000` (5 minutes) | How long a request waits for its task before answering `504`. |
| `ELEMENT_DETECTION_LIMIT` | where tasks run | `300` | The most elements one page detection returns. The result says when it was cut. |

## Runners

| Variable | Read by | Default | Description |
|---|---|---|---|
| `RUNNER_HEARTBEAT_INTERVAL_MS` | worker | `15000` | How often a worker reports in to **Settings → Runners**. |
| `RUNNER_OFFLINE_AFTER_MS` | web | three heartbeat intervals | A runner not heard from this long shows as offline. |
| `APP_VERSION` | worker | none | The version a runner reports, for telling machines apart during an upgrade. |

## System under test

| Variable | Read by | Default | Description |
|---|---|---|---|
| `APP_BASE_URL` | both | `http://localhost:7000` | The value of <code v-pre>{{baseUrl}}</code> in a run with no environment selected. Prefer a `baseUrl` secret per environment in Settings, which is what lets one test run against several sites. |
| `DMO_BASE_URL` | both | none | The former name of `APP_BASE_URL`, still read when that one is unset. |
| `INSECURE_TLS_HOSTS` | both | none | Comma-separated `host:port` values allowed to present a certificate Node would reject (a self-signed dev server). Per host, never global, and ignored when `NODE_ENV=production`. |

## Artifacts

| Variable | Read by | Default | Description |
|---|---|---|---|
| `ARTIFACT_STORE` | both | `local` | `local`: the disk of the process that wrote them. `s3`: an S3-compatible bucket shared by every process. Needed as soon as workers and the web process do not share a disk. |
| `VISUAL_BASELINE_DIR` | both | `./data/visual-baselines` | Where the local store keeps visual baselines. Screenshots, videos and traces go under `./results`. |
| `S3_BUCKET` | both | none (required for `s3`) | The bucket. |
| `S3_REGION` | both | `us-east-1` | The bucket's region. |
| `S3_ENDPOINT` | both | none | For MinIO, Cloudflare R2 or another S3-compatible store. |
| `S3_FORCE_PATH_STYLE` | both | `true` when `S3_ENDPOINT` is set | `true` addresses the bucket by path rather than by subdomain. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | both | the AWS default chain | Explicit credentials. Unset uses environment, profile or instance role. |
| `S3_PREFIX` | both | none | Prepended to every key, so one bucket can hold several installations. |
| `ARTIFACT_RETENTION_DAYS` | web | `90` | Days a finished run keeps its screenshots, videos and traces. Results and baselines are kept. `0` keeps everything. |

## Local agents

| Variable | Read by | Default | Description |
|---|---|---|---|
| `AGENT_RELAY_SECRET` | both | `SESSION_SECRET` | Signs the one-minute tickets with which a runner borrows an agent's browser. Must be the same in the web processes and every worker. |
| `AGENT_RELAY_URL` | worker | `http://127.0.0.1:<PORT>` | Where workers reach the relay in the web process. Set it whenever workers run on other machines or containers, e.g. `http://api:5000`. |
| `AGENT_RELAY_ADVERTISE_URL` | web | none | With several web processes: this one's own address as the others reach it. Agents connected to one instance are then usable from all. |

## AI features (optional)

| Variable | Read by | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | both | none | Google Gemini key. Without it, describing a test in sentences and AI selector healing are off; everything else works. |
| `GEMINI_MODEL` | web | `gemini-2.0-flash` | The model used to turn sentences into steps. Healing uses its own. |

## Logging

| Variable | Read by | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | both | `info` | `error`, `warn`, `info`, `http`, `verbose`, `debug` or `silly`. Only the initial value: after the first start, **Settings → System** wins. |
| `LOG_RETENTION_DAYS` | both | `7` | Days log files are kept. Same rule as `LOG_LEVEL`. |
| `CLIENT_LOG_LEVEL` | web | `info` | Initial level for logs the web client sends to the server. |
| `LOKI_URL` | both | none | A Grafana Loki address; logs are pushed there as well, in batches every five seconds. |

## CLI (`wfm`)

Set in the pipeline, not on the server. See [CI integration](../CI_INTEGRATION).

| Variable | Description |
|---|---|
| `WFM_URL` | The installation's address. |
| `WFM_API_KEY` | An API key, `wfm_…`, with the scopes the command needs. |
| `WFM_IDEMPOTENCY_KEY` | Starts at most one run for this key; a retried pipeline step does not start a second run. |

## Local agent (`wfm-agent`)

Set on the agent's machine. See [Local agents](../LOCAL_AGENT).

| Variable | Default | Description |
|---|---|---|
| `WFM_URL` | none | The installation's address. |
| `WFM_AGENT_TOKEN` | none | The agent's token, `wfa_…`, shown once when an owner creates the agent. |
| `WFM_AGENT_MAX_SESSIONS` | `2` | Browsers the agent lends at once (1 to 16). |

## Development only

| Variable | Description |
|---|---|
| `VITE_API_PORT` | Where the client dev server forwards API calls, when `PORT` is not 5000. |
