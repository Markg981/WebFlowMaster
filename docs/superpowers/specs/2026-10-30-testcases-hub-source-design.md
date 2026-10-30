# Test cases from the CoE QA Test Cases Hub

Status: proposal written on 2026-10-30; waiting for the user's decision on the open points
in section 7. Nothing implemented.

## Question asked

WFM planned to import test cases from the per-module Excel workbooks (the Test Manager page
does a first, minimal version of that). The QA team now keeps the same cases in the git
repository `C:\Users\marco.oliva\source\repos\CoE-QA-TestCasesHub`, written by a desktop
application. Is the hub really the same data as the Excel, and how can WFM read the cases from
it when a user sets a path?

## 1. Verdict: the hub is the Excel, consolidated and newer

Comparison of the NCC workbook `Downloads\DMO NCC Test Scripts.xlsx` (2026-10-07) with the hub
at HEAD:

| Check                                                                      | Result                                      |
| -------------------------------------------------------------------------- | ------------------------------------------- |
| Excel ids present in the hub                                               | 917 / 917                                   |
| Hub NCC ids absent from the Excel                                          | 79 (18 created 2026-07, 61 created 2026-10) |
| functional_objective, steps, expected_outcome, feature_highlight, devops_id | identical on all 917                        |
| priority differs                                                           | 83 (edited in the hub after the export)     |
| version_from differs                                                       | 7                                           |

The fields of a hub `definition.json` are the columns of the Excel sheet "Test Cases" one to one
(id, priority, version from/to, SME effort, feature highlight, DevOps id, SME, functional
objective, input data / precondition, steps, expected outcome, the three reference-environment
variants, QA preparation/execution effort). Every case keeps `excel_last_hash`, the sha256 of the
Excel row it was imported from. The Excel columns that are *not* in the definitions (Team
Assigned, Stage, the four stage metrics, Final Test Result, Execution 1..3, Comments) are
execution data: in the hub they live under `Waves/`.

How the hub is maintained:

- The hub repo is pure data: 18 703 `definition.json`, `config/`, `Waves/`, `resources/`.
  Remote: `https://aveva-coe@dev.azure.com/aveva-coe/CoE-QA/_git/CoE-QA-TestCasesHub`,
  1 037 commits, authors are the QA team (initial load of 17 674 cases on 2026-07-08).
- The application is the sibling repo `CoE-QA-TestCasesManager` ("QA Test Cases Manager",
  Python 3.13 + PySide6, v0.20.5 on 2026-10-28). The operator sets `repo_path`
  (`config/user_config.py`); the app imports Excel workbooks (`core/excel_importer.py`,
  hash diff then create/update), edits the operator fields, plans waves, writes wave results
  back into the client Excel files (`core/wave_excel_updater.py`) and commits/pushes with git
  (`core/git_manager.py`, PAT credentials).
- Source of truth is therefore the JSON in git. The Excel is now the client-facing input/output.

## 2. What is in the hub (what a reader must know)

```
_metadata.json                  {"schema_version":"1","min_app_version":"0.9.0",...}
config/modules.json             [{module_name, tc_prefix, default_assignee, module_file_gen_code, backup_assignees}]
config/schema_version.json      {"schema_version":"3.1"}
config/users.json, wave_settings.json, column_views/, reports/, datasets/, ai_models.json
TestCasesDefinitions/<Module>/<TC_ID>/definition.json      (+ images/ in 484 cases)
Waves/<wave_id>/wave.json + results_<Module>.json
resources/<uuid>/definition.json + embedded/               (git LFS, 7.3 GB)
.local_cache/tc_index.json                                 (gitignored cache of the app, 36 MB)
```

Sizes: 21 modules, 18 703 cases; all `definition.json` together 37.8 MB (2 KB average);
images 1 126 files, 274 MB; `Waves/` 52 MB (18 waves, DMO 2.2.9 to 3.3.0); `resources/` 7.3 GB
(never needed by WFM).

Module prefixes (`config/modules.json`): ARC DMO Archiving, BOM, CIP, CLP, CON Connected
Worker, COR Core, ENE Energy, GSTD, IBC Intermediate Container Management, INV Inventory,
LR Ingredient Receiving, MP Material Preparation, TP Material Tipping, QUA MMS, NCC Net Content
Control, PER Performance, QSTAT, REC Recipe Management, SAF Safety, SET Setup, PW Waste
Management.

`definition.json` (schema_version 1.0 to 1.5, the app's current is 1.5):

- Always present: `id, definition_module, execution_module, status (active|deprecated),
  priority (Highest|High|Medium|Low), version_from, version_to, sme_effort_minutes,
  feature_highlight, execution_group, devops_id, sme, functional_objective,
  input_data_precondition, ref_env_precondition, steps, ref_env_steps, expected_outcome,
  ref_env_expected_outcome, qa_preparation_effort, qa_execution_effort, default_assignee,
  qa_review_assignee, excel_last_hash, created_at, updated_at, readiness_level (0..5)`.
- Only in newer files: `depends_on[]` (8 577), `force_not_tested_in_waves` + note (8 545),
  `code_refs[]` (6 875), `reviewer_notes` + `design_notes` (6 710); only in older files:
  `resources` (9 722).
- Readiness distribution: 0 Undefined 14 975, 1: 189, 2: 40, 3: 274, 4: 3 225, 5 Automated: 0.
- Ids are `{PREFIX}_TC_{N:05d}`; the folder name equals the id. 142 ids have mixed case
  (`Ene_TC_00077`); legacy client Excel files use 4 digits. The app normalizes with
  `core/tc_id_normalizer.py` (regex `^(.+_TC_)(\d+)$`, zero-pad to 5).
- Steps and expected outcome are free text with numbered lines, exactly as in the Excel.

Waves: `wave.json` (schema 2.0: wave_id, name, release, wave_type Smoke | Alpha Regression |
Beta Regression, tc_entries{tc_id, module, tester, stage A..G, stage metrics}) and one
`results_<Module>.json` (`qa_wave_results_v1`: tc_id, execution_status, tester, execution_date,
build_number, bug_reference, bug_priority, notes).

## 3. What WFM has today

- **Test Manager page**: `POST /api/upload-excel` parses six positional columns of the first
  sheet in memory (`server/integrations/excel-service.ts`), nothing is persisted; the Excel id
  is mapped to a saved test in `excel_sequences_map` (unique organizationId + excelTestCaseId);
  **Run selected** runs the mapped tests. Guide: `docs/en/guide/organizing.md` "Test Manager".
- **Manual tests**: a `tests` row whose sequence is `manualStep` steps `{action, expected}`
  (`shared/manual-tests.ts`), verdicts passed/failed/blocked in plans.
- **Import patterns to reuse**: bundles (`POST /api/v1/suites/import`, at most 500 tests),
  requirements from Jira/Azure DevOps (`issue_trackers` with encrypted PAT,
  `server/integrations/issue-providers.ts` already calls the Azure DevOps REST API), test
  management connections (`test_management_connections`, `test_case_links.caseKey`,
  `caseKeyFromName` "[KEY] name" convention), settings cards
  (`client/src/components/settings/*Card.tsx`).
- **Deployment constraint**: the server runs in Docker (collaudo too); the image has no git;
  agents do no file operations in the protocol. A path typed by a user is readable only if it
  is visible from the server container.

## 4. Proposal: a "Test case hub" source per organization

### What the user sees

- **Settings → Test case hub** (new card next to Issue trackers): one source per organization.
  Kind:
  - **Folder**: a path visible to the WFM server (dev, self-hosted, or a read-only volume in
    `docker-compose`). It must be a hub root: `_metadata.json`, `config/modules.json` and
    `TestCasesDefinitions/` present.
  - **Azure DevOps repository**: organization URL, project, repository, branch, PAT with
    *Code: Read*. Read through the Git REST API, so no git in the image and no LFS download.
  - Later, if needed: **Upload** of a zip of the hub, like the Excel upload.
  - **Test connection** returns modules, case count and head commit. **Sync now** imports;
    the card shows last sync, head, counts and warnings. Optional nightly sync.
- **Test Manager** becomes **Test cases**: the table lists the persisted cases with filters
  module, status, priority, readiness, version and text; columns id, module, priority,
  readiness, objective, mapped test, last result. The Excel upload stays as the second source
  for teams without a hub.
- Row actions: **Choose a sequence** (existing mapping), **Create manual test** (new), **Run
  selected** (existing). **Create manual test** builds a WFM manual test from the case and
  keeps the link, so a case can be executed in a plan with verdicts even before automation.
- Phase 4, optional: show the QA team's latest wave status of each case next to WFM's result,
  and export WFM verdicts in the `qa_wave_results_v1` format.

Persisted rows rather than parse-on-demand because 18.7k cases need filters, paging, stable
mappings, links to manual tests and an incremental diff. The Excel flow stays in memory
because it is one upload per session.

### Data model

Two new org-scoped tables, in `ORG_SCOPED_TABLES` with RLS like the other integration tables:

```
test_case_sources     id, organizationId, kind ('folder' | 'azure-devops'), name,
                      path | baseUrl + project + repository + branch,
                      encryptedToken / tokenIv / tokenAuthTag (same helper as issue_trackers),
                      lastSyncAt, lastSyncHead, lastSyncStatus, lastSyncError, caseCount,
                      createdBy, createdAt, updatedAt

external_test_cases   id, organizationId, sourceId, caseId (normalized, unique per org), rawId,
                      module, definitionModule, prefix, status, priority, readinessLevel,
                      versionFrom, versionTo, devopsId, sme, featureHighlight, executionGroup,
                      functionalObjective, precondition, steps, expectedOutcome,
                      refEnvPrecondition, refEnvSteps, refEnvExpectedOutcome, dependsOn jsonb,
                      forceNotTested, sourceUpdatedAt, contentHash, importedAt,
                      testId (nullable -> tests.id, the manual test created from the case)
```

`excel_sequences_map` stays the mapping table: the hub ids equal the Excel ids, so mappings
made from the Excel remain valid. Whether to add `externalCaseId` to it is an implementation
detail.

### Reader and sync (`server/integrations/testcases-hub.ts`, pure functions with unit tests)

- `readHub(files)` takes a list of `{path, content}` so the same parser serves the folder, the
  Azure DevOps fetch and a future upload. It reads `config/modules.json`, keeps only
  `TestCasesDefinitions/<Module>/<Id>/definition.json`, ignores `images/`, `.local_cache/`,
  `resources/`, `Waves/`. Schema 1.0 to 1.5 are tolerated (missing keys become null / []);
  a file without id, steps or expected outcome is skipped with a warning; ids are normalized
  (uppercase prefix, 5 digits); a folder name different from the id is a warning, the file id
  wins.
- Sync upserts by (organizationId, caseId) only when `contentHash` changed, in batches of 500;
  cases no longer in the hub get `status = 'missing'` instead of being deleted, because
  mappings and manual tests point to them. The whole hub is 38 MB of JSON: one sync of a
  few seconds, with a per-organization lock so two syncs do not overlap.
- Folder kind: walk the directory with the existing fs helpers; read only `definition.json`
  and `config/modules.json`.
- Azure DevOps kind: `GET {base}/{project}/_apis/git/repositories/{repo}/items?scopePath=
  /TestCasesDefinitions&recursionLevel=Full&versionDescriptor.version={branch}` lists the tree
  with the blob ids; keep the `definition.json` entries plus `config/modules.json`; download the
  blobs with `POST .../blobs?$format=zip` in batches and unzip in memory; head commit from
  `GET .../refs?filter=heads/{branch}`. Exact API shapes to be confirmed at implementation
  time against the ADO 7.x docs; the PAT handling is the one of `issue-providers.ts`.
- Security: the folder kind is enabled only when the operator sets `TESTCASE_HUB_ROOTS`
  (allowed roots, like `XLSX_UPLOAD_DIR`) and the given path resolves under one of them
  (realpath, no symlink escape); the server never lists arbitrary directories. PAT encrypted at
  rest, never returned by the API. Guards: at most 100 000 cases per source, 1 MB per
  `definition.json`, the zip-bomb checks of `xlsx-guard` reused for the blob zip. Every sync
  writes an audit_log entry.
- Quotas: external cases are not tests and do not count against the saved-tests quota until
  **Create manual test** is used.

### Mapping hub case to WFM manual test (only on explicit request)

| Hub field                                 | WFM                                                        |
| ----------------------------------------- | ---------------------------------------------------------- |
| id                                        | name prefix `[NCC_TC_00114]`, `external_test_cases.testId` |
| functional_objective                      | name (trimmed to 200 characters)                           |
| input_data_precondition                   | first step "Precondition: ..." (as in the demo script)     |
| steps + expected_outcome (numbered lines) | `manualStep` pairs; unmatched expected lines join the last |
| priority Highest / High / Medium / Low    | Critical / High / Medium / Low                             |
| definition_module                         | module                                                     |
| execution_group, feature_highlight        | featureArea, scenario                                      |
| devops_id                                 | tag now, issue link later                                  |

The line pairing is the one already validated in `Downloads\NCC-import\xlsx_to_wfm.py`.

### API

```
GET / POST / PUT / DELETE  /api/testcase-hub                   source config (admin); token never returned
POST                       /api/testcase-hub/test              -> { modules, count, head }
POST                       /api/testcase-hub/sync              -> { imported, updated, unchanged, missing, warnings[] }
GET                        /api/external-test-cases?module&status&priority&readiness&q&page   (viewer)
POST                       /api/external-test-cases/:id/manual-test                            (editor; bulk variant, max 500)
```

`/api/excel-mappings` and `/api/upload-excel` are unchanged.

## 5. Phases (each on its own branch, PR at the end, both test suites, docs EN+IT, collaudo cases)

1. **feat/testcase-hub-folder** (2–3 days): tables and migration, reader with fixture (three
   modules, a mixed-case id, a schema 1.0 and a 1.5 file, an `images/` folder, a `.local_cache`),
   settings card with the folder kind, test + sync routes, Test cases page on persisted rows,
   Excel upload kept. Docs: new section "Test cases from the QA hub" in `organizing.md` EN/IT,
   guide index row, data-model and database-schema pages. Collaudo: LIB "Hub: cartella e sync",
   LIB "Hub: filtri e mapping", SEC "Hub: path fuori dalle radici consentite".
2. **feat/testcase-hub-ado** (1–2 days): Azure DevOps kind, tree + blobs zip, test connection,
   scheduled sync. Collaudo: LIB "Hub: repository Azure DevOps".
3. **feat/testcase-hub-manual-tests** (1 day): create manual test from a case, bulk create,
   "Open test" on the row, link shown in the test library.
4. **Waves** (optional, 2 days): latest wave status per case, export of WFM verdicts.

## 6. What happens to the Excel plan

It stays valid and untouched: the Excel upload remains for teams without a hub and for quick
one-off checks. The hub source is the same data with ids, texts and priorities kept current by
the QA team, so for DMO it replaces the manual upload of one workbook per module.

## 7. Open decisions for the user

1. **First source kind.** Folder works today only on dev, self-hosted, or with a volume such as
   `- ./testcases-hub:/app/data/testcases-hub:ro` in the collaudo compose. Azure DevOps works
   on collaudo as it is and only needs a PAT with *Code: Read* on CoE-QA. Recommendation: the
   reader is shared, so build phases 1 and 2 back to back and ship both kinds.
2. **One hub per organization** (recommended) or per project.
3. **Deprecated cases**: import and hide by default (recommended) or skip.
4. **Images** (274 MB): not imported in phase 1; later as attachments of the manual test.
5. **Automatic manual tests**: no (recommended). Sync refreshes the external rows only; manual
   tests are created on request, so the testers' tests are never rewritten under them.
