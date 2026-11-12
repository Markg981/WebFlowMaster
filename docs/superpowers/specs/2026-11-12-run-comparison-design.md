# Run comparison: one frozen plan on two environments, compared step by step

Date: 2026-11-12. Branch: to be created (`feature/run-comparison`). Base: main at branching time. Status: proposed, not implemented. Plan: `docs/superpowers/plans/2026-11-12-run-comparison.md`.

## Intent and acceptance

Answer one question with evidence: do two versions of an application behave the same way? The first user is the DMO NetContent porting from AngularJS to Angular 22, where the current version (baseline) and the ported one (candidate) must be shown equivalent page by page.

Today a plan runs on any environment (`environmentId` per run) and a run can be replayed from its frozen inputs, but two runs cannot be launched as a pair or compared. The README says so: "no run-to-run comparison".

Acceptance:

- One request launches two runs of one plan from a single frozen snapshot, on two environments of the organization. Both runs report identical input fingerprints.
- When both end, every test gets a verdict and the comparison gets an overall verdict.
- A difference can be reviewed: accepted with a reason, and optionally saved as a known difference that later comparisons recognise.
- A summary page shows counts by verdict, parity by module, the test list and a side-by-side detail. The same content exports as a parity report.
- Tenant isolation, roles, restricted projects, quotas and audit behave as they do for runs.

Non-goals: comparing runs of different plans or of different snapshots; AI judgement of differences; changing how a single run decides pass or fail.

## Approaches and choice

1. Recommended: a comparison entity over two ordinary runs. The baseline is enqueued normally; the candidate is a replay of the baseline's snapshot with the environment overridden. The comparison is computed after both end, from stored results. This reuses the orchestrator, the snapshot, the state machine, evidence and artifact access; the runner only gains capture steps.
2. One run with the environment as a matrix axis, like browser or locale. Rejected: it touches the manifest, units, shards and verdict of every run, sequential execution on a restored database copy is hard to express, and a failing candidate would fail "the run".
3. Visual baselines only: run on A with `updateBaselines`, then on B. It works today with no code and stays documented as a stop-gap. Rejected as the solution: it compares pixels only, keeps one baseline set per test whatever the environment, and reports every expected difference as a failure.

## Vocabulary

- **Comparison**: one row of `comparison_runs`; owns a baseline run and a candidate run.
- **Role**: `baseline` or `candidate`, recorded in each run's snapshot.
- **Checkpoint**: structured data a step captures for comparison (text, table, chart, network), stored on the step result.
- **Policy**: tolerances and switches the engine applies (see below).
- **Known difference**: an approved, recorded exception with a reason and a reference.

## Data model (migration `0110_run_comparisons.sql`)

Three organization-scoped tables. Each gets `ENABLE` and `FORCE ROW LEVEL SECURITY`, the `org_isolation` policy and the `app_user` grants, exactly as `0108_outbound_deliveries.sql`. Use the same-organization composite foreign key towards `test_plan_executions (id, organization_id)`.

`comparison_runs`

| Column                                                    | Type                               | Notes                                                               |
| --------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `id`                                                      | text PK                            | uuid                                                                |
| `organization_id`                                         | integer NOT NULL                   | FK organizations                                                    |
| `test_plan_id`                                            | text NOT NULL                      | FK test_plans, ON DELETE CASCADE                                    |
| `name`                                                    | text                               | optional label                                                      |
| `baseline_environment_id`, `candidate_environment_id`     | integer                            | FK environments, ON DELETE SET NULL                                 |
| `baseline_environment_name`, `candidate_environment_name` | text NOT NULL                      | captured at creation, survive environment deletion                  |
| `baseline_execution_id`, `candidate_execution_id`         | text                               | FK test_plan_executions, ON DELETE SET NULL; indexed                |
| `mode`                                                    | text NOT NULL DEFAULT 'sequential' | `sequential` or `parallel`                                          |
| `policy`                                                  | jsonb NOT NULL DEFAULT '{}'        | validated by `ComparisonPolicySchema`                               |
| `status`                                                  | text NOT NULL DEFAULT 'queued'     | `queued`, `running`, `comparing`, `completed`, `error`, `cancelled` |
| `verdict`                                                 | text                               | `parity`, `parity_with_accepted`, `regressions`, `inconclusive`     |
| `summary`                                                 | jsonb                              | counts by verdict and by module                                     |
| `failure_code`, `failure_message`                         | text                               | why it ended in `error`                                             |
| `idempotency_key`                                         | text                               | unique per organization when not null                               |
| `requested_by_user_id`                                    | integer                            | FK users, ON DELETE SET NULL                                        |
| `created_at`, `completed_at`                              | timestamp                          |                                                                     |

`comparison_results`

| Column                                              | Type                         | Notes                                                                                       |
| --------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `id`                                                | text PK                      |                                                                                             |
| `organization_id`                                   | integer NOT NULL             |                                                                                             |
| `comparison_run_id`                                 | text NOT NULL                | FK comparison_runs, ON DELETE CASCADE                                                       |
| `pair_key`                                          | text NOT NULL                | unique with `comparison_run_id`                                                             |
| `ui_test_id`, `api_test_id`                         | integer                      | ON DELETE SET NULL                                                                          |
| `test_type`, `test_name`, `browser`                 | text                         | copied from the results                                                                     |
| `module`, `component`, `priority`, `severity`       | text                         | for filters and parity by area                                                              |
| `baseline_result_id`, `candidate_result_id`         | text                         | FK report_test_case_results, ON DELETE SET NULL                                             |
| `verdict`                                           | text NOT NULL                | `identical`, `equivalent`, `different`, `outcome_mismatch`, `both_failed`, `not_comparable` |
| `differences`                                       | jsonb NOT NULL DEFAULT '[]'  | list of `ComparisonDifference`                                                              |
| `baseline_duration_ms`, `candidate_duration_ms`     | integer                      |                                                                                             |
| `review_status`                                     | text NOT NULL DEFAULT 'open' | `open`, `accepted`, `defect`                                                                |
| `reviewed_by_user_id`, `reviewed_at`, `review_note` |                              |                                                                                             |

`comparison_known_differences`

| Column                     | Type             | Notes                                                    |
| -------------------------- | ---------------- | -------------------------------------------------------- |
| `id`                       | text PK          |                                                          |
| `organization_id`          | integer NOT NULL |                                                          |
| `project_id`               | integer          | scope; null means the whole organization                 |
| `ui_test_id`               | integer          | optional narrower scope, ON DELETE CASCADE               |
| `checkpoint_name`          | text             | null means any                                           |
| `kind`                     | text NOT NULL    | `outcome`, `text`, `table`, `chart`, `network`, `visual` |
| `path_pattern`             | text             | glob over the difference path                            |
| `reason`                   | text NOT NULL    |                                                          |
| `reference`                | text             | for example `LEG-005` or a work item                     |
| `approved_by_user_id`      | integer          |                                                          |
| `created_at`, `expires_at` | timestamp        |                                                          |

Registries to update with the tables and their jsonb columns: `shared/schema/tenancy.ts`, `shared/jsonb-payloads.ts` (`comparison_runs.policy`, `comparison_runs.summary`, `comparison_results.differences`), `server/tenancy/organization-lifecycle.ts`, `docs/en/internals/data-model.md`, `docs/en/internals/schema-catalog.md`.

## Shared contract (`shared/comparison.ts`, new)

Types and zod schemas used by server and client: `ComparisonStatus`, `ComparisonVerdict`, `ComparisonResultVerdict`, `ComparisonRole`, `CheckpointKind`, `CheckpointCapture`, `ComparisonDifference`, `ComparisonPolicySchema`, `ComparisonSummary`, and the limits (`MAX_CHECKPOINT_BYTES`, `MAX_TABLE_ROWS`, `MAX_NETWORK_ENTRIES`).

```ts
export interface CheckpointCapture {
  name: string; // unique within the test, chosen by the author
  kind: 'text' | 'table' | 'chart' | 'network';
  data: unknown; // normalised, bounded by MAX_CHECKPOINT_BYTES
  hash: string; // sha-256 of the canonical JSON of data
  truncated?: boolean;
}

export interface ComparisonDifference {
  stepId: string | null; // the test's own step id; null for test-level differences
  stepIndex: number;
  checkpoint: string | null;
  kind: 'outcome' | 'text' | 'table' | 'chart' | 'network' | 'visual' | 'performance';
  path: string; // where inside the data, e.g. series[1].points[14][1]
  baseline: unknown;
  candidate: unknown;
  severity: 'blocking' | 'informative';
  knownDifferenceId?: string;
}
```

Default policy:

```ts
{
  text: { collapseWhitespace: true, ignoreCase: false, replace: [] }, // replace: [{ pattern, with }]
  numeric: { absTolerance: 0, relTolerance: 0 },
  network: { include: ['**/api/**'], ignoreQueryParams: [], compareResponseHash: false },
  visual: { mode: 'informative', threshold: 0.01 }, // off | informative | blocking
  performance: { mode: 'informative', maxSlowdownPct: 20 },
}
```

## Snapshot and orchestration

Snapshot (`server/execution/execution-snapshot.ts`): add optional `comparison?: { id: string; role: 'baseline' | 'candidate' }` to `ExecutionSnapshot` and to `SnapshotOverrides`. It is optional, so `EXECUTION_SNAPSHOT_VERSION` does not change. A comparison run also forces three snapshot values: `captureScreenshots: 'always'`, `visualTesting.enabled: false` (the engine compares run to run, not against stored baselines) and `issues.createOnFailure: false` (no duplicate tickets). Notifications and test-management publication are suppressed for the two runs; the comparison notifies once (release 3). `execution-snapshot.test.ts` needs the decision recorded.

Orchestrator (`server/execution/execution-orchestrator.ts`):

- `EnqueueExecutionInput.comparison?` is passed through to the snapshot overrides.
- `replay(executionId, requestedByUserId, idempotencyKey, overrides?)` gains optional overrides `{ environmentId, comparison }`. With an environment override it validates the environment as `enqueue` does, sets `snapshot.environmentId` and the row's `environment`, and keeps `replayOf`. Definitions and datasets are cloned untouched, so `buildExecutionProvenance` yields the same fingerprints on both runs.

New `server/execution/comparison-orchestrator.ts`:

1. In one tenant transaction: check the plan is visible, both environments exist and differ, the requester is a member; honour the idempotency key; insert `comparison_runs` as `queued`.
2. Enqueue the baseline with `executionOrchestrator.enqueue({ planId, environmentId: baseline, trigger: 'manual', idempotencyKey: 'cmp-<id>-baseline', comparison: { id, role: 'baseline' } })`; store `baseline_execution_id`; move to `running`.
3. `parallel`: immediately replay the baseline snapshot onto the candidate environment. `sequential` (default, needed when tests write data): the finalizer does it when the baseline reaches a terminal state.
4. Quotas apply twice, once per run. A candidate refused for quota is retried by the sweep; the comparison stays `running` with `failure_code = 'candidate_deferred'` until it starts.

New `server/execution/comparison-state.ts`: `transitionComparison()` is the only writer of `comparison_runs.status`, one conditional `UPDATE … WHERE status IN (…) RETURNING`, as `execution-state.ts` does for runs.

New `server/execution/comparison-finalizer.ts`:

- `registerComparisonFinalizer()` subscribes with `onExecutionTransition`, like `registerRunPromotion`; registered in `server/worker.ts` and `server/index.ts`.
- On a terminal baseline in sequential mode: `completed`, `failed` or `timed_out` start the candidate; `error` or `cancelled` end the comparison as `error` or `cancelled`.
- When both runs are terminal: `running → comparing`, run the engine, write results, `comparing → completed`.
- `startComparisonSweep()` (web process) repeats the same decisions for comparisons whose transition was missed, so a restart loses nothing.
- Cancelling a comparison calls `requestCancellation` on both runs.

Find the comparison of a run by `baseline_execution_id` or `candidate_execution_id` (both indexed); `publicExecution` exposes `comparison: { id, role }` as safe provenance so the run report can link to it.

## Checkpoint steps

Four action ids added to `ADHOC_ACTION_IDS` in `shared/recording.ts`, with `ACTION_REQUIREMENTS`, `ACTION_I18N`, `ACTION_VALUE_HINTS`, an icon in `client/src/lib/action-icons.tsx`, labels in the four locale bundles, a handler in `HANDLERS` (`server/web/step-executor.ts`) and an entry in the support table of `server/integrations/playwright-export.ts` (`unsupported`, with the reason). All are read-only: add them to `leavesPageAlone` and to the retry-safe set in `shared/flow.ts`.

| Action              | Target   | Value                                    | Captures                                                  |
| ------------------- | -------- | ---------------------------------------- | --------------------------------------------------------- |
| `checkpointText`    | required | name                                     | Inner text of every match, whitespace-normalised          |
| `checkpointTable`   | required | name, optional `rows=<css>; cells=<css>` | Matrix of cell texts; `tr` and `th, td` by default        |
| `checkpointChart`   | required | name                                     | Chart model read at runtime (below)                       |
| `checkpointNetwork` | none     | `name \| pattern[, pattern]`             | Requests since the previous network checkpoint that match |

`StepOutcome` gains `checkpoint?: CheckpointCapture`; `StepResult` (`server/web/playwright/types.ts`) gains the same field; `test-runner.ts` and `adhoc-runner.ts` copy it where they copy `outcome.download`. A checkpoint step passes when the capture succeeds and fails only when the target is missing or the adapter throws. Outside a comparison the capture is still stored and shown in the run report.

Chart adapters (`server/web/checkpoints/chart-adapters.ts`, evaluated like `executeScript`, through the debugging protocol): in order, an explicit hook `el.__wfmChartModel()` the application may expose; DevExtreme jQuery widgets through `jQuery(el).data('dxChart' | 'dxPieChart' | 'dxPolarChart')`; ECharts through `echarts.getInstanceByDom(el)`. All return one shape: `{ series: [{ name, type, points: [[x, y]] }], axes: [{ name, min, max }], lines: [{ axis, value, label }] }`. The hook is the documented contract for libraries bundled as modules, where no global instance is reachable.

Network journal (`server/web/checkpoints/network-journal.ts`): attached to the page when the test contains a `checkpointNetwork` step. Per finished request it keeps method, path, sorted query parameters, a hash of the request body, status and, only if the policy asks, a hash of the response body. Bodies are never stored, as with the HAR. Entries are sorted, so request order does not matter.

## Comparison engine (`server/reporting/comparison/`, new)

Pure modules, no database, each with its own tests:

- `pairing.ts`: pairs `report_test_case_results` of the two runs by test type, test id, browser and matrix configuration; the deciding attempt of each. Unpaired results become `not_comparable`.
- `normalizers.ts`: whitespace, case, replace rules, number parsing for tolerance.
- `diff-outcome.ts`: per step id, passed against failed.
- `diff-text.ts`, `diff-table.ts`, `diff-chart.ts`, `diff-network.ts`: compare checkpoints with the same name; a checkpoint present on one side only is a difference.
- `diff-visual.ts`: pixel comparison of the two step screenshots. Extract the pixelmatch block of `compareStepScreenshot` (`server/web/visual-testing.ts`) into an exported `diffPng(a, b, { threshold })` and call it from both.
- `diff-performance.ts`: step and test durations against `maxSlowdownPct`.
- `known-differences.ts`: marks a difference with `knownDifferenceId` when scope, kind, checkpoint and path match and the entry has not expired.
- `verdict.ts`: test verdict and overall verdict.
- `compare-runs.ts`: reads steps with the reader the report model uses (`stepListOf`), runs the modules, writes `comparison_results` and the summary in one tenant transaction, records the audit entry.

Test verdict:

| Verdict            | Rule                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| `identical`        | No difference at all                                                            |
| `equivalent`       | Only informative differences, or blocking ones all matched by known differences |
| `different`        | At least one blocking difference not matched                                    |
| `outcome_mismatch` | The test passed on one side and failed on the other                             |
| `both_failed`      | Failed on both sides: not valid as a comparison                                 |
| `not_comparable`   | One side has no result                                                          |

Overall verdict: `regressions` if any `different` or `outcome_mismatch`; `inconclusive` if none of those but any `both_failed` or `not_comparable`; `parity_with_accepted` if any `equivalent`; else `parity`.

## API (`server/http/routes/comparisons.routes.ts`, new; mounted in `server/routes.ts`)

Built with `asyncRouter()`, tenant transactions, explicit `requireRole` on every mutation. Result rows pass through `resultForViewer` with `runArtifactAccess`, so restricted projects are honoured.

| Method and path                                       | Role           | Purpose                                                                                                                                  |
| ----------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/test-plans/:planId/comparisons`            | editor         | Create; body `{ baselineEnvironmentId, candidateEnvironmentId, mode?, name?, policy? }`; `Idempotency-Key`; answers 202 `{ id, status }` |
| `GET /api/comparisons`                                | viewer         | Paged list, filters `planId`, `status`                                                                                                   |
| `GET /api/comparisons/:id`                            | viewer         | Comparison, summary, the two runs as `publicExecution`                                                                                   |
| `GET /api/comparisons/:id/results`                    | viewer         | Paged results without difference bodies; filters `verdict`, `module`, `reviewStatus`                                                     |
| `GET /api/comparisons/:id/results/:resultId`          | viewer         | Differences and the paired steps with artifact links                                                                                     |
| `POST /api/comparisons/:id/results/:resultId/review`  | editor         | `{ status, note, saveAsKnownDifference? }`                                                                                               |
| `POST /api/comparisons/:id/cancel`                    | editor         | Cancel both runs                                                                                                                         |
| `GET /api/comparisons/:id/export/:format`             | viewer         | `html`, `pdf`, `json` parity report (release 3)                                                                                          |
| `GET, POST, DELETE /api/comparison-known-differences` | viewer, editor | Manage known differences                                                                                                                 |

Audit actions (`shared/schema/identity.ts`, with labels in the four languages): `comparison.created`, `comparison.cancelled`, `comparison.difference_reviewed`, `comparison.known_difference_created`, `comparison.known_difference_deleted`.

Release 3 adds `POST /api/v1/plans/:planId/comparisons` (`runs:write`) and `GET /api/v1/comparisons/:id` (`runs:read`) in `server/http/routes/api-v1.routes.ts` together with `server/http/api-v1/openapi.ts`, and `wfm compare` in `scripts/wfm-cli.ts`.

## Client

- `client/src/pages/ComparisonsPage.tsx`: list with status and verdict.
- `client/src/pages/ComparisonReportPage.tsx`: header with the two runs and the overall verdict; tiles by verdict; parity by module; filterable test list; side-by-side detail of the selected test (steps, checkpoints, screenshots, difference).
- `client/src/components/comparison/`: `DiffText`, `DiffTable`, `DiffChart` (overlay with recharts, already a dependency), `DiffImage` (baseline, candidate, difference), `ReviewDialog`.
- Routes `/comparisons` and `/comparisons/:comparisonId` in `client/src/App.tsx`; navigation entry in `client/src/components/layout/AppShell.tsx`; a "Compare environments" action in `TestPlansPage.tsx`; a link to the comparison from `TestReportPage.tsx` when the run has a role.
- Data with TanStack Query; poll while the comparison is not terminal. Labels in `client/src/locales/{en,it,fr,de}/translation.json`.

## Security, tenancy and limits

- Every table is organization-scoped with forced row-level security. No route uses the privileged handle.
- Checkpoints may hold application data. They are stored on the step result and follow the visibility of the result (`resultForViewer`); they are not raw evidence, because they never contain request or response bodies. Size is bounded per checkpoint and per test.
- A comparison consumes two runs of the organization's quotas and execution budget.
- Retention: comparison rows follow the plan; when a run's artifacts are purged, the stored differences stay and the images are shown as purged.

## Testing

- Unit: every engine module; `shared/comparison.ts` schemas; chart adapters against stubbed `dxChart` and ECharts pages; network journal.
- Orchestration: creation, idempotency, identical fingerprints on both runs, environment override, sequential ordering, candidate deferred for quota, cancellation, single winner when two processes finalize, sweep recovery.
- Routes: role denial, cross-organization invisibility, restricted project, pagination, review with audit.
- Migration: fresh `db:migrate`, real PostgreSQL isolation for the three tables.
- Client: both pages, the dialogs and the diff components.
- End to end: one critical workflow on the demo shop with two environments and one controlled difference.
- Collaudo: cases for create, review, known difference, viewer and second organization.

## Rollout: three releases

1. Minimum: tables, shared contract, paired launch (sequential), outcome, text and visual comparison, create/list/detail routes, basic summary page.
2. Full comparison: table, chart and network checkpoints, policy and tolerances, known differences and review, side-by-side detail.
3. Evidence and automation: parity report export, public API and `wfm compare`, single notification per comparison, locator variants per environment in the element repository.

## Resolved before coding (2026-11-12)

- Dataset rows: every dataset row is its own execution unit. `planLanes` expands `test.dataset` into units with `bddRowIndex` (`server/execution/plan-run/lanes.ts:103`), the manifest stores it as `coordinates.bddRow` (`server/execution/execution-units.ts:119`), and `run-unit.ts:276-293` runs that one row. Results carry `executionUnitId`. Rows are therefore paired through the unit's coordinates `(test, browser, bddRow)`, not through the result's name (which is `"<name> — Row N"`).
- Locator variants: a frozen bundle is applied in `buildExecutableDefinition` → `resolveStepElements(actions.steps, bundle.elements)` (`server/authoring/executable-definition.ts:309`), and the selector is written in `server/authoring/step-elements.ts:87-94`. The live path (`resolveSequenceForRun`, `step-elements.ts:129`) uses the same function. Choosing a variant per environment belongs there, with the variant included in the bundle fingerprint (`executable-definition.ts:94`) and in `step-provenance.ts:75`.
- Migration index: `0110` is free. `main` ends at `0109_scim_token_expiry.sql`, and no open PR adds a migration. Check again at merge time.

## Open questions

- Visual masks: recording the rectangles of masked selectors with each screenshot would allow regions to be ignored; decide after release 1.
- Windows integrated authentication of the application under test from a local agent: to be verified outside this feature.
