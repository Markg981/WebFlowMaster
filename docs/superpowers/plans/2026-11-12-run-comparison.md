# Run comparison implementation plan

**Goal:** Launch one plan as two runs from a single frozen snapshot on two environments, compare the stored results step by step, and show a verdict per test and overall on a summary page. First use: proving that the DMO NetContent porting to Angular 22 behaves like the current version.

**Design:** `docs/superpowers/specs/2026-11-12-run-comparison-design.md`. A comparison entity over two ordinary runs: the baseline is enqueued normally, the candidate is a replay of the baseline snapshot with the environment overridden. The comparison is computed after both end. The runner only gains capture steps.

**Authorization:** Not yet given. Work on a new branch from updated main (`feature/run-comparison`); publication requires separate authorization.

**Limits:** The comparison reproduces inputs, not external state: both environments must be prepared with equivalent data. Checkpoints never store request or response bodies. Visual differences are informative by default. Dataset-row pairing and locator variants depend on two points to confirm first (see "Before starting").

## Before starting

- [x] Confirm how per-row step results of a dataset test are stored, to pair rows by index (`server/execution/execution-units.ts`, `report-entry.ts`).
- [x] Confirm where a frozen repository element becomes a selector (`server/authoring/executable-definition.ts`), for the locator variants of release 3.
- [x] Take the next migration index from `migrations/meta/_journal.json` (0110 if nothing landed since) and its `when` value.

## Release 1: paired launch, outcome, text and visual comparison (about 15 days) Merged in PR #623.

Schema and contract

- [x] `migrations/0110_run_comparisons.sql`: `comparison_runs`, `comparison_results`, `comparison_known_differences`; indexes on `baseline_execution_id`, `candidate_execution_id`, `comparison_run_id`; unique `(organization_id, idempotency_key)` where not null and `(comparison_run_id, pair_key)`; row-level security, policy and grants as in `0108_outbound_deliveries.sql`; journal entry.
- [x] `shared/schema/execution.ts`: the three `pgTable` definitions and inferred types; `shared/schema/relations.ts` if relations are declared there.
- [x] Registries: `shared/schema/tenancy.ts`, `shared/jsonb-payloads.ts` (three jsonb columns), `server/tenancy/organization-lifecycle.ts`.
- [x] `shared/comparison.ts`: statuses, verdicts, `CheckpointCapture`, `ComparisonDifference`, `ComparisonPolicySchema` with defaults, limits. Tests for the schemas.

Orchestration

- [x] Failing tests first: same fingerprints on both runs, environment override, idempotency, sequential ordering, quota refusal, cross-organization and viewer denial, single winner on finalize, sweep recovery.
- [x] `server/execution/execution-snapshot.ts`: optional `comparison` on the snapshot and the overrides; forced values for comparison runs (`captureScreenshots: 'always'`, visual testing off, no issue filing); record the decision in `execution-snapshot.test.ts`.
- [x] `server/execution/execution-orchestrator.ts`: `comparison` on `EnqueueExecutionInput`; optional overrides `{ environmentId, comparison }` on `replay`, validating the environment as `enqueue` does.
- [x] `server/execution/execution-provenance.ts`: expose `comparison: { id, role }` through `publicExecution`.
- [x] `server/execution/comparison-state.ts`: `transitionComparison()` as the only writer of the status.
- [x] `server/execution/comparison-orchestrator.ts`: create, enqueue the baseline, start the candidate (parallel now, sequential through the finalizer), cancel.
- [x] `server/execution/comparison-finalizer.ts`: `registerComparisonFinalizer()` in `server/worker.ts` and `server/index.ts`; `startComparisonSweep()` in `server/index.ts`.

Steps and engine

- [x] `checkpointText`: id in `ADHOC_ACTION_IDS`, `ACTION_REQUIREMENTS`, `ACTION_I18N`, `ACTION_VALUE_HINTS` (`shared/recording.ts`); `leavesPageAlone` and the retry-safe set (`shared/flow.ts`); handler in `HANDLERS` (`server/web/step-executor.ts`); icon (`client/src/lib/action-icons.tsx`); labels in the four locale bundles; `unsupported` entry in `server/integrations/playwright-export.ts`.
- [x] `checkpoint` on `StepOutcome` and on `StepResult` (`server/web/playwright/types.ts`); copy it in `test-runner.ts` and `adhoc-runner.ts` beside `outcome.download`.
- [x] `server/web/visual-testing.ts`: extract `diffPng(a, b, { threshold })` from `compareStepScreenshot`, keeping its behaviour and tests.
- [x] `server/reporting/comparison/`: `pairing.ts`, `normalizers.ts`, `diff-outcome.ts`, `diff-text.ts`, `diff-visual.ts`, `verdict.ts`, `compare-runs.ts`, each with tests.

API and interface

- [x] `server/http/routes/comparisons.routes.ts` with `asyncRouter()`: create, list, get, results, result detail, cancel; `resultForViewer` on result rows; mount in `server/routes.ts`; audit actions `comparison.created` and `comparison.cancelled` with their labels.
- [x] `client/src/pages/ComparisonsPage.tsx`, `client/src/pages/ComparisonReportPage.tsx` (tiles, parity by module, test list, outcome, text and image differences); routes in `client/src/App.tsx`; navigation entry in `AppShell.tsx`; "Compare environments" dialog in `TestPlansPage.tsx`; link from `TestReportPage.tsx`.
- [x] Show a captured checkpoint in the run report step detail.
- [x] Labels in `client/src/locales/{en,it,fr,de}/translation.json`; page and dialog tests.

Documentation

- [x] `docs/en` and `docs/it`: `guide/running.md` (start a comparison), `guide/results.md` (read it), `guide/web-tests.md` (checkpoint step); `internals/execution.md`, `data-model.md`, `schema-catalog.md`. Update the README line that says "no run-to-run comparison". `CHANGELOG.md` under Unreleased.

## Release 2: full comparison (about 15 days) Merged in PR #624.

- [x] `checkpointTable`, `checkpointChart`, `checkpointNetwork`: same nine places as `checkpointText`.
- [x] `server/web/checkpoints/chart-adapters.ts`: `__wfmChartModel` hook, DevExtreme jQuery widgets, ECharts; tests against stub pages.
- [x] `server/web/checkpoints/network-journal.ts`: attach when the test has a network checkpoint; hashes only, no bodies; tests.
- [x] Engine: `diff-table.ts`, `diff-chart.ts`, `diff-network.ts`, `diff-performance.ts`, `known-differences.ts`; numeric tolerance and replace rules from the policy.
- [x] Routes: review of a result, known differences (list, create, delete); audit actions `comparison.difference_reviewed`, `comparison.known_difference_created`, `comparison.known_difference_deleted`.
- [x] Interface: policy editor in the "Compare environments" dialog; side-by-side detail with `DiffTable`, `DiffChart` (recharts overlay) and `DiffImage`; `ReviewDialog`; known differences in Settings.
- [x] Documentation EN and IT; Collaudo cases: create, review, known difference recognised on the next comparison, viewer, second organization.

## Release 3: evidence and automation (about 8 days) Merged in PR #625.

- [x] Parity report: `server/reporting/comparison/comparison-report-model.ts`; HTML and PDF through the existing export path (`report-html.ts`, `report-export.ts`); `GET /api/comparisons/:id/export/:format`.
- [x] Public API: `POST /api/v1/plans/:planId/comparisons`, `GET /api/v1/comparisons/:id` in `api-v1.routes.ts` with `server/http/api-v1/openapi.ts`; scopes `runs:write` and `runs:read`.
- [x] `scripts/wfm-cli.ts`: `wfm compare --plan --baseline --candidate [--wait] [--fail-on different,outcome_mismatch]`, exit code from the overall verdict; Azure Pipelines template in `integrations/azure-pipelines`.
- [x] One notification per comparison instead of one per run.
- [x] Locator variants: `project_elements.variants` (jsonb, next migration) chosen by an environment variable such as `uiVariant`; element repository editor; frozen with the dependency bundle.
- [x] End-to-end critical workflow on the demo shop with two environments and one controlled difference.

## Verification (to record when done)

- [x] `npm run check`, `npm run lint`, `npm run format:check`, `npm run any-budget`.
- [x] `npm test` and `npm run test:client -- --run`; real PostgreSQL isolation for the three tables; fresh `npm run db:migrate`. (In CI: `rls-on-real-postgres` applies every migration to a new database and runs the isolation tests as a non-superuser role.)
- [x] `server/tests/architecture.test.ts` green: router built with `asyncRouter()`, a role on every mutating route, `resultForViewer` where result rows are spread, no privileged database handle in routes.
- [ ] Manual check against two environments of a real application, with the limits observed written down.
