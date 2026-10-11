# WebFlowMaster

WebFlowMaster is a self-hosted platform for automated testing of web applications, HTTP APIs and native mobile apps.
Tests are built without code — recorded in a browser or assembled step by step — grouped into
plans and suites, and run on Chromium, Firefox and WebKit: on demand, on a schedule, or from a CI
pipeline. Results come back as reports with screenshots, videos, traces and network captures.

It is built for teams: organizations are isolated from one another by the database itself, and
people sign in with passwords and TOTP, or with their company's identity provider over OpenID
Connect or SAML.

## What it does

- **Web tests**: record a flow in a real browser or build it from actions (click, type, wait,
  assert…), with reusable step groups, element libraries and `{{variables}}` resolved per
  environment. Optional AI assistance (Google Gemini) proposes steps and repairs broken locators.
- **API tests**: requests with assertions and extracted values, OAuth 2.0 and other
  authentication, run on their own or inside a plan.
- **Mobile app tests**: Android and iOS apps through Appium on BrowserStack, LambdaTest or your own
  emulators and devices (via a local agent), with a live inspector to pick locators.
- **BDD tests**: versioned Gherkin scenarios executed with Cucumber on dedicated local agents.
- **Requirements and test management**: epics and stories with computed coverage; results published to
  TestRail, Xray and Zephyr Scale.
- **Plans, suites and schedules**: choose the tests, the browsers and how many run at once; run
  them now, on a cron schedule or from a webhook; quarantine flaky tests; get notified on
  completion.
- **Results**: a report per run with evidence for each step, history and trends, and exports to
  HTML, PDF, JUnit and Allure.
- **CI**: the `wfm` command-line tool, and ready-made integrations for GitHub Actions, GitLab CI,
  Jenkins and Azure Pipelines.
- **Local agents**: test applications the server cannot reach (an intranet, a staging
  environment behind a VPN) through an agent that runs inside that network and connects out.
- **Issue trackers and source hosts**: open issues in Jira or Azure DevOps from a failure, and
  report run status back to commits.
- **Administration**: organizations, projects, roles (owner, editor, viewer), invitations,
  scoped API keys and service accounts, single sign-on, an append-only audit log, quotas and
  data retention.

## Tech stack

| Layer     | Technologies                                                                                                       |
| :-------- | :----------------------------------------------------------------------------------------------------------------- |
| Client    | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, i18next (English, Italian, French and German) |
| Server    | Node.js, Express, Passport, openid-client                                                                          |
| Data      | PostgreSQL with row-level security (production), PGlite (local development), Drizzle ORM                           |
| Execution | Playwright; BullMQ workers on Redis or Valkey                                                                      |
| Docs      | VitePress                                                                                                          |

## Understand the suite and contribute

Start with the complete suite handbook ([English](./docs/en/internals/suite-handbook.md),
[Italian](./docs/it/internals/suite-handbook.md)), then the practical implementation guide
([English](./docs/en/internals/contributing-guide.md), [Italian](./docs/it/internals/contributing-guide.md)).
The [product audit](./docs/en/internals/product-audit.md) distinguishes implemented capabilities,
validation gaps and proposed additions. Build the documentation with `npm run docs:build` or export
the bilingual sections with `npm run docs:pdf`.

Customer materials: [brochure IT/EN](./marketing/brochure/README.md) and
[60-second presentation video IT/EN](./marketing/promo-video/README.md).

## Quick start with Docker

The fastest way to see the product running: PostgreSQL, Redis, migrations, the web process and a
worker, all from `docker-compose.yml`.

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

Open http://localhost:5000 and register: the first account creates the first organization and
becomes its owner. The stack refuses to start without the four secrets in `.env`, and the web
process refuses the public example values in production. Put TLS in front before anyone else
can reach it. The
[installation guide](./docs/en/admin/installation.md) covers real deployments.

## Local development

**Requirements:** Node.js 22 or later (24, in `.nvmrc`, is what CI and the images use) with npm 10, and Redis 6.2+ or Valkey (the Redis from
`docker-compose.yml` is enough). PostgreSQL is optional: without it the server uses PGlite, a
Postgres that lives in a local folder.

```bash
npm install
npm run install-client
npx playwright install chromium firefox webkit

cp .env.example .env            # then set SESSION_SECRET and ENCRYPTION_KEY
docker compose up -d redis      # or any Redis on localhost:6379
npm run db:migrate              # schema, the app_user role and the row-level security policies
```

Then, in two terminals:

```bash
npm run dev          # web process and client, on http://localhost:5000
npm run dev:worker   # runs plans and browser tasks; without it runs stay queued
```

`npm run dev:client` also exists: it serves the client alone on Vite's own port and proxies
`/api` to port 5000, for working on the interface with a separate server.

> **Always initialize with `db:migrate`, never `db:push`.** `db:push` creates the tables from
> `shared/schema.ts` without recording anything in the migration journal: `db:migrate` can no
> longer run afterwards, and the migrations that cannot be derived from the schema — the
> row-level security that isolates organizations, and the append-only grants on the audit log —
> are silently missing. The server and `db:migrate` recognize such a database and refuse to
> start, explaining the way out.

The variables are documented in [`.env.example`](./.env.example) and in the
[configuration reference](./docs/en/admin/configuration.md). The ones you will need first:

| Variable         | Purpose                                                                       |
| :--------------- | :---------------------------------------------------------------------------- |
| `DATABASE_URL`   | A `postgres://` connection string, or a folder for PGlite (`./data/local-pg`) |
| `REDIS_URL`      | Queues, sessions and schedules                                                |
| `SESSION_SECRET` | Signs session cookies                                                         |
| `ENCRYPTION_KEY` | 64 hex characters; encrypts stored secrets (AES-256-GCM)                      |
| `GEMINI_API_KEY` | Optional; without it the AI features are off                                  |

To generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Checks

```bash
npx tsc -b                               # types: server, client, shared code, scripts
npm run lint
npm test                                 # server tests (Vitest)
npm run test:client -- --run             # client tests
npm run docs:build                       # the documentation site, including dead links
```

## Running a plan from CI

A pipeline authenticates with an API key scoped to `runs:write` and `runs:read` (Settings → API
keys, preferably on a service account) and uses the `wfm` CLI, which the server itself
distributes, so it always matches the installation:

```bash
export WFM_URL=https://webflowmaster.example.com
export WFM_API_KEY=wfm_...

curl -fsSL "$WFM_URL/cli/wfm.mjs" -o wfm.mjs
node wfm.mjs run <planId> --wait --junit junit.xml --html report.html
```

The exit code is the interface: `0` the run passed, `1` it failed, `2` the command could not run
(credentials, network, usage). Inside a CI the CLI also sends the repository, commit, branch and
build link, which appear in the report and in notifications. Ready-made integrations are in
[`integrations/`](./integrations); for GitHub Actions:

```yaml
- uses: Markg981/WebFlowMaster/integrations/github-action@main
  with:
    url: ${{ vars.WFM_URL }}
    api-key: ${{ secrets.WFM_API_KEY }}
    plan: ${{ vars.WFM_PLAN_ID }}
```

See the [CI integration guide](./docs/en/CI_INTEGRATION.md) and the
[CLI reference](./docs/en/reference/cli.md).

## Documentation

The documentation is a VitePress site in `docs/`, in English and Italian. `npm run docs:dev`
serves it locally, `npm run docs:build` builds it, and `npm run docs:pdf` writes one PDF per
section to `docs/pdf/`.

- [User guide](./docs/en/guide/index.md): building, organizing and running tests, and reading
  the results.
- [Installation and administration](./docs/en/admin/installation.md): installing, operating,
  configuring and administering an installation.
- [Security](./docs/en/security/index.md): isolation, identity, encryption, audit, and a
  hardening checklist.
- [Reference](./docs/en/reference/api.md): the `/api/v1` REST API and the `wfm` CLI.
- [Architecture and internals](./docs/en/internals/index.md): processes, tenancy, the run
  lifecycle, the data model, the developer guide and design decisions.
- [Local agents](./docs/en/LOCAL_AGENT.md): testing applications inside a private network.

**New to the project?** Start with [WebFlowMaster at a glance](./docs/en/overview.md). For the architecture in
diagrams: [system architecture](./docs/en/internals/system-architecture.md),
[class diagrams](./docs/en/internals/class-diagrams.md),
[database schema](./docs/en/internals/database-schema.md),
[sequence diagrams](./docs/en/internals/sequences.md) and the
[mobile subsystem](./docs/en/internals/mobile.md). Each page also exists in Italian under `docs/it/`.

For acceptance testing, [`collaudo/`](./collaudo/README.md) starts a complete environment — HTTPS,
a Keycloak identity provider, simulated TestRail/Jira/GitHub/Gemini, Jenkins, an Android emulator, a
private network for the local agent — on which the manual test protocol runs (instructions in Italian;
the [test lab](./docs/en/admin/test-lab.md) page explains it in English).

## Contributing

Work on a branch and open a pull request against `main`. Before opening it, run the checks above;
a change to the database schema comes with a migration in `migrations/`, and a change people can
see comes with the documentation that describes it.

## License

WebFlowMaster is proprietary software, licensed commercially. The source being readable here
grants no right to use, copy, modify or distribute it: that requires a separate written
commercial license. See [LICENSE](./LICENSE).

### Versioned releases / Release versionate

API, worker and agent release images use immutable registry digests, CycloneDX SBOMs and vulnerability gates. See [English release runbook](docs/en/admin/releases.md) / [procedura italiana](docs/it/admin/releases.md). Run `npm run test:release` for the packaging guards; complete image rebuilds and scans run in `.github/workflows/release.yml`.
