# QA hub: waves (results history), dashboard and re-execution — plan

Status: **implemented** (decisions in §7, what shipped in §8). Follows
`2026-10-30-testcases-hub-source-design.md` (PR #544, merged), which read the catalog and imported
chosen cases as manual tests but explicitly left out waves, bulk import and scheduled sync.

## 1. What the two repos hold (measured 2026-11-06)

**CoE-QA-TestCasesManager** — the PySide6 desktop app (Python 3.13). It writes the hub, plans the
waves, records results and writes them back to the SharePoint Excel workbooks. WFM never runs it:
it only defines the formats WFM has to read.

**CoE-QA-TestCasesHub** — pure data, git (Azure DevOps aveva-coe/CoE-QA):

| Area                                                           | Content                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TestCasesDefinitions/<Module>/<TC_ID>/definition.json`        | 18 703 cases, 21 DMO modules (Core 4 313, MMS 2 707, Performance 2 491 … Setup 6) — **already read by WFM**                                                                                                                                                            |
| `config/modules.json`                                          | 21 modules: name, `tc_prefix`, default assignee, backups                                                                                                                                                                                                               |
| `config/users.json`, `wave_settings.json`, `reports/*.json`    | testers, wave settings, desktop app report caches                                                                                                                                                                                                                      |
| `Waves/<wave_id>/wave.json` (schema 2.0)                       | 18 waves, DMO 2.2.9 → 3.3.0: name, release, major_release, wave_type (Smoke 14, Beta Regression 4), status (completed 15, archived 2, in_progress 1), start/target date, `tc_entries[]` (tc_id, module, tester, stage A/C/E/F/G, 4 stage-metric flags), workbook_links |
| `Waves/<wave_id>/results_<Module>.json` (`qa_wave_results_v1`) | 57 072 results: tc_id, execution_status, tester, execution_date, build_number, bug_reference, bug_priority, notes, `executions[]` (44 292 attempts)                                                                                                                    |

Status distribution: passed 40 729 · pending 14 120 (almost all in the open 3.3.0 wave) ·
not_tested 1 598 · failed 361 · on_hold 264. 589 results reference a bug. `Waves/` is 53 MB.

## 2. Goal

1. WFM holds **cases by module** and **every wave result**, in its own database.
2. The **dashboard** shows that history (pass rate by release/wave/module, trend, failures, bugs,
   testers, coverage) without going through the Excel files.
3. Cases are **ready to run again** in WFM: a new session built from a past wave
   (all, failed only, one module, one stage…), with manual verdicts recorded in WFM.
4. **Professional import**: preview, dry-run, idempotent, incremental, with a log and resumable.

## 3. "A WFM db": where the data goes

No second database. Same PostgreSQL as WFM, new tables scoped to the **organization** as for
`test_case_sources` / `hub_test_cases`. That way backups, migrations, RBAC, tenant isolation,
audit log and the dashboard queries stay the same. "Connecting the db" means linking the
organization to its hub source (already exists) and syncing it.

## 4. Architecture: two layers

```
Hub (folder / Azure DevOps)
   │  reader (extends server/integrations/testcases-hub.ts: Waves/ + config/modules.json)
   ▼
[1] Mirror layer — faithful copy, read-only, idempotent
    hub_modules, hub_waves, hub_wave_entries, hub_wave_results, hub_wave_result_attempts, hub_sync_runs
   │  materialization (explicit, per wave or per module)
   ▼
[2] Native WFM layer — what the existing app already understands
    tests (manual) · test_suites per module · test_plans per wave type
    test_plan_executions (one per wave, triggered_by='hub-import') · report_test_case_results
    run_work_items (bug_reference → Azure DevOps work item)
```

- **Mirror**: keeps everything as the hub has it (original status, stage, attempts, free-text
  tester, build). Feeds the **QA Waves** dashboard and the per-case history even for cases not
  yet imported as tests. Key `(source_id, wave_id, tc_id)`; each results file is skipped when its
  hash (git blob sha on ADO, sha256 on the folder) has not changed → a sync re-reads only the open
  wave.
- **Native**: turns waves into WFM executions, so **Dashboard Overview, reports, test history,
  flaky/failure analysis and issues work without new code**. The result points to the WFM test
  version imported from that case.

Status mapping (the original stays in the mirror):

| Hub        | WFM                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| passed     | Passed                                                                                                                                                       |
| failed     | Failed                                                                                                                                                       |
| not_tested | Skipped (reason "Not tested")                                                                                                                                |
| on_hold    | Skipped with the `blocked` verdict (reason "On hold"): counted with the skipped, so it does not fail the run, and exported back as `on_hold` (decision §7.4) |
| pending    | Pending (the open wave stays open, and its verdicts can be recorded in WFM)                                                                                  |

Attempts (`executions[]`): the last one is the result; the earlier ones go into the `attempt`
column / mirror and show up in the detail. Testers: name kept as text, optional mapping to WFM
users from `config/users.json` (email) — never creates accounts.

## 5. Features (UX)

**A. Settings → QA hub** (existing card): "Sync waves" toggle, sync now, optional schedule
(hourly / daily), last sync log (read / new / changed / errors).

**B. Import wizard** (Test Manager → QA hub → Import):

1. _Scope_: modules (with case counts), waves (release, type, status, date), "cases only" / "cases + results".
2. _Preview / dry-run_: how many cases will be created / versioned / skipped, how many results,
   unknown cases, conflicts — nothing written yet.
3. _Options_: WFM project, standard or ref-env steps, how to handle cases not yet imported
   (decision §7.3), status mapping.
4. _Run_: **background job** (bulk: thousands of cases and results, beyond the current 500 limit),
   progress bar, cancel, resumes from the checkpoint, final report downloadable as CSV.

**C. QA Waves dashboard** (new page, plus the existing widgets fed by the materialization):

- KPIs: active wave, % executed, % passed, open failures, bugs.
- Pass rate trend by release (2.2.9 → 3.3.0), split by Smoke / Beta Regression.
- Module × wave heatmap; burn-down of the open wave against the target date.
- Top failing cases (failure history over the last N waves), bugs by priority, load by tester/stage.
- Drill-down: wave → module → case (definition, results across all waves, attempts, bug link).

**D. Running again**:

- "New session from a wave": pick a past wave + filters (modules, stage, failed/not_tested only,
  tester) → creates the WFM run with manual tests in Pending, assigned to testers.
- Verdicts are given in the run report (existing flow `manual-results.routes.ts`).
- Optional export of WFM verdicts as `results_<Module>.json` (`qa_wave_results_v1`) or CSV,
  for the QA team to load into the desktop app. **WFM never writes into the hub repo**: the
  desktop app owns its git and its Excel files.

## 6. Phases (one PR each, own branch off main, docs EN+IT and collaudo cases in each)

| #   | Content                                                                                                                                                                                                                                    | Estimate |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| P1  | Mirror: migration (hub_modules, hub_waves, hub_wave_entries, hub_wave_results, attempts, hub_sync_runs), Waves reader for folder + ADO, incremental hash sync, tolerant schema validation (zod), tests on fixtures taken from the real hub | 2–3 d    |
| P2  | Bulk catalog import per module as a background job (reuses the existing selective import), preview/dry-run, progress, resumable                                                                                                            | 2 d      |
| P3  | Materialization: plans per wave type, suites per module, one execution per wave, results linked to the version, bugs → run_work_items; idempotent (re-materializing does not duplicate)                                                    | 3 d      |
| P4  | QA Waves dashboard + drill-down + per-case history in the test detail                                                                                                                                                                      | 3 d      |
| P5  | New session from a wave, `qa_wave_results_v1`/CSV export, scheduled sync                                                                                                                                                                   | 2 d      |

Measured risks: a 16 000-result execution (wave 3.3.0) → the report and queries need
pagination/indexes (check in P3 with a load test on the real data); archived waves with
hub-format changes (tolerant parsing, 2.2.x schemas); per-hour API limits on the ADO kind
(batching + blob sha).

## 7. Decisions (taken 2026-11-06)

1. **One DB**: same PostgreSQL, per-organization tables with RLS. ✔
2. **Dashboard**: waves materialized as WFM plans and runs _and_ a dedicated QA waves view. ✔
3. **Cases not yet imported**: imported automatically by the wave import. ✔
4. **on_hold** → both: the result is Skipped (a run is never failed by a case that could not be carried out) and carries the `blocked` verdict, so it stays distinct from `not_tested` and goes back to the hub as `on_hold`. ✔
5. **Write-back**: export file only (`results_<Module>.json` or CSV); WFM never writes into the hub. ✔

## 8. What shipped (branch `feat/qa-hub-waves`, one PR instead of P1–P5)

- **Tables** (migration `0104_hub_waves.sql`, same-organization foreign keys, RLS): `hub_waves`
  (one row per wave, its counts, content hash, and the plan and run it became), `hub_wave_results`
  (one row per case result with tester, stage, stage metrics, build, bug, notes and the earlier
  attempts as `jsonb`) and `hub_jobs` (background sync and import jobs). The six tables of P1
  became three: entries and results are one row, attempts a column, sync runs a job.
- **Sync** (`POST /api/testcase-hub/waves/sync`, a job): reads `Waves/` from the folder or the
  Azure DevOps repository, re-reads only the waves whose files changed, marks the waves gone from
  the hub instead of deleting them. One live job per source (`409 job_running`), stale jobs
  released after `HUB_JOB_STALE_MS`.
- **Import** (`POST /api/testcase-hub/waves/import`, a job, at most `HUB_WAVE_IMPORT_MAX_WAVES`):
  the missing cases are imported from the catalog first (one suite per module), then each wave
  becomes one plan and one ended run with the QA team's verdicts. Importing again updates the run
  and keeps the verdicts given in WFM (the imported marker on manual verdicts).
- **QA waves tab** in Test Manager (`/test-manager?source=waves`): KPIs, results trend across the
  waves, per-module totals, the waves list with sync, import and job progress; a wave detail with
  per-module and per-status results, search and pagination, a link to the run.
- **Running again**: `POST /waves/:id/session` creates a plan with the wave's cases that are tests
  in WFM, filtered by module, stage, status and tester (the dialog proposes failed and on hold).
- **Export**: `GET /waves/:id/export?format=json&module=` (the hub's `qa_wave_results_v1`, with the
  WFM verdicts) or `format=csv`.
- **Case history** across the waves: `GET /waves/cases/:caseId/history` (API only for now).

Not done yet, for a later PR: scheduled sync, module × wave heatmap and burn-down, top failing
cases, bugs linked as run work items, tester mapping to WFM users, and the case history in the
test detail page.
