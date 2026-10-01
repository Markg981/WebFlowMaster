# Operations

Running an installation after it is up: upgrading it without cutting runs in half, backing it
up so it can be brought back, reading its logs, and what to look at when something is wrong.

## Upgrading

A release can change the database schema, so the order matters.

1. **Drain the runners.** In **Settings → Runners**, drain each runner. A draining runner
   finishes what it has and takes nothing new; wait until its running count is zero. Runs
   requested meanwhile wait in the queue and start after the upgrade.
2. **Stop the web processes and workers.**
3. **Back up the database**: `npm run backup:create` (see [Backups](#backups)).
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
| **Database** | PostgreSQL | `npm run backup:create` (below), `pg_dump`, or the managed service's snapshots. Everything the product knows is here. |
| **`ENCRYPTION_KEY`** | Your secret manager | Stored separately from the database backup, and never inside it. Without it the encrypted secrets in a restored database are unreadable. |
| **Artifacts** | `results/` and `data/visual-baselines/`, or the S3 bucket | Included by `backup:create` when the store is local; the bucket's own versioning or replication when it is S3. Visual baselines are the ones that matter: losing them means approving new ones. Screenshots, videos and traces are removed by retention anyway. |
| **Redis** | Redis | Optional. It holds queues, sessions and the BullMQ schedules, which are rebuilt from the database when the web process starts. |

If Redis loses its data, everyone is signed out, and runs that were waiting in the queue stay
*queued* without starting: cancel them and start them again.

### The backup tool

For the Docker Compose installation the repository ships, `scripts/wfm-backup.ts` does the three things
an operator needs, from the repository folder on the Docker host. It needs only Docker and Node:
`pg_dump` and `pg_restore` run in the `postgres` container, `tar` in the `api` container.

```bash
npm run backup:create                              # into ./backups/wfm-backup-<UTC time>/
npm run backup:verify  -- backups/wfm-backup-20261001-020000
npm run backup:restore -- backups/wfm-backup-20261001-020000 --yes
```

With another Compose project or extra files, pass them as to `docker compose`:
`npm run backup:create -- -p wfm-collaudo -f docker-compose.yml -f collaudo/docker-compose.collaudo.yml`.
`--db-name` and `--db-user` change the defaults (`webflowmaster`, `postgres`).

A backup is a folder:

| File | Contents |
|---|---|
| `database.dump` | `pg_dump --format=custom --no-owner`: tables, data, grants, row-level security policies. |
| `results.tar`, `visual-baselines.tar` | The run evidence and the visual baselines (local store only). |
| `manifest.json` | When and from which version it was taken; the number of applied migrations; how many tables have row-level security; exact row counts of the main tables; the size and SHA-256 of every file; a **fingerprint** of the encryption key (a hash of a hash: it identifies the key without revealing it). |

**`verify` is the restore drill.** It checks every file against its checksum, restores the dump into a
scratch database next to the live one (`webflowmaster_restore_check`), compares row counts, migrations,
row-level security and the `app_user` grants with the manifest, says whether the running installation
has the backup's key, and drops the scratch database. It touches nothing the installation uses, so it
can run every night after `create`: a backup that has never been restored is a hope, not a backup.

**`restore` replaces the installation's data.** In order, it:

1. checks the checksums, and **refuses** when the running installation has a different
   `ENCRYPTION_KEY` from the backup's (`--ignore-key` overrides it: the secrets must then be entered
   again) or when the backup comes from a newer version than the code (more migrations);
2. asks for `--yes`; without it, it says what would be lost and stops;
3. stops `api` and `worker`, drops and recreates the database, creates the `app_user` role if this
   PostgreSQL server does not have it, and restores the dump;
4. replaces the artifact folders with the archives;
5. runs `migrate`, which applies the migrations added since the backup, and starts `api` and `worker`;
6. compares the result with the manifest again.

To move an installation to a new server: install it there with `docker compose up -d` and the
**same** `ENCRYPTION_KEY`, copy the backup folder, run `backup:restore`. Sessions do not move with it:
people sign in again.

Exit codes: `0` done, `1` the check found a problem (a damaged file, a different count, a refused
restore), `2` the command could not be carried out (Docker not reachable, wrong arguments).

#### Scheduling it

A nightly backup with its drill, keeping fourteen days, from cron on the Docker host:

```bash
0 2 * * *  cd /opt/webflowmaster && npm run -s backup:create && \
           npm run -s backup:verify -- "$(ls -d backups/wfm-backup-* | tail -n 1)" && \
           find backups -maxdepth 1 -name 'wfm-backup-*' -mtime +14 -exec rm -rf {} +
```

Copy the folder off the host (object storage, another site): a backup on the same disk as the database
does not survive the disk.

### Restoring without the tool

For a managed PostgreSQL, or an installation not run with Compose:

1. Restore the database into an empty PostgreSQL server: create the `app_user` role first
   (`CREATE ROLE app_user NOLOGIN`), then `pg_restore --no-owner`. Check that the connecting role is a
   member of `app_user` and has `BYPASSRLS`: dumps do not carry role attributes, and the web process
   refuses to start without them (see [Prepare PostgreSQL](./installation#prepare-postgresql)).
2. Start the processes with the same `ENCRYPTION_KEY`. `node dist/apply-migrations.js` first if the code
   is newer than the backup.
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

## Recovering access {#recovering-access}

A member who forgot their password gets a reset link from an owner of their organization
(**Settings → Members**). When nobody can issue one — the organization's only owner is the one
locked out — the operator issues it from the command line, on a machine with the installation's
environment:

```bash
node dist/password-reset-link.js alice               # a built installation
docker compose exec api node dist/password-reset-link.js alice
npm run user:reset-link -- alice                     # from source
```

It prints a link, valid for a day and usable once, built on `WEBFLOW_PUBLIC_URL`. The
organization's audit log records that the operator issued it. Hand it to the person through a
channel that confirms who they are.

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
  and page loads at once, on a separate queue. A [debug session](../guide/web-tests#debugging)
  holds one of those slots for as long as it is open, paused included — at most 15 minutes
  without a command, one session per person. Its state and commands travel through Redis.
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
| A blank page, or parts missing, with `Content Security Policy` errors in the browser console | Something injects or loads scripts from elsewhere (a proxy, a browser extension, a customized build) | Remove what injects them; to confirm the cause, `CONTENT_SECURITY_POLICY=report-only` and read the console. |
| Pipelines get `429 rate_limited` | A key made more than `API_RATE_LIMIT` calls in a minute | Poll less often, give each pipeline its own key, or raise `API_RATE_LIMIT`. |
| Settings → System is read-only, and the runners have no Drain button | Installation-wide settings are for its administrators | Add the username to `INSTALLATION_ADMINS` (see [Installation administrators](./administration#installation-administrators)). |
| Runs stay *queued* | No runner online, the organization at its limit, or runners drained | Settings → Runners and Settings → Run usage. |
| Runs end *error: worker lost* | Workers restarted or killed (often out of memory) | Worker logs and memory; lower `WORKER_CONCURRENCY` or the plan's parallelism. |
| Previews and page loads fail with "No worker is running to open a browser" | `BROWSER_TASKS=worker` and no worker running | Start a worker, or `BROWSER_TASKS=inline` on a single machine. |
| Previews and page loads answer `504` | The task took longer than `BROWSER_TASK_TIMEOUT_MS`, usually because the workers are busy | More workers or a higher `BROWSER_TASK_CONCURRENCY`. |
| Screenshots missing in reports | Worker and web process on different disks with the local store | `ARTIFACT_STORE=s3`. |
| Each schedule starts twice | Several web processes with `SCHEDULER_BACKEND=cron` | `SCHEDULER_BACKEND=bullmq` on all of them. |
| Runs on a local agent fail with "relay could not be reached" | Workers do not know where the relay is | `AGENT_RELAY_URL` on the workers; the same `AGENT_RELAY_SECRET` everywhere. |
| AI features are missing | No AI key | Set `GEMINI_API_KEY`; everything else works without it. |
