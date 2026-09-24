# Installation

This page takes an installation from nothing to a first signed-in owner: what to run, what it
needs, and the settings that must be right before anyone else can reach it. Every variable
named here is described in the [configuration reference](./configuration).

## What you are installing

WebFlowMaster is two programs built from one codebase, and two stores they share.

| Part | Command | What it does |
|---|---|---|
| Web process | `node dist/index.js` | The API, the web client, schedules, the local-agent relay, live logs, recording. |
| Worker | `node dist/worker.js` | Runs test plans and the browser tasks people wait for (previews, page loads, element detection). |
| PostgreSQL 15+ | | Everything the product knows. Row-level security isolates organizations. |
| Redis 6.2+ or Valkey | | The run queues, sessions and schedules. |
| Artifact store (optional) | | Screenshots, videos, traces and visual baselines, on the local disk or in an S3 bucket. |

The web process never starts a browser for a plan run; the workers do, and there can be as many
as the load needs. How the parts talk to each other is in the
[architecture overview](../internals/).

## Choose a layout

| Layout | Use it for | Database | Artifacts | Workers |
|---|---|---|---|---|
| **Single machine, from source** | Development, evaluation | PGlite (a directory) | Local disk | One, or none with `BROWSER_TASKS=inline` |
| **Docker Compose** | A team server, a pilot | PostgreSQL container | Local disk or S3 | Scale with `--scale worker=N` |
| **Production** | Several teams, uptime | Managed PostgreSQL | S3-compatible bucket | Several, on their own machines |

PGlite is Postgres compiled to WebAssembly and stored in a directory: convenient on a laptop, not
meant for production. Row-level security is only enforced as designed on a real PostgreSQL
server (see [Tenancy](../internals/tenancy)).

## Requirements

- **Node.js 20 or later** and npm 10, for installations from source.
- **Docker** with Compose v2, for the container layouts. The images are based on
  `mcr.microsoft.com/playwright:v1.61.1-jammy`, which already contains the browsers.
- **PostgreSQL 15 or later** for anything beyond evaluation.
- **Redis 6.2 or later, or Valkey**, reachable from the web process and every worker.
- Outbound network access from the workers to the applications under test, or a
  [local agent](../LOCAL_AGENT) inside the network where they live.
- Memory, as a rough guide: about 1 GB for the web process, and 1–2 GB on a worker for each browser it runs at once (`WORKER_CONCURRENCY` × the plan's parallelism). Measure with your own suites.

## Option 1: Docker Compose

The repository ships a `docker-compose.yml` that has been built and started end to end. It runs
Valkey, PostgreSQL, a one-off `migrate` service that applies the database migrations, the web
process (`api`) and one worker.

```bash
git clone https://github.com/Markg981/WebFlowMaster.git
cd WebFlowMaster
docker compose up -d --build
```

Open `http://localhost:5000` and register: the first account creates the first organization
and owns it (see [First sign-in](#first-sign-in)).

More workers, for more runs at once:

```bash
docker compose up -d --scale worker=3
```

::: warning The Compose file is a starting point, not a deployment
It starts out of the box, which means it contains values nobody should deploy. Before the
stack is reachable by anyone else:

1. Replace `SESSION_SECRET` and `ENCRYPTION_KEY` in every service with fresh values (see
   [Secrets](#secrets)). `ENCRYPTION_KEY` must be the same in `api`, `worker` and `migrate`.
2. Change the PostgreSQL password, and stop publishing ports `5432` and `6379` on the host.
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

| Condition | Why | Fix |
|---|---|---|
| The `app_user` role exists | Every query of an organization runs as it | Run the migrations |
| The connecting role is a member of `app_user` | It switches to it with `SET LOCAL ROLE` | `GRANT app_user TO <role>;` |
| The connecting role is a superuser or has `BYPASSRLS`, and `app_user` does not | The few installation-wide queries must see every row; tenant queries must not | `ALTER ROLE <role> BYPASSRLS;` (as a superuser) |

Some managed PostgreSQL services do not let customers grant `BYPASSRLS`; check that yours does
before choosing it. A typical setup:

```sql
-- as the administrator of the PostgreSQL server
CREATE ROLE webflowmaster LOGIN PASSWORD '…' BYPASSRLS;
CREATE DATABASE webflowmaster OWNER webflowmaster;
```

Then run the migrations as `webflowmaster`: migration `0005` grants it membership of `app_user`.
If the application later connects with a different role, grant the membership by hand.

`DATABASE_URL` takes the connection string:
`postgres://webflowmaster:…@db.internal:5432/webflowmaster`.

## Secrets

Three values protect the installation. Generate each one separately:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Protects | If it changes | If it leaks |
|---|---|---|---|
| `SESSION_SECRET` | Session cookies (and agent tickets, unless `AGENT_RELAY_SECRET` is set) | Everyone is signed out | Sessions can be forged: replace it |
| `ENCRYPTION_KEY` | Environment secrets, tracker and source-host tokens, saved login states, second-factor secrets | **Everything encrypted with it becomes unreadable** | Those secrets are exposed: rotate them at their source |
| `AGENT_RELAY_SECRET` | Tickets that let a runner borrow a local agent's browser | Runs on agents fail until every process has the new value | Anyone who can reach the relay could borrow agents' browsers |

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

- Set `SCHEDULER_BACKEND=bullmq` on all of them. With the default `cron`, each web process runs
  every schedule itself and a schedule starts once per process.
- Give every one the same `SESSION_SECRET`, `ENCRYPTION_KEY` and Redis: sessions are in Redis,
  so no sticky routing is needed.
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

## First sign-in

Open the web address and choose **Register**. An account registered without an invitation
creates a new organization and becomes its owner. Everyone else joins that organization through
an invitation (see [Members and invitations](./administration#members-and-invitations)).

::: warning Registration is open
Anyone who can reach the server can register and get an organization of their own, isolated
from the others. There is no setting that turns this off yet. If the installation is for one
company, keep it reachable only from that company's network or VPN.
:::

## Check the installation

| Check | How |
|---|---|
| The web process is up | `GET /api/user` answers `401` when signed out (the container healthcheck uses it). |
| Workers are running | **Settings → Runners** lists them as *online*. |
| A run works end to end | Create a test against a public page, add it to a plan, run it. |
| Evidence is served | The run's report shows its screenshots. |
| Links work | A notification or commit status links to the run at the public address. |

Next: [Operations](./operations) covers upgrades, backups, logs and troubleshooting.
