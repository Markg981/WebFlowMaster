# Mobile Flow, Matrix and Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Author native conditions, loops and reusable groups, execute a mobile definition across device/OS pairs, and round-trip native definitions through the catalog.

**Architecture:** Preserve flat mobile steps and adapt them to the existing flow analyzer/cursor. Native groups resolve into frozen run snapshots; device matrices produce independent execution units. Extend the catalog to v2 with portable native group keys while retaining v1 imports and the existing web/API behavior.

**Tech Stack:** TypeScript, Zod, Drizzle/PostgreSQL, Express, Appium/WebDriver, React, TanStack Query, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-05-mobile-flow-matrix-catalog-design.md`

## Global Constraints

- Branch: `codex/mobile-flow-matrix-catalog`; base: `212e192`.
- Keep mobile steps flat. Existing 200 authored-step limit remains; cap expanded steps at 2,000 and executed step visits at 10,000 per device.
- `repeat` takes an integer from 1 to 200; `repeatWhile` fails beyond 200 iterations.
- Limit matrices to 20 nonempty, unique normalized pairs.
- Each target uses the test's platform, app and chosen grid.
- A group cannot call another group.
- Empty matrix means one target from existing `deviceName`/`osVersion`.
- Write bundle version 2; continue reading version 1 as empty mobile sections.
- Preserve `POST /api/mobile-tests/:id/runs` and its one-run response.
- Use tenant transactions and restrictive project policies; never let a body supply organization identity.
- Preserve `.claude/`, `cookies.txt`, `outputs/`, `scratch_cookies.txt`, `tmp/` and unrelated local files.
- No new runtime dependencies; keep EN/IT docs, existing locale conventions and Collaudo IDs.
- Live device validation is reported separately from mocked tests.

## Review Focus

1. A transport error during a visibility condition must fail, rather than become a false condition (Task 2).
2. A visible group may be referenced by an inaccessible test; deletion must refuse without exposing test names (Task 3).
3. Device/group edits after admission must not alter queued targets or retry definitions (Tasks 4–5).
4. A dry-run with groups created in the same file must resolve calls without allocating persisted IDs or versions (Task 6).
5. Duplicate names across native platforms and ambiguous destination keys must produce explicit import errors (Task 6).

## File Responsibilities

| Unit | Files | Responsibility |
|---|---|---|
| Mobile contracts | `shared/mobile.ts`, `shared/mobile-groups.ts` (new) | Action vocabulary, step/group/matrix validation and normalized targets |
| Persistence | `shared/schema.ts`, `migrations/0082_mobile_flow_matrix_groups.sql` (new), `migrations/meta/_journal.json` | Matrix column, native groups and database access policies |
| Comparisons | `server/value-comparison.ts` (new), `server/step-executor.ts` | Existing pure comparison grammar shared without importing the web executor |
| Native traversal | `server/mobile-flow.ts` (new), `server/mobile-runner.ts` | Condition evaluation, cursor traversal, bounded visits and result provenance |
| Group resolution | `server/mobile-step-groups.ts` (new), `server/routes/mobile-step-groups.routes.ts` (new), `server/routes.ts` | CRUD, dependency checks and expansion under tenant access |
| Run preparation | `server/mobile-run-preparation.ts` (new), `server/routes/mobile-tests.routes.ts` | Frozen definitions, transactional target admission, sequential batch dispatch |
| Plan targets | `server/mobile-plan-units.ts` (new), `server/test-execution-service.ts`, `server/run-shards.ts`, `server/execution-snapshot.ts` | Matrix units, snapshots, serialized target identity and separate results |
| Native bundles | `server/mobile-bundle.ts` (new), `server/test-bundle.ts`, `server/routes/tests.routes.ts` | Portable keys, deterministic export, import preview/save and versioning |
| Authoring | `client/src/components/mobile/MobileStepsEditor.tsx` (new), `MobileGroupDialog.tsx` (new), existing mobile dialogs/page | Shared native step controls, group management, matrix controls and run progress |

The new helpers isolate native behavior; do not reorganize unrelated routes or web execution.

### Task 1: Shared Contracts and Migration

**Files:** Modify `shared/mobile.ts`, `shared/schema.ts`, `shared/test-versioning.ts`, `migrations/meta/_journal.json`; create `shared/mobile-groups.ts`, `migrations/0082_mobile_flow_matrix_groups.sql`, `server/mobile-definition.test.ts`, `server/tests/mobile-groups-migration.test.ts`.

**Interfaces:** Export `MobileDeviceTarget`, `mobileDeviceTargetSchema`, `mobileDeviceTargets(test): MobileDeviceTarget[]`, `mobileFlowSteps(steps): Array<{ action: { id: string } }>`, and `mobileGroupSchema`/`MobileGroupInput`. Extend `MobileStepResult` with optional `stepId`, `sourceIndex`, `groupId`, `groupName`, `iterationKey`, `skipReason`. Add `MobileExecutionStep extends MobileStep` carrying optional group provenance. Define `MobileGroupDefinition = MobileGroupInput & { id: string }`.

- [x] Add failing schema tests with these fixtures; assert duplicate targets and unbalanced blocks fail, an empty matrix produces the legacy target, and platform-incompatible locators fail.

```ts
const definition = { name: 'Login', platform: 'android', app: 'bs://app',
  deviceName: 'Pixel 8', osVersion: '14', steps: [] };
expect(mobileDeviceTargets(definition)).toEqual([{ deviceName: 'Pixel 8', osVersion: '14' }]);
expect(mobileTestSchema.safeParse({ ...definition, deviceMatrix: [
  { deviceName: ' Pixel 8 ', osVersion: '14' }, { deviceName: 'Pixel 8', osVersion: '14' }
]}).success).toBe(false);
expect(mobileTestSchema.safeParse({ ...definition,
  steps: [{ id: 'i', action: 'if', value: 'true' }]
}).success).toBe(false);
```

- [x] Run `npx vitest run server/mobile-definition.test.ts server/tests/mobile-groups-migration.test.ts --maxWorkers=2`; confirm the added expectations fail before implementation.
- [x] Implement schemas with `superRefine`, the existing flow analyzer and per-action target/value rules. Conditional targets are optional; group calls require IDs; group bodies reject calls. Counts containing variable tokens validate syntax at save and range at run. Normalize OS absence to `null` and whitespace before deduplication.

```ts
export function mobileFlowSteps(steps: readonly MobileStep[]) {
  return steps.map(step => ({ action: { id: step.action } }));
}
export function mobileDeviceTargets(test: {
  deviceName: string; osVersion?: string | null; deviceMatrix?: MobileDeviceTarget[];
}): MobileDeviceTarget[] {
  return (test.deviceMatrix?.length ? test.deviceMatrix : [test]).map(target => ({
    deviceName: target.deviceName.trim(), osVersion: target.osVersion?.trim() || null,
  }));
}
```

- [x] Create the matrix JSONB column defaulting to `[]`. Create `mobile_step_groups` with tenant/platform/name uniqueness, platform and array checks, same-organization project FK, organization RLS and restrictive project read/write policies following migrations 0031/0057. Register schema and journal; inspect `server/db.ts`, schema doctor and organization lifecycle for explicit table lists and update those lists if needed.
- [x] Add `deviceMatrix` to mobile version fields and test snapshot/restore compatibility with older snapshots lacking it. Run the above suites plus `server/typed-test-versioning.test.ts` and `server/test-version-store.test.ts`; commit only Task 1 files as `feat: add mobile flow group and matrix contracts`.

### Task 2: Native Conditions and Flow Traversal

**Files:** Create `server/value-comparison.ts`, `server/mobile-flow.ts`, `server/mobile-flow.test.ts`; modify `server/step-executor.ts`, `server/mobile-runner.ts`, `shared/mobile.ts`, `server/routes/mobile-tests.routes.test.ts`.

**Interfaces:** `compareValues(expression: string): { value: boolean } | { error: string }`; preserve its re-export from `step-executor.ts`. `executeMobileFlow({ steps, platform, vars, session, elementTimeoutMs, onStep }): Promise<{ results: MobileStepResult[]; failure: string | null }>` consumes `MobileExecutionStep[]`, existing Appium session methods and `FlowCursor`. `performMobileTest` retains its current public arguments and outcome shape.

- [x] Add failing comparator equivalence and traversal tests. Extend the existing stand-in Appium hub to return visibility/text and controlled protocol errors. Exercise true/false branches and nested repeats with these definitions:

```ts
const branch: MobileStep[] = [
  { id: 'if', action: 'if', value: 'false' }, { id: 'no', action: 'tap', target: '~missing' },
  { id: 'else', action: 'else' }, { id: 'yes', action: 'tap', target: '~login' },
  { id: 'end', action: 'endIf' },
];
const looping: MobileStep[] = [
  { id: 'r', action: 'repeat', value: '2' },
  { id: 'type', action: 'type', target: '~email', value: '{{loopIndex}}' },
  { id: 'e', action: 'endLoop' },
];
expect(compareValues('2 >= 1')).toEqual({ value: true });
expect(compareValues('Paid contains aid')).toEqual({ value: true });
```

- [x] Run `npx vitest run server/mobile-flow.test.ts server/routes/mobile-tests.routes.test.ts --maxWorkers=2`; verify red expectations for branch routing and iteration results.
- [x] Move the comparator unchanged with its numeric helper; retain web imports/tests. Implement immediate native probes with WebDriver error-code classification. A `no such element` is absence; an invalid selector, broken session or transport failure throws. Expand variables with the existing native variable resolver. Parse `repeat` as an integer within 1–200 after substitution.
- [x] Traverse via `FlowCursor`; validate before session startup, bound step visits, emit separate iteration rows and skipped branch/failure metadata, preserve run secret redaction. Call the existing primitive executor only for native primitive actions. Keep screenshot capture and session/transport closure in the runner's existing cleanup path.

```ts
const analysis = analyseFlow(mobileFlowSteps(steps));
if (!analysis.ok) throw new Error(analysis.errors.join(' '));
const cursor = new FlowCursor(mobileFlowSteps(steps), analysis.blocks, vars);
const firstStep = steps[cursor.pc];
const firstResultIdentity = { stepId: firstStep.id, sourceIndex: cursor.pc,
  iterationKey: cursor.iterationKey() };
```

- [x] Pin the transport-error Review Focus case, malformed block rejection before `/session`, nested `loopIndex` restoration, 200-iteration and 10,000-visit failures, assertion false, undefined variables and cleanup on failure. Run flow/route/recorder/inspector and existing web comparator/cursor tests; commit `feat: execute native mobile conditions and loops`.

### Task 3: Native Group CRUD and Expansion

**Files:** Create `server/mobile-step-groups.ts`, `server/routes/mobile-step-groups.routes.ts`, `server/mobile-step-groups.test.ts`, `server/routes/mobile-step-groups.routes.test.ts`, `server/tests/mobile-group-isolation.test.ts`; modify `server/routes.ts`, `server/routes/mobile-tests.routes.ts`.

**Interfaces:** `referencedMobileGroupIds(steps): string[]`; `expandMobileGroups(steps, groups, platform): MobileExecutionStep[]`; `loadMobileGroups(tx: TenantTx, steps): Promise<MobileGroupDefinition[]>`; `prepareMobileSteps(tx, definition): Promise<MobileExecutionStep[]>`. Errors reject, rather than returning a partially expanded list.

- [x] Write failing pure expansion tests using a UUID group and a `callGroup` step; pin origin metadata, missing/platform-invalid groups, group calls within groups and expanded-size limits.

```ts
const groupId = '00000000-0000-4000-8000-000000000001';
const group = { id: groupId, name: 'Login', platform: 'android', steps: [
  { id: 'tap', action: 'tap', target: '~login' },
] };
expect(expandMobileGroups([{ id: 'call', action: 'callGroup', value: groupId }],
  [group], 'android')[0]).toMatchObject({ action: 'tap', groupId, groupName: 'Login' });
expect(() => expandMobileGroups([{ id: 'call', action: 'callGroup', value: groupId }],
  [], 'android')).toThrow();
```

- [x] Run `npx vitest run server/mobile-step-groups.test.ts server/routes/mobile-step-groups.routes.test.ts --maxWorkers=2` and confirm missing functionality.
- [x] Implement platform-filtered CRUD under tenant transactions with viewer/editor roles. Reuse project-editability behavior from native test routes. Translate duplicate names to conflict; validate references on test save. Expand one level, preserve source IDs/indexes and revalidate flow blocks after expansion.
- [x] Implement reference-safe deletion with an organization-bounded privileged existence check only when required to see inaccessible dependents; it returns a boolean, never names. Serialize dependency admission and group deletion under the same organization lock to prevent a new call racing deletion. Reject stale published references at preparation.
- [x] Add route tests for unauthorized/viewer/editable/restricted-project access and same-name groups in different platforms. Test the inaccessible-dependent Review Focus case on PostgreSQL with an actual non-superuser role; test cross-tenant group IDs as unavailable. Run targeted suites and commit `feat: add reusable native mobile step groups`.

### Task 4: Frozen Single Runs and Standalone Matrix Runs

**Files:** Create `server/mobile-run-preparation.ts`, `server/mobile-matrix-runs.test.ts`; modify `server/routes/mobile-tests.routes.ts`, `server/mobile-runner.ts`, `server/routes/mobile-tests.routes.test.ts`, `shared/test-versioning.ts`.

**Interfaces:** `prepareMobileRunDefinition(tx, test, target): Promise<Record<string, unknown>>` returns authored snapshot fields plus `executionSteps` and resolved target. `admitMobileRuns(tx, { test, grid, environmentId, targets, user }): Promise<MobileTestRun[]>` checks access/budget once and inserts all rows atomically. `dispatchMobileRuns(runs, organizationId, userId, start): Promise<void>` starts rows sequentially and records dispatch errors.

- [x] Extend route fixtures with two targets and a group. Add failing assertions for `{ runs: [...] }`, row snapshots containing distinct targets, and legacy `/runs` returning one ordinary row.

```ts
const targets = [{ deviceName: 'Pixel 8', osVersion: '14' },
  { deviceName: 'Pixel 9', osVersion: '15' }];
const gridId = browserstack;
const created = await request(app).post('/api/mobile-tests').send({
  name: 'Matrix login', platform: 'android', app: 'bs://app', deviceName: 'Pixel 8',
  osVersion: '14', deviceMatrix: targets, steps: [{ id: 'tap', action: 'tap', target: '~login' }],
});
const testId = created.body.id;
const response = await request(app).post(`/api/mobile-tests/${testId}/matrix-runs`)
  .send({ gridId });
expect(response.status).toBe(202);
expect(response.body.runs.map((run: { device: string }) => run.device))
  .toEqual(['Pixel 8 · 14', 'Pixel 9 · 15']);
```

- [x] Run `npx vitest run server/mobile-matrix-runs.test.ts server/routes/mobile-tests.routes.test.ts --maxWorkers=2` to demonstrate red behavior.
- [x] Resolve the selected published/working definition before matrix expansion. Acquire the existing organization lock and call `checkExecutionBudget` inside the admission transaction; validate every target/grid/environment/group before any insert. Existing quota meters elapsed minutes, not estimated future target cost: reject already exhausted budgets atomically, and preserve runtime exhaustion as explicit errors.
- [x] Persist `executionSteps` separately from authored `steps` and use resolved steps only at execution. Existing old snapshots lacking expanded content resolve once at start. Admit new runs only with frozen groups/targets; preserve published-version semantics and redact exposed rows as before.
- [x] Dispatch after transaction completion; await each run's existing start promise before the next target. A startup rejection marks that queued row `error` and continues. Pin post-admission test/group edits, target independence, depleted quota/no rows, invalid later target/no partial rows and transport closure before the next session. Run targeted/versioning/quota tests and commit `feat: run native tests across a frozen device matrix`.

### Task 5: Plan Matrix Units and Reports

**Files:** Create `server/mobile-plan-units.ts`, `server/mobile-plan-units.test.ts`; modify `server/test-execution-service.ts`, `server/run-shards.ts`, `server/execution-snapshot.ts`, `server/mobile-in-plans.test.ts`, `server/execution-snapshot.test.ts`, affected shard tests.

**Interfaces:** `MobilePlanTarget = MobileDeviceTarget & { key: string }`; `mobilePlanTargets(test): MobilePlanTarget[]` uses normalized position keys (`device-0`, `device-1`). Extend local `RunUnit` and serialized unit with optional `mobileTarget: MobilePlanTarget`. Frozen plan definitions carry `executionSteps` and `deviceMatrix`; restored helper units consume those snapshots.

- [x] Extend existing `seedPlan` tests to demonstrate one report per device despite browser/locale multiplication, and unique screenshot paths.

```ts
await seedPlan({ locales: ['it-IT', 'en-US'] }, { deviceMatrix: [
  { deviceName: 'Pixel 8', osVersion: '14' }, { deviceName: 'Pixel 9', osVersion: '15' },
] });
const { execution, rows, mobileRows } = await runPlan({ browsers: ['chromium', 'firefox'] });
expect(performMobileTest).toHaveBeenCalledTimes(2);
expect(mobileRows.map(row => row.browser).sort()).toEqual(['Pixel 8 · 14', 'Pixel 9 · 15']);
expect(new Set(mobileRows.map(row => row.screenshotUrl)).size).toBe(2);
expect(rows.filter(row => row.uiTestId === uiTestId)).toHaveLength(4);
expect(execution).toMatchObject({ status: 'completed', totalTests: 6, passedTests: 6 });
```

- [x] Run `npx vitest run server/mobile-plan-units.test.ts server/mobile-in-plans.test.ts --maxWorkers=2`; confirm two-target cases fail first.
- [x] Prepare native groups and targets once in the execution snapshot. Expand mobile links only on the first browser/locale lane. Pass an immutable target-specific definition to `performMobileTest` for all retries; use a fresh variable map per target. Serialize `mobileTarget` in shard work and restore it unchanged.
- [x] Store result device labels, group/iteration logs and artifact directories containing the target key. Add matrix cardinality to total progress/report aggregation. Preserve retries, quarantine and stop semantics; unfinished or failed targets must appear explicitly and affect aggregate status according to policy.
- [x] Test sharded helpers after group/definition edits, retry isolation, stop policy with remaining targets, quarantined failures, missing grids, published definitions, screenshot collisions and per-device analytics. Run targeted plan/shard/snapshot/analytics tests; commit `feat: expand mobile plan execution into device targets`.

### Task 6: Portable Mobile Catalog and Versioned Imports

**Files:** Create `server/mobile-bundle.ts`, `server/mobile-bundle.test.ts`; modify `server/test-bundle.ts`, `server/routes/tests.routes.ts`, `server/test-export.test.ts`; add native cases to route import tests and `server/tests/mobile-group-isolation.test.ts`.

**Interfaces:** `mobileGroupKey(platform, name): string` uses an unambiguous JSON tuple string. `exportMobileCatalog(tests, groups): { mobileTests: Record<string, unknown>[]; mobileStepGroups: Record<string, unknown>[] }`; `importMobileCatalog(tx, { bundle, projectId, dryRun, user }): Promise<MobileImportOutcome[]>`. Outcomes use `kind: 'mobile_test' | 'mobile_step_group'` and the existing created/updated/unchanged/invalid states. Extend `Bundle` with defaulted native arrays.

- [x] Add failing v2 YAML/JSON fixtures with native groups, matrices and calls; assert calls contain portable keys and secrets/installation IDs are excluded.

```ts
const emptyV1 = parseBundle(JSON.stringify({ kind: BUNDLE_KIND, version: 1 }));
expect(emptyV1.mobileTests).toEqual([]);
expect(emptyV1.mobileStepGroups).toEqual([]);
expect(mobileGroupKey('android', 'Login')).toBe('["android","Login"]');
expect(() => parseBundle(JSON.stringify({ kind: BUNDLE_KIND, version: 3 }))).toThrow();
```

- [x] Run `npx vitest run server/mobile-bundle.test.ts server/test-export.test.ts --maxWorkers=2` and confirm added assertions fail.
- [x] Write v2 envelopes, retain valid v1 reads and existing Gherkin behavior. Export native definitions filtered like web/API, resolve visible group dependencies and reject unresolved calls. Strip project/grid IDs and write stable sorted fields. Keep `app` unchanged and expose portability guidance in docs/UI.
- [x] Import groups first into an in-memory resolution map. Map portable keys to real destination IDs for saves, or temporary nonpersisted UUIDs for dry-run schema validation. Duplicate/ambiguous keys are invalid; an invalid group invalidates calling tests. Use savepoints or prevalidation so one invalid item does not abort unrelated item outcomes.
- [x] Match native tests by existing organization-unique name and reject platform conflicts. Match groups by platform/name; preserve IDs, existing projects and grids. Enforce editable projects before changing anything; use the native version store and audit on changed test saves. Compare normalized matrices/steps to suppress unchanged writes and versions.
- [x] Pin both import Review Focus cases, references to inaccessible groups, missing dependencies, new-group dry-run with zero persisted rows/versions/audits, renamed destinations, v1 compatibility and deterministic round-trip. Run catalog/import/versioning tests and commit `feat: include portable native tests in catalog bundles`.

### Task 7: Native Authoring, Group Management and Matrix Progress

**Files:** Create `client/src/components/mobile/MobileStepsEditor.tsx`, `MobileGroupDialog.tsx`, `MobileStepsEditor.test.tsx`, `MobileGroupDialog.test.tsx`; modify `MobileTestDialog.tsx`, `MobileRunDialog.tsx`, `MobileDialogs.test.tsx`, `client/src/pages/MobileTestsPage.tsx`, `MobileTestsPage.test.tsx`, `client/src/components/reports/StepDetailsDialog.tsx`, associated tests and locale files.

**Interfaces:** `MobileStepsEditor` props `{ steps: MobileStep[]; platform: MobilePlatform; groups: MobileGroupDefinition[]; allowGroups: boolean; onChange(steps: MobileStep[]): void }`. `MobileGroupDialog` wraps the editor with `allowGroups={false}`. Matrix run progress consumes `{ runs: Run[] }` and polls individual run IDs with distinct TanStack Query keys.

- [x] Write failing UI tests for optional conditional target/value controls, block indentation, platform-filtered groups, malformed-block errors, matrix row normalization and two independent progress rows.

```tsx
const onChange = vi.fn();
render(<MobileStepsEditor steps={[]} platform="android" groups={[]}
  allowGroups onChange={onChange} />);
fireEvent.click(screen.getByRole('button', { name: /add step/i }));
expect(onChange).toHaveBeenCalled();
render(<MobileStepsEditor steps={[{ id: 'i', action: 'if', value: 'true' }]}
  platform="android" groups={[]} allowGroups onChange={onChange} />);
expect(screen.getByText(/has no.*endIf/i)).toBeInTheDocument();
```

- [x] Run `npm --prefix client test -- --run src/components/mobile/MobileStepsEditor.test.tsx src/components/mobile/MobileGroupDialog.test.tsx src/components/mobile/MobileDialogs.test.tsx` and confirm the added features are absent.
- [x] Extract the existing step row controls into the shared editor without changing recorder behavior. Add flow labels/help, group options, inline block errors and provenance hints. Preserve additional step fields when serializing: replace the existing primitive-only save mapper with the validated complete native definition.
- [x] Add dedicated group CRUD management to the mobile page and matrix add/remove controls to the definition dialog. Make platform changes visibly invalidate incompatible entries. Keep single-device run behavior; add matrix admission and independently followed results. Invalidate native test/group queries after mutations and use URL-based fetch assertions.
- [x] Locate catalog UI callers via `rg -n 'import-bundle|/api/tests/export' client/src`; update the exact calling component to label native outcomes and explain Gherkin's web scope. Render report group/iteration metadata with old-log fallbacks. Add EN/IT and existing locale keys following current patterns; run client targeted tests and typecheck, then commit `feat: author mobile flows groups and device matrices`.

### Task 8: Documentation, Acceptance and Delivery

**Files:** Modify `docs/en/guide/mobile-apps.md`, `docs/it/guide/mobile-apps.md`, `docs/en/internals/mobile.md`, `docs/it/internals/mobile.md` and catalog guide sections found with `rg -n 'YAML|catalog|catalogo|import-bundle' docs/en docs/it`; create `docs/mobile-flow-matrix-acceptance.md`; update linked Collaudo cases where available.

- [x] Document the same runnable Android example in both languages:

```yaml
steps:
  - { id: banner, action: if, target: '~dismiss', value: visible }
  - { id: dismiss, action: tap, target: '~dismiss' }
  - { id: end-banner, action: endIf }
  - { id: retry, action: repeat, value: '2' }
  - { id: back, action: back }
  - { id: end-retry, action: endLoop }
deviceMatrix:
  - { deviceName: Google Pixel 8, osVersion: '14' }
  - { deviceName: Google Pixel 9, osVersion: '15' }
```

- [x] Add acceptance cases for true/false native branches, bounded loops, shared-group edits, frozen queued groups, two-target standalone and plan execution, native bundle preview/reimport and restricted-project access. Preserve existing MOB identifiers: append IDs after the current last case. Record expected/observed behavior, environment and evidence; do not mark cases passed from unit tests.
- [x] Run `npm run check`, `npm --prefix client exec -- tsc --noEmit -p .`, `npm test`, and `npm --prefix client test -- --run`. Verify affected PostgreSQL isolation with `WFM_TEST_REQUIRE_POSTGRES=1` using the configured non-superuser test database. If unavailable, record that limitation explicitly rather than substituting PGlite evidence.
- [x] Run a configured Appium smoke using the Collaudo setup if available; rebuild the existing named Docker stack only when validating its deployment. Keep volumes and avoid unrelated environment mutation. Document real device coverage or its concrete missing prerequisite.
- [x] Inspect the complete diff against the spec, check placeholder/error markers, `git diff --check`, intended file list and migration head. Record test counts and any justified skips. Commit docs and final adjustments as `docs: document mobile flow matrix and catalog acceptance`.
- [x] Push explicitly with `git push --set-upstream origin HEAD:refs/heads/codex/mobile-flow-matrix-catalog`. Create the PR against `main` using a body file describing before/after behavior and verified test evidence. Attach the created PR with the Codex artifact tool. Report the actual commit/PR state and live-validation limits.

## Execution Handoff

Recommended method: native execution in this session. The eight tasks share action,
snapshot and target interfaces, so keeping implementation context together avoids
repeated exploration. A final independent review follows the selected execution
workflow. Implementation starts after review of this plan and selection of the
execution method; no product implementation is included in this document commit.

## Execution record

Implemented on `codex/mobile-flow-matrix-catalog` from `212e192`. The native implementation keeps the existing primary checkout and preserves unrelated local files. Tasks 1–2 were committed together; tasks 3–7 share snapshot/catalog interfaces and are delivered together, with documentation separately.

Final independent review found matrix polling reset, frozen-publication eligibility, browser-dependent native lanes and whitespace dependency checks. All four are corrected and covered by regressions. Group provenance and same-organization project constraints are included in the existing schema drift checks.

Verified: TypeScript project checks; product and docs builds; 514 frontend tests plus two group-dialog tests; 21 BDD runtime tests; 78 targeted tests on disposable PostgreSQL using a non-superuser login and `app_user` tenant role. Full server regressions are recorded in the PR. Real Appium validation is unavailable because the existing Collaudo stack has agents/display but no device session; MOB-33–MOB-40 remain unexecuted acceptance cases.

Matrix admission uses the existing elapsed execution-minute quota; it does not estimate future device runtime. Existing test/grid/project behavior and bundle version 1 import remain compatible.

Delivery: [PR #296](https://github.com/Markg981/WebFlowMaster/pull/296), based on main. Real-device acceptance remains pending as recorded above.
