# Installation

This page takes an installation from nothing to a first signed-in owner: what to run, what it
needs, and the settings that must be right before anyone else can reach it. Every variable
named here is described in the [configuration reference](./configuration).

## What you are installing

WebFlowMaster is two programs built from one codebase, and two stores they share.

| Part                      | Command               | What it does                                                                                     |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| Web process               | `node dist/index.js`  | The API, the web client, schedules, the local-agent relay, live logs, recording.                 |
| Worker                    | `node dist/worker.js` | Runs test plans and the browser tasks people wait for (previews, page loads, element detection). |
| PostgreSQL 15+            |                       | Everything the product knows. Row-level security isolates organizations.                         |
| Redis 6.2+ or Valkey      |                       | The run queues, sessions and schedules.                                                          |
| Artifact store (optional) |                       | Screenshots, videos, traces and visual baselines, on the local disk or in an S3 bucket.          |

The web process never starts a browser for a plan run; the workers do, and there can be as many
as the load needs. How the parts talk to each other is in the
[architecture overview](../internals/).

## Choose a layout

| Layout                          | Use it for              | Database             | Artifacts            | Workers                                  |
| ------------------------------- | ----------------------- | -------------------- | -------------------- | ---------------------------------------- |
| **Single machine, from source** | Development, evaluation | PGlite (a directory) | Local disk           | One, or none with `BROWSER_TASKS=inline` |
| **Docker Compose**              | A team server, a pilot  | PostgreSQL container | Local disk or S3     | Scale with `--scale worker=N`            |
| **Production**                  | Several teams, uptime   | Managed PostgreSQL   | S3-compatible bucket | Several, on their own machines           |

PGlite is Postgres compiled to WebAssembly and stored in a directory: convenient on a laptop, not
meant for production. Row-level security is only enforced as designed on a real PostgreSQL
server (see [Tenancy](../internals/tenancy)).

## Requirements

- **Node.js 22 or later** and npm 10, for installations from source. 24 is the version CI and the images use (`.nvmrc`); the SQL Server driver does not install on 20.
- **Docker** with Compose v2, for the container layouts. The images are based on
  `mcr.microsoft.com/playwright:v1.63.0-resolute`, which already contains the browsers.
- **PostgreSQL 15 or later** for anything beyond evaluation. The supported range is 15 and 16, both
  exercised: `docker-compose.yml` ships `postgres:15-alpine`, CI runs the installation and isolation
  jobs on 16. Moving the database to a new major version is a dump and restore, not an in-place
  upgrade: take a verified backup first ([Operations](./operations#backups)).
- **Redis 6.2 or later, or Valkey**, reachable from the web process and every worker.
- Outbound network access from the workers to the applications under test, or a
  [local agent](../integrations/local-agents) inside the network where they live.
- Memory, as a rough guide: about 1 GB for the web process, and 1–2 GB on a worker for each browser it runs at once (`WORKER_CONCURRENCY` × the plan's parallelism). Measure with your own suites.

## Option 1: Docker Compose

The repository ships a `docker-compose.yml` that has been built and started end to end. It runs
Valkey, PostgreSQL, a one-off `migrate` service that applies the database migrations, the web
process (`api`) and one worker.

```bash
git clone https://github.com/Markg981/WebFlowMaster.git
cd WebFlowMaster
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
AGENT_RELAY_SECRET=$(openssl rand -hex 32)
EOF
docker compose up -d --build
```

The four secrets come from `.env` next to `docker-compose.yml` (or from the shell): without
them Compose stops with `required variable … is missing a value`. Keep `ENCRYPTION_KEY` with
your backups (see [Secrets](#secrets)). In production the web process also refuses the public
example values (`change-me`, the all-zero key and the values older versions of the Compose file
shipped) and names the variable to change.

Open `http://localhost:5000` and register: the first account creates the first organization
and owns it (see [First sign-in](#first-sign-in)).

More workers, for more runs at once:

```bash
docker compose up -d --scale worker=3
```

::: warning The Compose file is a starting point, not a deployment
It is meant for a first look on one machine. Before the stack is reachable by anyone else:

1. Generate the secrets in `.env` as above; never copy them from a guide or another
   installation. Compose passes the same `ENCRYPTION_KEY` to `api`, `worker` and `migrate`.
2. Stop publishing ports `5432` and `6379` on the host.
3. Put TLS in front of port 5000 and remove `SESSION_COOKIE_SECURE=false`.
4. With more than one worker, or workers on other machines, use `ARTIFACT_STORE=s3`: each
   container has its own disk, and the web process cannot serve a screenshot a worker wrote
   into its own.
   :::

## Option 2: from source

```bash
git clone https://github.com/Markg981/WebFlowMaster.git
cd WebFlowMaster
npm install                     # the client is an npm workspace and is installed too
npx playwright install --with-deps chromium firefox webkit
cp .env.example .env            # then edit it: see below
npm run db:migrate
```

For development, start the web process and a worker in two terminals (`npm run dev`,
`npm run dev:worker`) and the client dev server in a third (`npm run dev:client`); the
[developer guide](../internals/developer-guide) has the details.

For a production build on a machine or VM:

```bash
npm run build                   # client, server, worker, migrator, CLI and agent into dist/
node dist/apply-migrations.js   # apply migrations with the built migrator
NODE_ENV=production node dist/index.js
NODE_ENV=production node dist/worker.js   # on each worker machine
```

Run each process under a supervisor (systemd, a container orchestrator) that restarts it if it
exits. Both processes stop cleanly on `SIGTERM`.

::: danger Never initialize a database with `db:push`
`npm run db:push` creates the tables from the schema without the row-level security policies,
roles and grants the migrations add, and without recording anything in the migration journal.
Organizations would not be isolated, and `db:migrate` could never run afterwards. Always use
`db:migrate` (or `dist/apply-migrations.js`). The server refuses to start on a database in that
state and says how to recover.
:::

## Prepare PostgreSQL

The migrations create everything, including the `app_user` role that row-level security
applies to. What they cannot do is give the connecting role the rights that only a superuser
can grant. At startup the web process checks three conditions and refuses to boot, naming the
command to run, if one is false:

| Condition                                                                      | Why                                                                           | Fix                                             |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| The `app_user` role exists                                                     | Every query of an organization runs as it                                     | Run the migrations                              |
| The connecting role is a member of `app_user`                                  | It switches to it with `SET LOCAL ROLE`                                       | `GRANT app_user TO <role>;`                     |
| The connecting role is a superuser or has `BYPASSRLS`, and `app_user` does not | The few installation-wide queries must see every row; tenant queries must not | `ALTER ROLE <role> BYPASSRLS;` (as a superuser) |

Some managed PostgreSQL services do not let customers grant `BYPASSRLS`; check that yours does
before choosing it. A typical setup:

```sql
-- as the administrator of the PostgreSQL server
CREATE ROLE webflowmaster LOGIN PASSWORD '…' BYPASSRLS CREATEROLE;
CREATE DATABASE webflowmaster OWNER webflowmaster;
```

Then run the migrations as `webflowmaster`: migration `0003` creates `app_user`, which is what
`CREATEROLE` is for — without it the first migration stops with `permission denied to create
role` — and migration `0005` grants `webflowmaster` membership of it. Once the migrations have run,
`CREATEROLE` can be taken back (`ALTER ROLE webflowmaster NOCREATEROLE;`): no later migration and
nothing at run time needs it. If the application later connects with a different role, grant the
membership by hand.

`DATABASE_URL` takes the connection string:
`postgres://webflowmaster:…@db.internal:5432/webflowmaster`.

## Secrets

Three values protect the installation. Generate each one separately:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable             | Protects                                                                                       | If it changes                                             | If it leaks                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| `SESSION_SECRET`     | Session cookies (and agent tickets, unless `AGENT_RELAY_SECRET` is set)                        | Everyone is signed out                                    | Sessions can be forged: replace it                           |
| `ENCRYPTION_KEY`     | Environment secrets, tracker and source-host tokens, saved login states, second-factor secrets | **Everything encrypted with it becomes unreadable**       | Those secrets are exposed: rotate them at their source       |
| `AGENT_RELAY_SECRET` | Tickets that let a runner borrow a local agent's browser                                       | Runs on agents fail until every process has the new value | Anyone who can reach the relay could borrow agents' browsers |

`ENCRYPTION_KEY` has no rotation procedure: keep it in a secret manager, give the same value to
the web process, every worker and the migrator, and back it up separately from the database.
A database backup without the key cannot give those secrets back.

## Behind a reverse proxy

Terminate TLS in front of the web process and forward to its port (5000 unless `PORT` says
otherwise).

- **WebSockets.** Forward the `Upgrade` and `Connection` headers. Two features depend on them:
  live logs on `/ws` and the local-agent relay on `/api/agent/v1/`. Allow long-lived connections
  (an idle timeout of at least a few minutes) on those paths.
- **Forwarded headers.** The server trusts one proxy hop (`X-Forwarded-For`,
  `X-Forwarded-Proto`), which is what audit IP addresses and rate limits use. Put exactly one
  proxy in front of it, or the recorded addresses are the proxy's.
- **Origin.** State-changing requests must come from the same origin as the page. If the public
  address differs from the `Host` the server sees, list it in `CSRF_TRUSTED_ORIGINS`.
- **Cookies.** With `NODE_ENV=production` the session cookie is `Secure` and is only sent over
  HTTPS. Do not set `SESSION_COOKIE_SECURE=false` on a reachable installation.
- **Body size.** Uploaded files (a test's input files, imports) go through the proxy too: raise
  its request size limit (nginx allows 1 MB by default) to the largest file people will upload.
- Set `WEBFLOW_PUBLIC_URL` to the public address, so notifications and commit statuses link back
  to the run.

A minimal nginx site:

```nginx
server {
  listen 443 ssl;
  server_name webflowmaster.example.com;
  client_max_body_size 20m;

  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 1h;
  }
}
```

(`$connection_upgrade` is the usual `map $http_upgrade $connection_upgrade { default upgrade; '' close; }`
in the `http` block.)

## Several web processes

One web process is enough for most installations. To run several behind a load balancer:

- Leave `SCHEDULER_BACKEND` at its default, `bullmq`, on all of them: schedules live in Redis and
  a worker fires each once. With `SCHEDULER_BACKEND=cron`, each web process runs every schedule
  itself and a schedule starts once per process, so set `cron` only on a single web process with
  no worker (PGlite local development).
- Give every one the same `SESSION_SECRET`, `ENCRYPTION_KEY` and Redis: sessions and rate-limit
  counts are in Redis, so no sticky routing is needed and the limits hold across processes.
- If organizations use local agents, set `AGENT_RELAY_ADVERTISE_URL` on each to an address the
  others can reach it at (see [Local agents, internals](../internals/agents)).
- Use `ARTIFACT_STORE=s3`.

## Workers on other machines

A worker needs the same `DATABASE_URL`, `REDIS_URL` and `ENCRYPTION_KEY` as the web process,
plus:

- `ARTIFACT_STORE=s3` and the bucket settings, so what it records can be served and compared.
- `AGENT_RELAY_URL`: where to reach the web process's relay, if organizations use local agents.
  The default is the worker's own machine, which only works when both run on the same one.
- `AGENT_RELAY_SECRET` (or the same `SESSION_SECRET`) for the same reason.
- `WEBFLOW_PUBLIC_URL`, because the worker sends the notifications and commit statuses at the
  end of a run.
- The browsers: the Playwright image has them; elsewhere run
  `npx playwright install --with-deps`.

Each worker appears under **Settings → Runners** once it starts.

## Kubernetes with Helm

The chart in `deployment/helm/webflowmaster` deploys the same four pieces as the Compose file:
the web process (`api`), the workers, a migration Job that runs before every install and
upgrade, and the two volumes or an S3 bucket for evidence and baselines. PostgreSQL and Redis
are yours to provide (a managed service or an operator); the chart can also start a single-pod
PostgreSQL and Valkey for **evaluation only**, with no backups and no replication.

**Prerequisites.** Kubernetes 1.25 or later and Helm 3; the two images the release workflow
publishes (see [Reproducible releases](./releases)) reachable from the cluster; a PostgreSQL
prepared as in [Prepare PostgreSQL](#prepare-postgresql) and a Redis or Valkey; an ingress
controller that terminates TLS (the default annotations are the nginx controller's and keep
the WebSockets on `/ws` and `/api/agent/v1/` open); and, for S3 evidence, a bucket.

**Install.** Put the secrets in a values file kept out of version control (or create a
Secret yourself with the keys `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`,
`ENCRYPTION_KEY`, `AGENT_RELAY_SECRET` and name it in `secrets.existingSecret`). The chart
refuses to render without them, as the Compose file refuses to start:

```yaml
# my-values.yaml
image:
  repository: ghcr.io/OWNER/REPOSITORY-api
  workerRepository: ghcr.io/OWNER/REPOSITORY-worker
  tag: 1.3.0
config:
  publicUrl: https://webflowmaster.example.com
secrets:
  databaseUrl: postgres://app_user:...@database.internal:5432/webflowmaster
  redisUrl: redis://queue.internal:6379
  sessionSecret: '...' # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  encryptionKey: '...' # 64 hexadecimal characters; keep it with the database backups
  agentRelaySecret: '...'
ingress:
  enabled: true
  hosts:
    - host: webflowmaster.example.com
      paths: [{ path: /, pathType: Prefix }]
  tls:
    - secretName: webflowmaster-tls
      hosts: [webflowmaster.example.com]
```

```bash
helm install webflowmaster deployment/helm/webflowmaster -n webflowmaster --create-namespace -f my-values.yaml
```

Migrations run as a `pre-install`/`pre-upgrade` hook Job (`node dist/apply-migrations.js`,
the api image); the release is only installed once the Job succeeds, and a failed migration
leaves the previous release untouched. Register the first account as soon as the api is
ready (`/readyz` answers 200): see [First sign-in](#first-sign-in). Every knob is documented
in the chart's `values.yaml`; `values.schema.json` rejects a values file that names an unknown
key or a value the application would refuse.

**Upgrade and rollback.** `helm upgrade` with the new `image.tag` applies the migrations
first, then rolls the api and the workers; a worker drains its runs for up to
`config.workerShutdownGraceMs` before it stops, and the pod's grace period is derived from
that value. `helm rollback` restores the previous manifests but **not** the schema: as in
[Reproducible releases](./releases#upgrade-rollback-and-evidence), roll back by restoring the
verified pre-upgrade database and artifacts during a controlled outage, unless the previous
images are known to work with the new schema. A change to `config` rolls the pods (the
Deployments carry a checksum of the ConfigMap); a change to the Secret requires
`kubectl rollout restart`.

**Scaling.** `worker.replicaCount`, or `worker.autoscaling` (CPU) or `worker.keda` (a KEDA
`ScaledObject` on the Redis list `bull:test-execution-queue:wait`, the queue's backlog), scale
the workers; `api.replicaCount` or `api.autoscaling` the web process. More than one replica of
either needs what [Several web processes](#several-web-processes) and
[Workers on other machines](#workers-on-other-machines) describe: `config.schedulerBackend:
bullmq` for several api replicas, and `artifacts.store: s3` (or `ReadWriteMany` claims) so
every replica serves the evidence the others wrote. `AGENT_RELAY_URL` and
`WEBFLOW_PUBLIC_URL` are set by the chart. With `metrics.enabled`, `/metrics` is exposed on
each pod and a `ServiceMonitor` (`metrics.serviceMonitor.enabled`) scrapes it under the job
names `observability/prometheus-alerts.yml` expects; `PodDisruptionBudget`s and a default-deny
`NetworkPolicy` are available behind `api.podDisruptionBudget`, `worker.podDisruptionBudget`
and `networkPolicy.enabled`.

**What is validated.** No cluster was used to test this chart. `npm run test:helm`
(`scripts/helm-chart.test.mjs`) checks it statically: `Chart.yaml`, that `values.yaml`
satisfies `values.schema.json`, that every `.Values` reference in the templates is declared,
that the control structures balance and the YAML around them is well formed, and that the
chart agrees with the repository (the secrets the Compose file demands, the commands the
Dockerfiles run, the probe paths, the metrics ports, the queue name, the Prometheus job names).
It does not render the templates with Helm: run `helm template` and `helm lint` yourself, and
try the release in a staging namespace before relying on it.

## First sign-in

Open the web address and choose **Register**. The first account on the installation creates the
first organization and becomes its owner. After that, who may register depends on
`REGISTRATION`:

| `REGISTRATION`         | Without an invitation                                           | With an invitation              |
| ---------------------- | --------------------------------------------------------------- | ------------------------------- |
| `invitation` (default) | Refused, except for the installation's first account            | Joins the inviting organization |
| `open`                 | Anyone who reaches the server gets an organization of their own | Joins the inviting organization |

Keep the default for an installation that serves one company, and invite people from
**Settings → Members** (see [Members and invitations](./administration#members-and-invitations)).
Use `open` only for a service that offers sign-up to the public.

::: warning Register the first account yourself
Until the first account exists, whoever reaches the registration page first becomes the owner
of the first organization. Register it as soon as the installation starts, before it is
reachable by others.
:::

## Check the installation

| Check                  | How                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------- |
| The web process is up  | `GET /api/user` answers `401` when signed out (the container healthcheck uses it). |
| Workers are running    | **Settings → Runners** lists them as _online_.                                     |
| A run works end to end | Create a test against a public page, add it to a plan, run it.                     |
| Evidence is served     | The run's report shows its screenshots.                                            |
| Links work             | A notification or commit status links to the run at the public address.            |

Next: [Operations](./operations) covers upgrades, backups, logs and troubleshooting.

To deploy versioned images with SBOMs, scans and immutable digests, follow [Reproducible releases](./releases).
