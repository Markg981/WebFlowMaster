# Mobile flows, reusable groups, device matrix and catalog

Date: 2026-10-05
Branch: `codex/mobile-flow-matrix-catalog`
Base: `212e192` (updated `origin/main`)
Status: Scope approved in chat; written specification awaiting review.

## Outcome

Authors can maintain one native test per platform, reuse common native steps,
branch and repeat within a test, and execute that definition on several device/OS
pairs. YAML and JSON catalog files include mobile definitions and their reusable
groups, so they can round-trip without copying installation-specific IDs.

Existing mobile tests continue to execute on their configured single device.
This delivery includes editor and run UI, scheduled/plan execution, reports,
version snapshots, API validation, migrations, automated tests, EN/IT docs and
new Collaudo cases. Live device validation is reported separately from mocked tests.

## Existing integration points

- `shared/mobile.ts`: flat `{ id, action, target?, value? }` steps and save schema.
- `shared/flow.ts`: block pairing, editor indentation and a 200-iteration limit.
- `server/flow-cursor.ts`: browser-independent flow traversal and `loopIndex`.
- `server/step-executor.ts`: value comparison grammar, currently embedded in web execution.
- `server/mobile-runner.ts`: Appium primitives, session cleanup and run persistence.
- `server/routes/mobile-tests.routes.ts`: saves and one-device run creation.
- `server/test-execution-service.ts`: mobile executes once, outside web/browser lanes.
- `shared/test-versioning.ts`: whitelisted mobile definition snapshot fields.
- `server/test-bundle.ts` and `server/routes/tests.routes.ts`: v1 web/API bundles.
- `client/src/components/mobile/`: authoring, inspector and run dialogs.

## 1. Flow actions and validation

Keep mobile steps flat. Add `if`, `else`, `endIf`, `repeat`, `repeatWhile`,
`endLoop`, `assertCondition` and `callGroup` to the mobile action vocabulary.
Adapt the mobile string action to the `{ action: { id } }` view required by
`analyseFlow`, `flowDepths` and `FlowCursor`; do not change the stored web shape.

`if` and `repeatWhile` evaluate their `value` as follows:

- With `target`: native locator and `visible`, `hidden`, `contains:text`, or
  `text:text` (exact text). Locator validation remains platform-specific.
- Without `target`: the existing value comparison grammar (`true`, `false`,
  `==`, `!=`, numeric ordering, `contains`, `not contains`) after variable
  substitution. Move the pure comparator into a shared server utility used by
  web and mobile. Preserve web semantics and existing tests.
- Element conditions probe immediately. Only missing elements produce a false
  visibility result; transport, invalid-selector and session errors propagate.
  Waiting for a loading element remains the job of `waitFor`.

`assertCondition` uses the value comparison grammar and fails on false.
`repeat` takes an integer from 1 to 200, or a variable resolved to that range
before execution. `repeatWhile` fails if its condition stays true beyond 200
iterations. Nested loops restore the enclosing `{{loopIndex}}` on exit.

Validate balanced blocks at save/import and again after group expansion before
opening an Appium session. Existing 200 authored-step limit remains; cap expanded
steps at 2,000 and executed step visits at 10,000 per device to bound nested loops.
An exhausted limit produces an explicit failure, never a truncated pass.

Each result retains its source step ID/index, group origin when applicable and
iteration key. Repeated visits appear separately in the report. Unselected
branches are distinguishable from steps abandoned after a failure. Preserve the
existing screenshot, secret redaction and finally-based session cleanup paths.

## 2. Reusable native groups

Add `mobile_step_groups`: UUID ID, organization, optional project, name,
description, platform, steps, creator and timestamps. Enforce name uniqueness
within organization/platform. Groups belong to one platform and hold 1–200
ordinary or flow steps. Their blocks must balance independently.

Use authenticated `/api/mobile-step-groups` CRUD with existing viewer/editor
roles, tenant transactions and project visibility/editability policies. A group
cannot call another group: this matches current web groups, prevents cycles and
keeps the first release small. `callGroup.value` identifies the group by UUID.

Resolve calls through the caller's visible groups. Reject missing, inaccessible,
empty or platform-mismatched groups; do not omit them. Reject deletion of a group
referenced by a current test, returning a conflict without exposing inaccessible
test names. A stale published reference still fails explicitly at execution.

Group edits affect subsequent runs. Resolve groups once when preparing a run and
persist the expanded execution definition and group origin metadata in its
snapshot. A queued run executes that frozen definition; retries use the same
definition. A test version stores calls, while a run snapshot stores the resolved
content, making the distinction explicit in docs and reports.

## 3. Device/OS matrix

Add optional `deviceMatrix: Array<{ deviceName: string; osVersion?: string | null }>`
to mobile definitions and version snapshot fields. Persist it as JSONB, default
`[]`. Empty means one target from existing `deviceName`/`osVersion`. A nonempty
matrix defines the complete target list; the legacy device is not appended.

Limit matrices to 20 nonempty, unique normalized pairs. Normalize whitespace and
missing OS values consistently. Each target uses the test's platform, app and
chosen grid. Cross-platform applications require separate Android/iOS tests;
this release does not guess equivalent locators or app binaries.

Preserve `POST /api/mobile-tests/:id/runs` and its one-run response. Add
`POST /api/mobile-tests/:id/matrix-runs` with the same grid/environment inputs;
it returns `{ runs: [...] }`, one queued run per effective target. The run dialog
offers the original single-device action and a matrix action when configured,
and follows each result independently. Each run freezes its selected device/OS
in `testSnapshot` so workers never fall back to the live default device.

Create and budget-check the matrix as a batch: insufficient quota creates no
partial batch. Dispatch after commit. Execute standalone targets sequentially
for this release; each Appium transport/session is closed before the next starts.
An ordinary failed target does not cancel the other targets. Run creation errors
and requested stop policies retain explicit outcomes.

In plans, expand each selected mobile test into one unit per matrix pair, outside
the web browser/locale multiplication. Each target receives its own report row,
device label, retry count, screenshot directory and session URL. Include target
identity in serialized/distributed execution units and artifact paths. Honor
existing plan parallelism, rerun, quarantine and stop policies. Aggregate status
includes every scheduled target; unfinished targets cannot produce a successful
plan. Preserve per-device flaky histories.

## 4. Catalog format and imports

Write bundle version 2 with `mobileTests` and `mobileStepGroups` sections. Continue
reading version 1 as empty mobile sections and retain existing web/API fields.
Reject unsupported versions rather than silently losing fields.

Export mobile name, platform, app, default device/OS, matrix and steps. Include
referenced visible mobile groups, keyed by platform and name, and replace
`callGroup` UUID references with portable group keys. Do not export organization,
author, project, grid IDs, timestamps, run artifacts or snapshots. Grids are bound
at the destination through its existing mobile configuration. Keep the app
reference as authored; it may need a destination upload/local path and the UI/docs
must say so. Do not imply that cloud upload handles are portable binaries.

Apply the existing project filter and RLS to mobile export and all dependencies.
Reject a requested native export with an unresolved group rather than emitting a
broken bundle. Sort definitions deterministically. Gherkin stays a web format;
make that scope explicit in the export UI and documentation.

Extend import preview/outcomes with `mobile_test` and `mobile_step_group`.
Validate native definitions with the same schemas used by CRUD. Resolve portable
group keys to existing/new destination IDs; groups are validated before dependent
tests. Invalid dependencies invalidate their calling tests. Detect duplicate keys
in the file and ambiguous destination matches. Refuse cross-platform group calls.

Use the existing import project rules: new entities go to the chosen editable
project, existing entities keep their project, and visibility alone does not
authorize changes. Preserve grid bindings on existing mobile tests; imported new
tests have no grid until configured. Preserve existing group IDs on updates.
Dry-run performs dependency and permission validation without writes, versions
or audit side effects. Unchanged imports create no new versions. Changed mobile
tests use the normal version store and audit path. Mobile item failures use the
existing per-item outcome pattern; dependent records cannot be saved against an
invalid group.

## 5. Editor, reports and documentation

The mobile editor shows native and flow actions with suitable target/value
controls, group selection filtered by platform, block indentation and actionable
validation errors. A dedicated mobile group editor uses the same step controls.
Changing platform invalidates incompatible locators/groups visibly before save.
The recorder/inspector continues recording primitive native actions; it does not
try to infer conditions or groups.

Matrix rows can be added, edited and removed in the mobile definition editor.
Reports show device/OS, group name and iteration for each relevant result.
Update translated strings using the existing locale conventions, both EN/IT
guide and internals pages, catalog documentation and Collaudo acceptance cases.

## 6. Migration and verification

Add migration `0082_mobile_flow_matrix_groups` after the verified current journal
head `0081`. Apply tenant RLS and restrictive project policies to the new table,
including same-organization project constraints, and register it with the
repository's tenant/schema conventions. Recheck the migration head before editing.
Defaults must make existing definitions and single-device runs compatible.

Required automated evidence:

1. Flow/schema: balanced and malformed blocks, both branches, immediate element
   conditions, comparator semantics, variable counts, nested index restoration,
   loop and total-visit limits, errors distinguished from absent elements.
2. Groups: CRUD roles/projects/tenants, platform mismatch, prohibited nested calls,
   missing groups, reference-safe deletion and frozen content after queued edits.
3. Matrix: normalization/limits, legacy fallback, atomic admission, frozen target
   execution, independent results, snapshots/restores and no web-lane duplication.
4. Plans: matrix target retries, stop/quarantine behavior, distinct artifact paths,
   distributed unit serialization and aggregated totals/status.
5. Catalog: YAML/JSON round-trip with ID remapping, v1 compatibility, invalid
   versions/dependencies, duplicate keys, dry-run, unchanged/versioned imports,
   permission enforcement and omission of installation IDs.
6. Client: flow/group authoring, validation, matrix editing and following multiple
   runs, import preview and web-only Gherkin messaging.

Run targeted suites during development, then `npm run check`, client typecheck,
server/client regression suites and affected real PostgreSQL isolation tests when
available. Add Collaudo cases for flow branches/loops, group reuse, two-device
execution and mobile catalog reimport. A simulated Appium pass proves orchestration;
real-device and PostgreSQL RLS evidence are separate, explicitly reported checks.

## Delivery sequence

Implement shared contracts and migration, then native flow execution and groups,
then standalone/plan matrix integration, catalog import/export, UI and docs.
Keep every part in this branch; commit/push and open a PR after required checks.
The detailed implementation plan follows approval of this written specification.
