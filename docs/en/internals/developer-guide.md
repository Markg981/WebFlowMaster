# Developer guide

How to set up a development environment, run and test the product, and change it without breaking
the guarantees the rest of this documentation describes.

## Prerequisites

- **Node.js 20 or later** and npm.
- **Redis or Valkey** on `localhost:6379` for the queues (`docker compose up -d redis` is enough).
- **PostgreSQL 15+** only if you want to develop against it; otherwise PGlite (Postgres in
  WebAssembly, in a local directory) is used automatically.
- Playwright's browsers: `npx playwright install` (Chromium at least; Firefox and WebKit for matrix
  tests).

## First run

```bash
npm install                       # root and the client workspace
cp .env.example .env              # then set SESSION_SECRET and ENCRYPTION_KEY
npm run db:migrate                # creates the schema, the app_user role and the RLS policies
npm run dev                       # web process on http://localhost:5000, client through Vite
npm run dev:worker                # in a second terminal: runs plans and browser tasks
```

`ENCRYPTION_KEY` must be 64 hexadecimal characters. Generate both secrets with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

With `DATABASE_URL=./data/local-pg` the database is a PGlite directory. With a `postgres://` URL
it is PostgreSQL; the connection role must own the tables and be allowed to `SET ROLE app_user`
(the migrations grant it). `npm run db:doctor` tells you which state the schema is in and what to run.

::: warning Do not use `db:push`
`drizzle-kit push` creates tables without recording migrations and without the row-level security
policies; `db:migrate` then fails on the first existing table. Use `db:migrate` only.
:::

To work on the builder alone without a worker, set `BROWSER_TASKS=inline`: previews and page
surveys then run in the web process. Recording always opens its window on the machine running the
web process.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` / `npm run dev:worker` | Web process / worker, with `tsx` and `.env`. |
| `npx tsc -b` | Type-checks server, client, shared and scripts. |
| `npm run lint` | ESLint over `.ts` and `.tsx`. |
| `npx vitest run --config vitest.config.ts` | Server and scripts tests. |
| `npm run test:client -- --run` | Client tests. |
| `npm run test:rls` | The tenancy and isolation tests alone. |
| `npm run build` | Client, server, worker, migrator, CLI and agent bundles into `dist/`. |
| `npm run docs:dev` / `npm run docs:build` | This documentation site: live / checked build. |
| `npm run cli -- run <planId> --wait` | The pipeline CLI against your local server. |
| `npm run agent` | A local agent against your local server (`WFM_URL`, `WFM_AGENT_TOKEN`). |

Before a change is committed, all four checks must pass: `tsc -b`, `lint`, the server tests and
the client tests (and `docs:build` when documentation changed).

## How the tests work

### Server

- Vitest runs each test file in its own process with its **own in-memory PGlite database**;
  `server/tests/setup.ts` applies every migration to it first. Files therefore run in parallel
  without sharing state.
- Route tests build a small Express app with the router under test, a fake `req.user`, and
  `runWithTenant` around the request, then call it with **supertest**.
- Factories in `server/tests/factories.ts` create organizations and users; everything else is
  inserted with `privilegedDb` in the test.
- Code that talks to the outside world is tested against **fakes over real HTTP** (a local server
  that plays GitHub, Jira or an intranet), not against mocks of `fetch`, so the actual request is
  exercised.
- Where a browser matters, tests use a **real Chromium**: the step executor, the relay and the
  agents are tested end to end.
- Mock the logger in files that import modules using it:
  `vi.mock('./logger', () => ({ default: Promise.resolve({ info: vi.fn(), ... }) }))`.

### Architecture tests

A few tests guard properties no single feature test would notice. When one fails, it is telling you
to make a decision explicit, not to work around it:

| Test | Guards |
|---|---|
| `server/tests/architecture.test.ts` | Routes do not import the privileged handle; each file that does stays within its `PRIVILEGED_BOOTSTRAP_BUDGET`; every Dockerfile's Playwright image matches the locked Playwright version; the lockfile describes every platform; compose services name existing Dockerfiles. |
| `server/tests/isolation.test.ts` | Every table in `ORG_SCOPED_TABLES` has RLS and hides other organizations' rows. |
| `server/test-suites.test.ts` (drift) | Every foreign key between organization tables is same-organization guarded or declared as authorship. |
| `server/execution-snapshot.test.ts` | Every column of `test_plans` is either captured in the run snapshot or declared irrelevant to a run. |
| `server/api-v1/openapi.test.ts` | The OpenAPI document and the `/api/v1` router agree, route by route and scope by scope. |
| `server/audit-trail.test.ts` | Every audit action and category has a label in all four languages. |
| `client/src/locales/locales.test.ts` | Translation bundles are complete and consistent, and every key the code uses exists. |

### Known slow or sensitive tests

Real-browser tests take seconds each and can be slower under a full parallel run. Assert on what
the code decided (the message, the state), never on wall-clock durations that include starting a
browser.

## Conventions

### Code

- **Explain why, not what.** Modules and non-obvious functions open with a comment saying what the
  code decides and what went wrong without it. Match the surrounding comment density and style.
- **Separate decisions from effects.** Put the rules in a pure module (no database, no network) and
  test it directly; keep the module that touches the world thin.
- **Errors are sentences** a user can act on, and side effects (notifications, issues, statuses,
  uploads) never fail a run: they return an outcome and log.
- **Never return a secret** from the API, and show a generated token only in the response that
  created it.
- Use the shared types in `shared/` for anything both sides read (statuses, schemas, action ids).

### Database migrations

Migrations are **hand-written SQL** in `migrations/NNNN_name.sql`, each with an entry in
`migrations/meta/_journal.json` (`idx` = the number, `when` = a timestamp later than the previous
entry, `tag` = the file name without extension). Statements are separated by
`--> statement-breakpoint`. Open with a comment that explains what the change is for.

A new **organization-scoped table** needs, in the same migration:

1. `organization_id integer NOT NULL REFERENCES organizations(id)` and an index on it;
2. `ENABLE` and `FORCE ROW LEVEL SECURITY`, the `org_isolation` policy, and the grants `app_user`
   needs (leave out `DELETE` when rows are evidence);
3. the table added to `ORG_SCOPED_TABLES` in `shared/schema.ts`;
4. any foreign key to another organization table either guarded as same-organization or listed as
   authorship in the drift test.

Mirror the table in `shared/schema.ts` (Drizzle) with a comment explaining it. Apply with
`npm run db:migrate`; the tests apply all migrations to every test database.

### API

- Routes live in `server/routes/<area>.routes.ts` and are mounted in `server/routes.ts`.
- Guard every route with `requireRole(...)`; query inside `withTenantTransaction`.
- Validate bodies with zod and answer `400` with `details` on failure.
- Record security-relevant changes with `recordAudit(tx, …)` in the same transaction, and add the
  action to `AUDIT_ACTIONS` with labels in the four languages.
- The **public API** is `/api/v1` only (`server/routes/api-v1.routes.ts`): explicit response shapes,
  errors as `{ error: { code, message } }`, a scope on every endpoint, and the OpenAPI document in
  `server/api-v1/openapi.ts` updated in the same change.

### Client

- Every visible string goes through `t('area.key', 'English text')`, with the key added to all four
  bundles (see [Web client](./frontend#internationalization)).
- Server state through TanStack Query; invalidate the query keys a mutation affects.
- Hide what the user's role cannot do, but never rely on it: the server decides.

### Dependencies

`npm install` on Windows drops the optional `@emnapi/*` entries from `package-lock.json`, which
breaks installs on Linux; the architecture test catches it. After adding a dependency on Windows,
restore those entries from the committed lockfile before committing.

The Playwright version is pinned three times: `package-lock.json`, the `FROM` line of every
Dockerfile, and the agent's compatibility (major.minor). Upgrade them together.

## Adding a feature: checklist

1. Schema and migration (with RLS if organization-scoped), and the snapshot test's decision if you
   added a plan column the runner reads.
2. Pure decision module with its tests; thin effectful module with its tests against fakes.
3. Routes with roles, validation, tenancy, audit; `/api/v1` and OpenAPI if pipelines need it.
4. Client: components, translations in four languages, tests.
5. Documentation: the relevant guide in `docs/en` and `docs/it`, and this site builds.
6. `tsc -b`, `lint`, server tests, client tests — all green — then a commit whose message explains
   the change in prose.

## Documentation

This site lives in `docs/` and is built with VitePress. English pages are in `docs/en`, Italian in
`docs/it`, page for page with the same file names; the sidebar is in `docs/.vitepress/config.mts`.
Diagrams are Mermaid code blocks. `npm run docs:build` fails on a dead link.
