# Operations

Running an installation after it is up: upgrading it without cutting runs in half, backing it
up so it can be brought back, reading its logs, and what to look at when something is wrong.

## Upgrading

A release can change the database schema, so the order matters.

1. **Drain the runners.** In **Settings → Runners**, drain each runner. A draining runner
   finishes what it has and takes nothing new; wait until its running count is zero. Runs
   requested meanwhile wait in the queue and start after the upgrade.
2. **Stop the web processes and workers.**
3. **Back up the database** (see [Backups](#backups)).
4. **Apply the migrations** with the new version: `node dist/apply-migrations.js`, or the
   `migrate` service in Compose (`docker compose up migrate`). `npm run db:doctor` reports the
   state of the schema and exits non-zero when something needs doing, so it can gate a
   deployment.
5. **Start the web processes, then the workers.** New workers register as new runners; the old
   entries show as offline and disappear after a week.

With Compose, `docker compose up -d --build` does steps 2, 4 and 5 in order, because `api` and
`worker` wait for `migrate` to finish.

**Local agents.** An agent's Playwright must have the same major and minor version as the
runners'. When a release changes the Playwright version, update the agents too (a new image,
or a new `wfm-agent.mjs` from `/cli/wfm-agent.mjs`). An agent with a different version stays
connected but is not chosen for runs, and **Settings → Local agents** shows why.

## Backups

| What | Where | How |
|---|---|---|
| **Database** | PostgreSQL | `pg_dump`, or the managed service's snapshots. Everything the product knows is here. |
| **`ENCRYPTION_KEY`** | Your secret manager | Stored separately from the database backup. Without it the encrypted secrets in a restored database are unreadable. |
| **Artifacts** | `results/` and `data/visual-baselines/`, or the S3 bucket | File or bucket backups. Visual baselines are the ones that matter: losing them means approving new ones. Screenshots, videos and traces are removed by retention anyway. |
| **Redis** | Redis | Optional. It holds queues, sessions and the BullMQ schedules, which are rebuilt from the database when the web process starts. |

If Redis loses its data, everyone is signed out, and runs that were waiting in the queue stay
*queued* without starting: cancel them and start them again.

### Restoring

1. Restore the database into an empty PostgreSQL server with the same roles. After a restore,
   check that the connecting role is still a member of `app_user` and has `BYPASSRLS`: dumps do
   not carry role attributes, and the web process refuses to start without them (see
   [Prepare PostgreSQL](./installation#prepare-postgresql)).
2. Start the processes with the same `ENCRYPTION_KEY`.
3. Restore the artifacts to the same paths or bucket keys; the reports refer to them by path.

## Artifact retention

Screenshots, videos and traces of runs that ended more than `ARTIFACT_RETENTION_DAYS` days ago
(default 90) are removed by the web process. The runs themselves, their results, steps and
verdicts stay, and the report says when the pictures were removed. Visual baselines are never
removed. `0` keeps everything.

## Logs

Both processes log structured JSON:

- to standard output (readable text in development, JSON in production), for the container
  platform to collect;
- to `logs/app-YYYY-MM-DD.log` next to the application, rotated daily, compressed, and removed
  after the log retention period (7 days by default);
- to Grafana Loki, when `LOKI_URL` is set. `docker-compose.observability.yml` starts Loki and a
  Grafana with Loki already configured as a data source.

Every request line carries a correlation id, which the web client also sends and shows in error
messages. A person reporting "it failed" can give you the id, and it finds every line of that
request. Passwords, tokens and secret values are masked before a line is written.

**Log level and retention** are installation-wide settings in **Settings → System**, stored in
the database. `LOG_LEVEL` and `LOG_RETENTION_DAYS` only provide the value the first time the
installation starts; after that the saved setting wins. A new log level applies at once to the
web process that saved it; other processes pick it up when they restart, and so does a new
retention period.

## Monitoring

| What | Signal |
|---|---|
| Web process alive | `GET /api/user` answers `401` to an anonymous request. `5xx` or no answer means down. |
| Workers | **Settings → Runners**: online, draining or offline, with running jobs and version. A runner not heard from for `RUNNER_OFFLINE_AFTER_MS` is offline. |
| Queue pressure | **Settings → Run usage**: runs in progress and waiting for the organization, against its limits, and how many runners are online. |
| Lost runs | Runs ending as *error* with reason `worker_lost`: a worker died or was restarted mid-run. |
| Timeouts | Runs ending as *timed out*: past `RUN_MAX_DURATION_MS`. |
| Integrations | Delivery errors are shown on each GitHub/GitLab connection and issue tracker in Settings. |

## Capacity and limits

Three numbers decide how much runs at once; see the
[configuration reference](./configuration#running-plans) for each.

- **Per worker:** `WORKER_CONCURRENCY` plans at once, and `BROWSER_TASK_CONCURRENCY` previews
  and page loads at once, on a separate queue.
- **Per run:** the plan's own parallelism, capped by `RUN_MAX_PARALLEL` browser sessions.
- **Per organization:** `ORG_MAX_CONCURRENT_RUNS` in progress and `ORG_MAX_QUEUED_RUNS`
  waiting. Past the second, a new run is refused with `429`. Among waiting runs, an
  organization with fewer in progress goes first.

Limits for one organization are set on its row in the database. The application has no
permission to change these columns, so an organization cannot raise its own limits:

```sql
-- as the database owner; NULL goes back to the installation default
UPDATE organizations SET max_concurrent_runs = 5, max_queued_runs = 300 WHERE id = 42;
```

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| The server exits at startup naming `app_user`, `BYPASSRLS` or `SET ROLE` | The database roles are not as the tenancy design requires | Run the command in the message (see [Prepare PostgreSQL](./installation#prepare-postgresql)). |
| The server exits saying the database was created with `db:push` | Tables exist without the migration journal | `npm run db:doctor`; recreate the database with `db:migrate`. |
| `SESSION_SECRET must be set` or `ENCRYPTION_KEY is missing` | A secret is not set in that process | Set it (see [Secrets](./installation#secrets)); workers need `ENCRYPTION_KEY` too. |
| Saved secrets fail to decrypt after a move or restore | A different `ENCRYPTION_KEY` | Use the key the secrets were saved with; there is no other way to read them. |
| `Session Redis is not connected. Refusing to start in production` | Redis unreachable at startup | Check `REDIS_URL` and that Redis accepts connections from this machine. |
| Registration answers "Accounts on this installation are created by invitation" | `REGISTRATION=invitation` (the default) and an account already exists | Invite the person from **Settings → Members**, or set `REGISTRATION=open` if sign-up should be public. |
| Sign-in answers OK but the next page is signed out | Secure cookie over plain HTTP | Serve over HTTPS; for a local stack only, `SESSION_COOKIE_SECURE=false`. |
| `403` on every save behind a proxy | The public origin differs from the `Host` the server sees | Add it to `CSRF_TRUSTED_ORIGINS`. |
| Runs stay *queued* | No runner online, the organization at its limit, or runners drained | Settings → Runners and Settings → Run usage. |
| Runs end *error: worker lost* | Workers restarted or killed (often out of memory) | Worker logs and memory; lower `WORKER_CONCURRENCY` or the plan's parallelism. |
| Previews and page loads fail with "No worker is running to open a browser" | `BROWSER_TASKS=worker` and no worker running | Start a worker, or `BROWSER_TASKS=inline` on a single machine. |
| Previews and page loads answer `504` | The task took longer than `BROWSER_TASK_TIMEOUT_MS`, usually because the workers are busy | More workers or a higher `BROWSER_TASK_CONCURRENCY`. |
| Screenshots missing in reports | Worker and web process on different disks with the local store | `ARTIFACT_STORE=s3`. |
| Each schedule starts twice | Several web processes with `SCHEDULER_BACKEND=cron` | `SCHEDULER_BACKEND=bullmq` on all of them. |
| Runs on a local agent fail with "relay could not be reached" | Workers do not know where the relay is | `AGENT_RELAY_URL` on the workers; the same `AGENT_RELAY_SECRET` everywhere. |
| AI features are missing | No AI key | Set `GEMINI_API_KEY`; everything else works without it. |
