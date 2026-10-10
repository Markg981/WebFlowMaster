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
| `REDIS_URL` | both | `redis://localhost:6379` | Redis or Valkey: queues, sessions, schedules, the agent relay directory. In production the web process does not start if it cannot reach it, and names the error Redis gave; in development it falls back to sessions in memory. |
| `SESSION_SECRET` | web | none: the web process does not start | Signs session cookies. A long random value; see [Secrets](./installation#secrets). |
| `ENCRYPTION_KEY` | both, and the migrator | none: fails when a secret is first read or written | Encrypts stored secrets with AES-256-GCM. 64 hexadecimal characters (32 bytes); any other string is hashed with SHA-256 into a key. **Never change it** on an installation with saved secrets. |
| `NODE_ENV` | both | unset | `production` in any real installation: secure cookies, JSON logs, closed diagnostic endpoints, and no TLS exemptions. |

## Web server and security

| Variable | Read by | Default | Description |
|---|---|---|---|
| `PORT` | web | `5000` | The port for the API and the web client. A malformed value stops the startup rather than falling back. In development, point the client dev server at it with `VITE_API_PORT`. |
| `SESSION_COOKIE_SECURE` | web | `true` when `NODE_ENV=production` | `true` or `false`; any other value is ignored. `false` sends the session cookie over plain HTTP: only for a local stack without TLS. |
| `CSRF_TRUSTED_ORIGINS` | web | none | Comma-separated origins accepted for state-changing requests besides the request's own `Host`. Needed when a proxy presents a different public origin, e.g. `https://app.example.com`. |
| `CONTENT_SECURITY_POLICY` | web | `enforce` when `NODE_ENV=production`, `off` otherwise | `enforce`, `report-only` (the browser reports violations in its console but blocks nothing) or `off`. Any other value stops the startup. `report-only` is for checking a change behind a proxy that injects scripts before enforcing. |
| `API_RATE_LIMIT` | web | `600` | Requests a minute for each API key, and for each client address calling `/api/v1` without a key. Past it the answer is `429` with `Retry-After`. `0` turns it off. Counted in Redis, so several web processes share it. |
| `AUTH_RATE_LIMIT` | web | `20` | Sign-in attempts per 15 minutes for each client address. Past it the answer is `429`. Raise it only for an automated cycle against a test installation; acceptance case ACC-07 checks the default. |
| `PASSWORD_POLICY` | web | `basic` | What a new password must be: `basic` (8 characters, not the username) or `strong` (12 characters, three kinds of character, no username, no common passwords). See [Administration](./administration#password-policy). |
| `SMTP_URL` | web, worker | none | The mail server, as `smtp://user:password@host:587` (STARTTLS when offered) or `smtps://…:465`. With `SMTP_FROM`, turns on e-mail: invitations, reset links, "Forgot your password?" and run notifications. |
| `SMTP_FROM` | web, worker | none | The sender, e.g. `WebFlowMaster <qa@example.com>`. |
| `MAIL_DELIVERY_WEBHOOK_SECRET` | web | none | Installation compatibility secret, at least 32 characters. Authenticates normalized delivery/bounce events at `/api/mail-deliveries/events`; organization callbacks use their own settings. See [E-mail](./administration#e-mail). Without it only SMTP acceptance/rejection is recorded. |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | web, worker | `true` | Installation defaults only: `false` accepts a relay with a self-signed certificate inside your network. Organization custom SMTP always verifies certificates. |
| `WEBHOOK_RATE_LIMIT` | web | `120` | Requests a minute for each client address on `/api/webhooks`. `0` turns it off. |
| `INSTALLATION_ADMINS` | web | none | Comma-separated usernames who may change the installation-wide settings (log level and retention, draining runners). Unset: the owners, while the installation has a single organization. See [Installation administrators](./administration#installation-administrators). |
| `REGISTRATION` | web | `invitation` | `invitation`: accounts are created from an invitation, except the installation's first. `open`: anyone who reaches the server may register and gets an organization of their own. Any other value stops the startup. See [First sign-in](./installation#first-sign-in). |
| `MFA_ISSUER` | web | `WebFlowMaster` | The name authenticator apps show next to the codes. Set it per installation ("WebFlowMaster Staging") so people with several accounts can tell them apart. |
| `WEBFLOW_PUBLIC_URL` | both | none | This installation's public address. Used to link to a run from notifications and commit statuses, which without it carry no link, and as the base of the single sign-on redirect URI, which without it is taken from the request. |
| `SSO_REQUIRE_DOMAIN_VERIFICATION` | web | `false` | `true`: a single sign-on domain routes no sign-in until its organization has proven it with a DNS TXT record, and an unproven claim does not keep another organization from taking the domain. Set it on every installation shared by several organizations. See [Single sign-on](./administration#single-sign-on). |
| `WORKSPACE_NAME` | web | `WebFlowMaster` | The name the sidebar shows. Only read the first time the installation starts. |

## Running plans

| Variable | Read by | Default | Description |
|---|---|---|---|
| `WORKER_CONCURRENCY` | worker | `1` | Plans one worker process runs at once. |
| `RUN_MAX_PARALLEL` | worker | `16` | The most browser sessions one run opens at once, whatever the plan asks for. |
| `ORG_MAX_CONCURRENT_RUNS` | both | `2` | Runs of one organization in progress at once. Further runs wait. |
| `ORG_MAX_QUEUED_RUNS` | web | `100` | Runs of one organization waiting at once. Past it, a new run is refused with `429`. |
| `TENANT_QUOTA_MODE` | both | `enforce` | `off`: free unlimited quota policy, no execution metering; `monitor`: measure only; `enforce`: apply limits. Per-organization override available. Payment is independent. |
| `ORG_MAX_TESTS` | both | `0` | Saved UI/BDD + API + mobile definitions. Zero is unlimited. |
| `ORG_MAX_ARTIFACT_BYTES` | both | `0` | Retained evidence and baselines in bytes. Zero is unlimited. Reconcile inventory before finite enforcement. |
| `ORG_MAX_MONTHLY_EXECUTION_MINUTES` | both | `0` | Occupancy admission budget for the UTC month. Zero is unlimited; admitted work may finish beyond it. |
| `RUN_DEFERRAL_MS` | worker | `10000` | How long a run held back by its organization's limit waits before it is looked at again, when no run of the organization ending has started it first. |
| `RUN_HEARTBEAT_INTERVAL_MS` | both | `15000` | How often a worker confirms that a run is still going. |
| `WORK_ITEM_HEARTBEAT_MS` | worker | `15000` | In a run shared by several workers, how often a worker confirms the tests it holds. |
| `STALE_CLAIM_MS` | worker | `120000` | In a run shared by several workers, how long a held test may go without a heartbeat before another worker takes it back. |
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
| `MAILPIT_URL` | both | none | The test inbox **Wait for email** steps read when the environment names none (`mailpit.url`), e.g. `http://mailpit:8025`. The docker-compose stack sets it to its bundled Mailpit. On an installation shared by several companies leave it unset and let each environment name its own: one inbox for everyone lets a test read another company's mail, if it can guess the address. See [emails](../guide/web-tests#emails). |
| `MAILPIT_USERNAME`, `MAILPIT_PASSWORD` | both | none | Basic authentication for that inbox, when it asks for it. |
| `INSECURE_TLS_HOSTS` | both | none | Comma-separated `host:port` values allowed to present a certificate Node would reject (a self-signed dev server). Per host, never global, and ignored when `NODE_ENV=production`. |
| `LIGHTHOUSE_BIN` | both | `lighthouse` | The Lighthouse program **Lighthouse audit** steps run. The Docker images include it; elsewhere `npm install -g lighthouse@12`. See [page speed](../guide/web-tests#page-speed). |
| `LIGHTHOUSE_TIMEOUT_MS` | both | `120000` | How long one Lighthouse audit may take. |
| `CHROME_PATH` | both | Playwright's Chromium | The browser Lighthouse audits in. |

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

## Mobile app tests

| Variable | Read by | Default | Description |
|---|---|---|---|
| `MOBILE_INSPECTOR_IDLE_MS` | web | `300000` (5 minutes) | How long a mobile inspector session may stay silent before the device session is closed and the grid released. |

## AI features (optional)

| Variable | Read by | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | both | none | Google Gemini key. Without it, describing a test in sentences, AI selector healing and AI failure analysis are off; everything else works. |
| `GEMINI_MODEL` | web | `gemini-2.0-flash` | The model used to turn sentences into steps and to analyse failures. Healing uses its own. |
| `GEMINI_BASE_URL` | both | Google's | Another address for the same Gemini API: a proxy, or a test double such as the one in the collaudo stack. |
| `DEBUG_IDLE_TIMEOUT_MS` | both | `900000` (15 minutes) | How long a paused debug session waits for a command before it closes its browser. Shorten it only on a test installation. |

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

## Organization email settings

Owners configure SMTP mode, credentials, sender and tracking provider in **Settings → Security → Organization email**. Installation SMTP variables remain defaults for inherited sending and system messages without an organization. Custom SMTP and disabled mode are specific to the trusted organization, including pre-authentication password resets and worker notifications. Keep the same persistent `ENCRYPTION_KEY` on API and worker instances so encrypted organization credentials remain readable; never place provider secrets in a public client variable.

For custom SMTP, allowlist the provider host and SMTP port in the deployment's hardened HTTP CONNECT proxy policy. `WFM_EGRESS_PROXY` is mandatory when configured; there is no direct fallback. Permit STARTTLS (usually 587) or implicit TLS (usually 465), retain certificate verification, and keep private/metadata destinations denied. The organization's settings do not change this infrastructure policy.

Publish a stable HTTPS application origin accessible to the provider and route `/api/mail-deliveries/providers/<callbackId>` to the application with request bodies and signature headers intact. SES/SNS uses the exact configured topic ARN and original message headers; SendGrid requires its public webhook verification key; Mailgun requires its webhook signing key. Native callbacks need no external adapter for those three providers. Other providers use generic normalized HMAC events. See [E-mail](./administration#e-mail) for setup and template editing.

## Native API protocol credentials

Migration 0078 adds optional protocol configuration to API tests. TLS/mTLS identity is configured per test using encrypted secrets in its selected organization environment, rather than an installation-wide client certificate. API and worker must share the persistent `ENCRYPTION_KEY`. Use exact secret variable names beginning with `secret_`; rotate PEM/passphrase values in the environment without modifying published snapshots. [API tests](../guide/api-tests#protocols) documents fields and limits.

Rebuild API, worker and agent images, or distribute agent 1.2.0 plus its setup dependencies (including Zod). Advanced requests require the signed `native-protocol-v2` capability across every relay instance. Keep the relay behind authenticated HTTPS; only necessary resolved TLS fields travel within its session, never in tickets or shared directory entries. Allowlist destination domains/ports in the existing infrastructure policy; TLS custom trust does not grant network access or disable hostname verification.
