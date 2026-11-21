# Data fixtures: building a test's data prerequisites by script

Date: 2026-11-19. Extends [preconditions](../../en/guide/web-tests.md#preconditions) and the
`queryDatabase` step.

## Problem

A test assumes data: a customer with an open contract, a user with a role, a product in stock.
On a populated database that data happens to exist. On an empty or freshly restored database
(a new environment, a CI database, a local DMO, the candidate side of a comparison) the test
fails for reasons that have nothing to do with the application.

What WFM has today:

- **Preconditions** (`tests.preconditions`, `server/runtime/precondition-runner.ts`) already
  follow the right pattern, _check → apply if missing_, but only as HTTP calls. The runner says
  "never raw DB".
- **`queryDatabase`** (`server/runtime/database-step.ts`) speaks pg, MySQL and SQL Server, with
  egress vetting and redaction, but only as a step inside the test, only from the server or
  worker (never through a local agent), and without transactions, parameters or verification.
- Hub cases carry the prerequisite as free text (`hub_test_cases.precondition`), which becomes
  a manual step.

So the prerequisite logic ends up copied into the steps of every test, is not idempotent, does
not run where the database is (local agent), and is not reported.

## Goal

A test **declares** the data it needs. Before the test runs, WFM verifies each prerequisite
against the target database and, only when it is missing, runs the script that creates it,
verifies the result, exposes the created keys as variables, and (optionally) removes what it
created at the end. The same declaration works on an empty database and on a full one.

Non-goals: generic database migration tooling, schema management, production data changes,
synthetic data generation at volume.

## Principles

1. **Declarative and idempotent.** A prerequisite is a desired state, not a script to run
   blindly. Every fixture has a `check`. Running a plan twice must not duplicate data.
2. **Verify after apply.** After `apply`, the `check` runs again. A script that "succeeded" but
   did not establish the state fails the prerequisite with a clear reason.
3. **Reusable and versioned.** Fixtures live in a library, are versioned like tests, and are
   frozen into the run definition (reproducibility, same as tests today).
4. **Composable.** Fixtures depend on fixtures (contract → customer). WFM resolves the graph,
   deduplicates and orders it.
5. **Safe by default.** Data setup is off on every environment until enabled; it uses its own
   least-privilege credential; values are bound as SQL parameters, never spliced into text; a
   database identity guard blocks running against the wrong database.
6. **Runs where the database is.** Server/worker or local agent, chosen like the browser.
7. **Observable.** Each fixture appears in the report with check/apply/verify, timings,
   outputs and redacted errors.

## Model

### Data fixture (library item)

Organization + project scoped, versioned (`data_fixtures`, `data_fixture_versions`).

| Field        | Meaning                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| `key`        | Stable slug, unique per project (`customer-with-contract`). Used in variables and deps.    |
| `kind`       | `sql` (this design) or `http` (today's precondition, so one library covers both).          |
| `connection` | Connection name: resolves `db.<name>.setup.url`, else `db.<name>.url`. Default `default`.  |
| `params`     | Typed inputs `{name, type: string/int/decimal/bool/date, required, default}`.              |
| `check`      | Read-only query. Satisfied when it returns ≥ 1 row (or `satisfiedWhen: "{{value}} == 1"`). |
| `apply`      | Script that creates the state. May contain several statements and SQL Server `GO` batches. |
| `outputs`    | Columns of the final `check` row exposed as `{{fx.<alias>.<column>}}` (e.g. `customerId`). |
| `teardown`   | Optional script that removes what `apply` created; receives params and outputs.            |
| `dependsOn`  | Other fixtures with param mapping (`customer: { code: "{{params.customerCode}}" }`).       |
| `timeoutMs`  | Per fixture, default 30 s, max 5 min.                                                      |
| `tags`       | For search and hub mapping.                                                                |

Example (SQL Server, DMO):

```yaml
key: customer-with-contract
connection: dmo
params:
  - { name: customerCode, type: string, default: 'WFM-{{run.tag}}' }
  - { name: contractType, type: string, default: 'STD' }
dependsOn:
  - { fixture: customer, as: customer, params: { code: '{{params.customerCode}}' } }
check: |
  SELECT c.ContractId AS contractId
  FROM dbo.Contract c
  WHERE c.CustomerId = {{fx.customer.customerId}} AND c.Type = {{params.contractType}}
apply: |
  INSERT INTO dbo.Contract (CustomerId, Type, StartDate)
  VALUES ({{fx.customer.customerId}}, {{params.contractType}}, CAST(GETDATE() AS date));
outputs: [contractId]
teardown: |
  DELETE FROM dbo.Contract WHERE ContractId = {{fx.self.contractId}};
```

Every `{{…}}` inside SQL becomes a **driver parameter** (`@p0` / `$1` / `?`), never text. A
placeholder in an identifier position (table, column) is rejected at save time.

### Reference from a test

`tests.preconditions` gets a discriminated `kind` (missing = `http`, so existing data is
unchanged):

```json
{
  "kind": "fixture",
  "fixtureId": "…",
  "version": "latest",
  "as": "contract",
  "params": { "contractType": "PREMIUM" },
  "scope": "test",
  "teardown": "onSuccess"
}
```

- `scope`: `test` (once per test, default), `row` (once per dataset row), `plan` (once per
  run, shared by every test that references the same fixture with the same params).
- `teardown`: `always`, `onSuccess` (keep data to debug a failure), `never`.
- Hub case and BDD imports can reference fixtures the same way.

### Environment settings

On `environments`: `dataSetup: 'disabled' | 'enabled'` (default `disabled`) and, per
connection, an optional identity guard secret `db.<name>.expect` (e.g. `DMO_TEST@sqlsrv01`),
compared with `SELECT DB_NAME(), @@SERVERNAME` (pg: `current_database()`, MySQL: `DATABASE()`)
before any `apply`. A mismatch stops the run before writing anything.

## Execution

### Where it plugs in

| Scope  | Point                                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan` | New phase `setupFixtures` in `plan-run/pipeline.ts` between `freezeDefinitions` and `executeLanes`; `teardownFixtures` after `executeLanes`, also on cancel/failure. |
| `test` | `run-test.ts`, where HTTP preconditions run today (same policy, same `withCleanup`).                                                                                 |
| `row`  | Same place, inside the dataset row loop.                                                                                                                             |

Builder runs (`adhoc-runner.ts`) and BDD (`bdd-execution.ts`) use the same resolver, so a test
behaves the same in the editor and in a plan.

### Algorithm (per resolved node, in topological order)

```
bind params (defaults → test params → upstream outputs) ; unresolved → fail "missing input"
identity guard (once per connection per run)
CHECK            → satisfied?  ── yes → capture outputs → status "satisfied"
                    │ no
dataSetup enabled? ── no → fail "missing, data setup disabled on <env>"
BEGIN TRAN ; app-lock(hash(fixture, params)) ; APPLY ; COMMIT     (ROLLBACK on error)
CHECK again      → satisfied? ── no → fail "apply did not establish the state"
capture outputs → ledger row (applied=true) → status "applied"
```

- **Dedupe**: nodes with the same `(fixture version, bound params)` run once per scope.
- **Concurrency**: the application lock (`sp_getapplock`, `pg_advisory_xact_lock`,
  `GET_LOCK`) makes two parallel lanes asking for the same fixture safe: the second one waits,
  then its `check` finds the data.
- **Isolation between runs**: `{{run.id}}` and `{{run.tag}}` (short, unique) let fixtures
  create data that belongs to the run, so parallel runs and reruns never collide.
- **Failure**: maps to the existing `onTestCasePreRequisiteFailure` (stop / skip / continue).
  Plan-scope fixtures map to `onTestSuitePreRequisiteFailure`, which is reported as
  `notApplied` today and becomes real.

### Teardown and ledger

`fixture_ledger` (organization, run, scope, fixture version, params hash, outputs, applied,
teardown status). Teardown runs **only for rows this run applied**, never for data found
already present, in reverse order (LIFO), not fail-fast, without changing the test result
(same rules as `cleanup-runner.ts`). Rows left `pending` by a crashed worker are retried by
the existing cleanup job, so a killed run does not leave orphans forever.

### Where scripts run

A `DataRunner` interface with two implementations:

- **local**: server/worker, reuses `database-step.ts` (drivers, `vetDatabaseTarget`, timeout,
  redaction).
- **agent**: a new agent protocol operation `db.exec` (`shared/agent-protocol.ts`), chosen when
  the plan uses an agent pool, exactly as browser and HTTP already are. Needed for the DMO case:
  the database is on the Windows machine of the `dmo-local` pool and the server cannot reach it.
  The agent bundles the three drivers and gets connection strings only for the duration of
  the call.

The `queryDatabase` step moves to the same runner, which closes the gap "database steps never
go through the agent".

## Reporting

Each fixture becomes a report step of type `fixture` (name, alias, status
satisfied/applied/failed/skipped, check/apply/verify durations, outputs, redacted error), and
teardown a step of type `cleanup`. This also fixes the current gap where HTTP precondition
steps are only in the logs and not in `detailedLog`.

## Authoring

- **Library page** (_Test data → Fixtures_): SQL editor with dialect highlighting, params table,
  dependencies, outputs, version history.
- **Try it** on a chosen environment:
  - _Check only_: read-only, shows satisfied / missing and the outputs.
  - _Dry apply_: check → apply → verify inside a transaction that is always rolled back; shows
    what would happen with no side effects.
- **Test builder**: the preconditions panel gets _Add data fixture_ next to _Add API call_,
  with params form and a resolved-graph preview. Strings translated (fixes the current
  hard-coded English).
- **Hub**: when importing a case with precondition text, suggest matching fixtures by tags
  and text (later phase, optional AI).

## Security

| Risk                            | Control                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Writing to the wrong database   | `dataSetup` off by default per environment; identity guard before `apply`.     |
| SQL injection through variables | Every `{{…}}` is a bound parameter; identifier placeholders rejected at save.  |
| Over-privileged credential      | Separate `db.<name>.setup.url` (write) from `db.<name>.url` (read for checks). |
| Network reach                   | `vetDatabaseTarget` on the server; agent runs only for its own pool.           |
| Secret leakage                  | Existing `redactUrl` / `redactMessage`; outputs limited to declared columns.   |
| Unreviewed script changes       | Versioned fixtures, audit on create/update/delete/enable, frozen per run.      |
| Runaway scripts                 | Per-fixture timeout, row cap on outputs, single transaction per apply.         |

RBAC: editors create and change fixtures; enabling `dataSetup` on an environment requires
owner. Audit actions: `DATA_FIXTURE_CREATED/UPDATED/DELETED`, `ENVIRONMENT_DATA_SETUP_CHANGED`.

## Alternatives considered

- **Steps inside the test** (today's `queryDatabase`): not idempotent, not reusable, not
  verified, mixes setup with what is being tested. Kept for assertions on data.
- **Restore a baseline database before every run** (snapshot, backup, template DB): the
  strongest isolation, but slow, needs DBA rights and does not express _which_ data a test
  needs. Offered later as an optional environment-level reset that fixtures then build on.
- **Transaction rolled back around the test**: impossible, the application under test uses
  its own connections.
- **API-only setup**: preferred when the application exposes an API (business rules apply),
  which is why the library also holds `http` fixtures. SQL is for what the API does not offer.

## Decisions (confirmed 2026-11-19)

1. Fixture scope: project. The library (release 2) is per project.
2. `apply` is free SQL with guardrails: bound values only, placeholders refused inside quotes,
   dollar bodies and identifier positions, one transaction, re-check before commit.
3. Agent execution (`db.exec`) comes in release 3, before teardown.

## Release 1 as built

- Fixtures live in their own `data_fixtures` column on `tests` and `test_versions`
  (migration 0116), not inside the preconditions, so the existing preconditions keep their shape
  and the executable fingerprint of older versions does not change (the field enters the
  fingerprint only when set).
- `check` is satisfied by one row or more. `satisfiedWhen` is left out: a `WHERE` clause expresses
  the same and keeps one rule.
- Row scope (a fixture per dataset row) moves to release 4. Fixtures read environment and test
  variables, `run.id` and `run.tag`, never row values.
- Connection: `db[.<name>].setup.url`, else `db[.<name>].url`. Identity guard: `db[.<name>].expect`
  as `DATABASE` or `DATABASE@SERVER`, case-insensitive.
- The `environments.data_setup` flag is read at run start, not frozen in the run snapshot, so
  turning it off takes effect for the next run. It is changed by `PUT
/api/environments/:id/data-setup`: owner, session only, audited.
- Runs: UI runner, ad-hoc preview and BDD runs (once before the rows), from the server. Debug
  sessions do not run fixtures. The Playwright export reports them as unsupported.

## Release 2 as built

- Tables `data_fixture_library` (org, project, key, name, description, tags, current version) and
  `data_fixture_versions` (frozen definition, note, author), migration 0117, RLS on both, unique
  `(project, key)`. The definition is the release 1 fixture without its alias and entry id,
  plus `dependsOn: [{ fixture: key, as, params }]`.
- A test entry is either an inline fixture (release 1) or `{ kind: 'ref', alias, fixtureId,
version: 'latest' | n, params }`, in the same `data_fixtures` column: no new column, so no
  change to the execution snapshot decision list.
- `server/authoring/fixture-graph.ts` expands references depth first: dependencies before the
  fixture that needs them, a dependency's alias is `<caller>__<as>`, a dependency at the same
  version with the same bound values runs once (entries named by the test itself are not
  merged), a cycle fails with the chain. `dependsOn` names a key, not a version: a dependency
  always runs at its current version, also under a pinned reference, so pinning freezes the
  fixture named and not its chain. Each expanded step carries `source: "key vN"` for the report.
- Save-time checks: a test's references must belong to the project it is saved in; a library
  definition may read `{{fx.X.*}}` only for an `X` in its `dependsOn`; a new version that closes a
  cycle is refused.
- Freeze: `execution-definitions.ts` expands references when a run is queued, so the run snapshot
  holds plain fixtures and `latest` means the version current at enqueue. A reference that no
  longer resolves is left in place and the run fails on it with the reason, rather than the
  enqueue failing. The ad-hoc preview expands at request time.
- Routes are internal (`/api/projects/:projectId/data-fixtures`, `/api/data-fixtures/:id`,
  `/references`, `/try`), not API v1: the public surface waits until the agent path (release 3)
  settles the shape. Delete answers 409 with the tests and fixtures still naming it.
- Try it: `mode: check` reads only; `mode: dry` applies inside a transaction that is always rolled
  back and needs `dataSetup`, as a run does. MySQL/MariaDB DDL commits implicitly and cannot be
  undone by a dry run; the guide says so.
- Not done: `scope` on references (with row scope, release 4); bundle export carries references
  only, so they dangle once imported into another organization.

## Release 3 as built

- No `db.exec` feature flag: a relay session gets a new `apiProtocol: 'database'`, next to `grpc`
  and `websocket`. An agent advertises it in its hello; a pool whose agents do not is refused by
  the relay with "Update the agents", and the fixture fails with that reason. A database ticket
  carrying `apiFeatures` is malformed.
- The session is interactive, not a single batch: calls `open`, `query`, `begin`, `commit`,
  `rollback`, `lock`, `identity`, `close` over one WebSocket, replies matched by id, so the
  release 1 engine (`runDataFixtures`) runs unchanged on a remote `SqlSession`. The
  `queryDatabase` step uses a one-shot `run` call (`runDatabaseQuery` on the agent).
- Values cross the relay tagged (`$wfm`: `date`, `bytes`, `bigint`, and `object` for a JSON
  column that has the tag as a key), so outputs and `cellText` read the same as on the server.
- Limits (`AGENT_DATABASE_LIMITS`): 8 sessions per agent counted apart from browsers, 1 MB of SQL,
  2100 values, 5 minutes per call, 5 minutes idle, 30 minutes per session. The agent validates
  every call; a session that ends rolls back its open transaction.
- `DataRunner { where, vet, openSession, query }`: `localDataRunner` on the server,
  `agentDataRunner` from `AgentHttp.data` for a plan on a pool (and for BDD on a pool). On an
  agent `vet` does not apply the server's egress policy: the agent's network decides.
- The URL with its password is sent per session and never stored on the agent; agent errors are
  redacted with it before they leave. A missing driver names the package to install; the Node
  agent install command now includes `pg`, `mysql2` and `mssql` (the Docker image already had them).
- Not done: Try it stays on the server, also for a project whose plans run on a pool; the mobile
  runner keeps running its SQL from the server.

## Release 4 as built

- `teardown` is a SQL script on the fixture body (inline and library), validated like `apply`
  (`checkFixtureParams`): `{{params.x}}` must be declared, `{{fx.*}}` follows the same alias rules
  (`fx.self` and the own alias are readable), generators `{{$…}}` are refused. The policy is
  `teardownPolicy: 'always' | 'onSuccess' | 'never'` (default `always`), on the inline fixture and on
  the reference. It is not called `teardown`, which is the script field. A dependency inherits the
  policy of the entry that pulled it in.
- `runDataFixtures` returns `applied`: only the fixtures whose `apply` ran in this run
  (`status === 'applied'`, mode `run`) and that have a teardown. A fixture whose check found the data
  is not in it. The ledger row is reserved inside the apply transaction (`onApplying`, after the lock
  and the re-check, before the apply batches), dropped on rollback (`onApplyAborted`) and confirmed
  after commit (`onApplied`), so a crash never leaves committed data without a row; the outcome is
  also recorded when the check after the commit fails. Each item freezes only the parameters the teardown references (text substituted) and the
  bindings it reads; `db.*` values are never stored, the address is read again from the environment.
- `runFixtureTeardowns` (`fixture-teardown.ts`) runs last first, on a session of its own opened with
  the same factory as the setup (so the agent path works through `options.data`), with the identity
  guard and a timeout, begin/commit per teardown. It never throws; each result is `done | failed | kept`
  and a failure does not stop the others. `run-test.ts` calls it from `withCleanup`, so the three UI
  return paths and both comparison sides, which are separate `runTest` calls, tear down on their own.
  The steps are appended as `cleanup` steps; the verdict is not touched. BDD
  (`bdd-execution.ts`) and the ad-hoc Playwright runner call it in their `finally`.
- Ledger: table `fixture_ledger` (migration `0119_fixture_ledger`), tenant table with RLS. Statuses
  `applying | pending | running | done | failed | kept` (`applying` = reserved, not yet confirmed). Routes `GET /api/data-fixture-ledger` and
  `POST /api/data-fixture-ledger/:id/teardown` (atomic claim; a `running` or `applying` row is claimable again after 10 minutes).
  `startFixtureTeardownSweep` (advisory key 7, every 15 minutes) retries `always` rows (`pending` or stale `applying`) older than
  `WFM_FIXTURE_TEARDOWN_STALE_MINUTES` (default 120) and marks the other policies `kept`.
  Audit: `data_fixture.teardown_failed`, `data_fixture.teardown_retried`.
- No foreign key from the ledger to environments: the guard test for organization-scoped links
  asks for a composite same-org key, and the row has to outlive the environment anyway.
- UI: teardown field and policy select in the test editor and the library fixture editor; the library
  page lists the open ledger rows with a "Run teardown" action (en, it, fr, de).
- Not done: row scope; if a run crashes before the check runs again, outputs the teardown reads are
  missing and a retry fails with "no value"; BDD and ad-hoc runs have no ledger (no run or
  environment id there), and ad-hoc has no agent path.
