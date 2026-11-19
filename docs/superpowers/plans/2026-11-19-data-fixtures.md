# Data fixtures: implementation plan

Design: [2026-11-19-data-fixtures-design.md](../specs/2026-11-19-data-fixtures-design.md).
Total estimate: about 32 days in five releases. Each release is one branch off updated `main`,
one PR, merged on green CI.

## Before starting

- Confirm the three decisions at the end of the design.
- Every PR: `npm run check`, server and client vitest, guide EN + IT, a new collaudo case per
  feature (`collaudo/casi/<AREA>/<AREA>-NN.json`, ids unique across open PRs), audit labels
  in the four locales, the "affects execution" checklist in
  `docs/en/internals/contributing-guide.md`.
- Migrations start at `0115`; renumber at merge if another PR takes it. Every new
  organization-scoped table gets an RLS policy. Every new plan or definition column needs a
  decision in `server/tests/execution-snapshot.test.ts`.

## Release 1: SQL engine and test-level fixtures (about 9 days)

Outcome: a test declares inline SQL fixtures (no library yet) that run before it, on the
server/worker, with check → apply → verify, and show up in the report.

1. **Shared model** (`shared/schema/authoring.ts`, `shared/jsonb-payloads.ts`)
   - `PreconditionSchema` becomes a discriminated union on `kind`: `http` (current shape,
     default when missing) and `sql` (`connection`, `params`, `check`, `satisfiedWhen`,
     `apply`, `outputs`, `alias`, `scope`, `timeoutMs`). No migration needed: jsonb, old rows
     parse as `http`.
   - Save-time validation: placeholder in identifier position, unknown param, output not in
     the `check` projection.
2. **SQL engine** (`server/runtime/data-setup/`)
   - `sql-template.ts`: `{{x}}` → dialect parameters (`@p0` / `$1` / `?`) plus a values array;
     SQL Server `GO` batch split; unit tests per dialect, including injection attempts.
   - `sql-runner.ts`: extract the connection, vetting, timeout and redaction from
     `database-step.ts` into a shared module; add transactions and application locks per
     dialect. `queryDatabase` keeps working through the same module.
   - `identity-guard.ts`: `db.<name>.expect` check, cached per connection per run.
   - `fixture-runner.ts`: the algorithm of the design (bind → guard → check → lock+apply →
     verify → outputs), returning statuses compatible with `PreconditionStepResult`.
3. **Environment switch**: migration `0115_environment_data_setup` adds
   `environments.data_setup` (default `disabled`); owner-only route change, audit
   `ENVIRONMENT_DATA_SETUP_CHANGED`; toggle in the environment page.
4. **Execution**
   - `server/execution/run-test.ts`: run `sql` preconditions next to `http` ones, in declared
     order, with the existing failure policy; outputs merged into the test variables as
     `{{fx.<alias>.<col>}}`; `scope: row` inside the row loop.
   - `adhoc-runner.ts` and `bdd-execution.ts`: same path; adhoc runs now resolve environment
     secrets for preconditions (current gap).
   - New `{{run.id}}` and `{{run.tag}}` in `server/runtime/variables.ts`.
5. **Report**: step type `fixture` (and HTTP precondition steps) written into the report and
   `detailedLog`; report UI shows status, durations, outputs.
6. **Docs and collaudo**: guide section *Data fixtures* (EN + IT), update
   `docs/en/security/hardening.md` (database egress, stale since audit A-01); collaudo cases:
   fixture applied on an empty database, satisfied on a populated one, verify failure,
   `dataSetup` disabled, identity guard mismatch.

## Release 2: fixture library, versions, dependencies (about 8 days)

Outcome: fixtures are reusable library items with versions and dependencies; tests reference
them.

1. Migration `0116_data_fixtures`: `data_fixtures` (org, project, key, kind, current version,
   tags) and `data_fixture_versions` (frozen definition), RLS, unique `(project, key)`.
2. Routes `server/http/routes/data-fixtures.routes.ts` (list, get, create, update = new
   version, delete when unreferenced, references), `requireRole`, audit
   `DATA_FIXTURE_CREATED/UPDATED/DELETED`; API v1 + OpenAPI.
3. Precondition `kind: fixture` (`fixtureId`, `version`, `params`, `as`, `scope`).
   Resolver `fixture-graph.ts`: expand dependencies, bind params, dedupe by
   `(version, params hash)`, topological order, cycle detection (also at save).
4. Freeze resolved fixture versions into the execution definition
   (`executable-definition.ts`, `plan-run/definitions.ts`, `test-versions.ts`).
5. Client: *Test data → Fixtures* page (editor, params, deps, outputs, history) and *Add data
   fixture* in the builder panel with graph preview; translate the precondition panel.
6. **Try it**: *Check only* and *Dry apply* (always rolled back) against a chosen environment.
7. Docs + collaudo: library CRUD, dependency chain on an empty database, cycle rejected,
   dry apply leaves no data.

## Release 3: execution through the local agent (about 6 days)

Outcome: fixtures and `queryDatabase` run on the agent when the plan uses an agent pool; the
DMO local scenario works end to end.

1. `shared/agent-protocol.ts`: operation `db.exec` (dialect, connection string, batches,
   params, transaction/lock flags, timeout) with a feature flag in `AGENT_API_FEATURES`; size
   limits.
2. Agent side (`server/runtime/agents/`): handler using the shared `sql-runner.ts`; drivers in
   the agent bundle and `Dockerfile.agent`; secrets passed per call, never stored.
3. `DataRunner` selection: agent when `agentHttp` is present, local otherwise; old agents
   without the feature fail with a clear "update the agent" message.
4. Docs (`docs/*/integrations/local-agents.md`) + collaudo: DMO NCC test on an empty local DMO
   database through the `dmo-local` pool.

## Release 4: teardown, ledger, plan scope (about 5 days)

1. Migration `0117_fixture_ledger` + RLS.
2. Teardown runner: LIFO, only rows applied by this run, `always` / `onSuccess` / `never`,
   report step `cleanup`; orphan retry in the existing cleanup job.
3. Pipeline phases `setupFixtures` / `teardownFixtures` in `plan-run/pipeline.ts` for
   `scope: plan`, also on cancel and failure; real `onTestSuitePreRequisiteFailure`.
4. Docs + collaudo: data removed after a green run, kept after a red one with `onSuccess`,
   plan-scope fixture shared by two tests and applied once, parallel lanes do not duplicate.

## Release 5: baseline reset and hub mapping (about 4 days, optional)

1. Environment-level optional reset before a plan: run a seed pack or restore a SQL Server
   database snapshot / pg template, owner-only, with the identity guard.
2. Hub import: suggest fixtures for a case's precondition text (tags, text match, optional AI),
   and let the reviewer attach them; `dependsOn` between hub cases mapped to plan order.

## Verification (to record when done)

- Same plan green on an empty database and on a populated one, without duplicated rows on
  rerun.
- Two parallel runs on the same database do not collide (`run.tag`).
- No write happens when `dataSetup` is disabled or the identity guard fails.
