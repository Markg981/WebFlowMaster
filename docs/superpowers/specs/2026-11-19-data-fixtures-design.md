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
