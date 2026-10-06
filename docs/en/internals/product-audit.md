# Product and documentation audit

Analysis dated 6 October 2026, based on `main` at commit `1604f95`. This is a capability and
opportunity map for planning future work; proposals are not delivered features. Start with the
[complete suite handbook](./suite-handbook) to understand the existing product.

## Scope and confidence

Implementation update: queued runs now freeze web/BDD datasets and shared first-row variables
in `configuration_snapshot.datasets`; see [data fixed when queued](../guide/running#data-fixed-when-queued).
The priority table below preserves the original baseline findings. A dedicated dataset hash or
report UI and explicit historical replay remain separate enhancements; automatic retries reuse
the captured data. This does not freeze every test definition or external system state.

The repository inventory contained 1,264 tracked files before this revision: 494 under `server/`,
331 under `client/`, 44 under `shared/`, 40 under `scripts/`, 87 under `migrations/`, 41 under
`collaudo/`, 29 under `deployment/`, 8 under `e2e/` and 7 under `integrations/`. It includes 347
`.test.*` or `.spec.*` files. This counts files, not passing scenarios or coverage percentages.

The analysis connects the inventory, dependency graph, major flows, configuration, tests and
documentation. It is not a line-by-line review of every file or a penetration test. The graph
provided orientation; the evidence below was checked against current source. The entire acceptance
catalog, cloud providers, devices and integrations were not rerun. A CI job's existence does not
prove that its latest execution passed.

## Existing capabilities

| Area                | Present capabilities                                                                                                         | Main sources                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Authors and QA      | Web recording/building, sentence authoring, variables, groups, conditions/loops, datasets, manual tests, API, mobile and BDD | `client/src/pages/`, `server/step-executor.ts`, `server/mobile-runner.ts`, `server/bdd-execution.ts`                       |
| Catalog             | Projects, tags, suites, versions, review/publication, requirements/coverage and quarantine                                   | `shared/schema.ts`, `server/test-publishing.ts`, `server/test-version-store.ts`, `server/routes/`                          |
| Execution           | Plan snapshots, queues, workers, scheduling, browser/mobile matrices, grids and local agents                                 | `server/execution-orchestrator.ts`, `server/execution-snapshot.ts`, `server/test-execution-service.ts`, `server/worker.ts` |
| Evidence            | Per-step outcomes, configured screenshots/video/trace/HAR, visual testing, accessibility and exports                         | `server/report-model.ts`, `server/report-export.ts`, `server/artifact-store.ts`                                            |
| Integrations        | CI, CLI, REST v1, webhooks, trackers, commit statuses, test management and notifications                                     | `integrations/`, `server/routes/api-v1.routes.ts`, `server/commit-status.ts`, `server/test-management.ts`                  |
| Security/governance | Tenant/RLS, roles, API scopes, OIDC/SAML SSO, MFA, SCIM, audit, quotas and retention                                         | `server/middleware/tenancy.ts`, `server/routes/`, `server/tenant-quotas.ts`                                                |
| Collaboration       | Comments, mentions and shared dashboards                                                                                     | `server/routes/comments.routes.ts`, `server/routes/dashboards.routes.ts`                                                   |
| Operations          | Docker, migrator, backup/verify/restore, SaaS network checks, logs, Prometheus and OpenTelemetry                             | `scripts/wfm-backup.ts`, `deployment/saas-network/`, `server/observability/`                                               |

Mobile, BDD, backups, SCIM, quotas and telemetry should not be proposed as new features. Useful work
extends their reproducibility, operational verification and usability.

## Recommended priorities

P1 means work to consider before substantially expanding commercial delivery; P2 means a product or
acceptance extension; P3 means targeted maintenance. Effort is qualitative, not a contractual
estimate. Static findings are not presented as production incidents.

| Priority | Opportunity/category                                      | Code evidence                                                                                                                                                                                               | Proposed acceptance                                                                                                              | Effort      |
| -------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| P1       | **Freeze shared run datasets**. Reproducibility           | `server/test-data.ts:17` and `:26` read current values/rows; `server/test-execution-service.ts:864` and `:1005` resolves them at execution time; `server/execution-snapshot.ts:35` does not freeze datasets | Editing a dataset while a run is queued does not change its inputs/outcome; version/hash in report and same-data rerun           | Medium      |
| P1       | **Broaden critical UI acceptance**. Validation            | Nine scenarios in `e2e/installation.spec.ts:9`, one in `e2e/bdd.spec.ts:8`; not every SSO/MFA/SCIM, test recording, mobile, review, quota or deletion flow is covered through UI                            | Real federated login/MFA, authoring->review->run, quota and deletion journeys; screenshots/traces retained in CI                 | Medium      |
| P1       | **Application restore drill and S3 objects**. Operations  | `scripts/wfm-backup.ts:299` delegates the bucket; `:324` verifies checksums and database restore without application boot/report checks                                                                     | Isolated DB/object restore, login, decrypt a controlled test secret, open report/evidence and run a plan; measured RPO/RTO       | Medium-high |
| P1       | **Versioned reproducible releases**. Delivery             | Repository has `.github/workflows/ci.yml` for main/PR; CI bundles retained seven days (`:116`); `package.json:3` is `1.0.0`                                                                                 | Version tag, digest-addressed API/worker/agent images, migration manifest, changelog and tested upgrade from prior version       | Medium      |
| P1       | **Dependency/image gates**. Supply chain                  | CI runs checks/tests/build/docs without SBOM/image scanning jobs; tagged bases in `Dockerfile:20` and `Dockerfile.worker:9`, without explicit `USER`                                                        | Component inventory, scans, exception process and tested explicit runtime user compatible with browsers/files                    | Medium      |
| P2       | **Ramp/soak performance profiles**. New capability        | `shared/api-performance.ts:13` caps 200 iterations/10 concurrent requests; `server/api-performance.ts:26` repeats identical request/values                                                                  | Duration/ramp workload, per-virtual-user datasets, warm-up, percentiles and persisted verdicts; isolation from functional tests  | High        |
| P2       | **Platform endurance validation**                         | `scripts/wfm-load.ts:16` provides reads/bursts; `:104` caps 100 runs per target                                                                                                                             | Extended multi-tenant workload with agents, scheduling, artifacts and controlled restarts; no lost or duplicate runs             | Medium-high |
| P2       | **Public suite authoring API**. New capability            | `server/routes/api-v1.routes.ts:22` limits public contract to plans/runs/reports; authoring uses internal APIs                                                                                              | Stable project/test/dataset/import-export API, scopes/versioning; pipeline provisions a suite without private endpoints          | High        |
| P2       | **Certify actual matrices**. Compatibility                | UI E2E uses Desktop Chrome (`e2e/playwright.config.ts:16`); `server/browsers.ts:220` warns local runner cannot apply requested OS/versions                                                                  | Full journeys on three engines, one grid and an Appium device; requested and effective configuration in reports                  | Medium-high |
| P2       | **Extend WSDL import**. Interoperability                  | `server/wsdl-import.ts:78`, `:109`, `:111`, `:268`, `:272`: explicit rejection of restriction, groups/wildcards, nested compositors and RPC/encoded                                                         | Real WSDL with nested compositors/groups, valid skeleton and precise warnings; RPC/encoded only for a demonstrated customer need | Medium-high |
| P3       | **Split large service responsibilities**. Maintainability | `server/playwright-service.ts`: 2,377 lines; `server/routes.ts`: 1,814 lines                                                                                                                                | Incrementally extract recorder/detection/ad hoc and remaining routes, preserving contracts/tests; no general rewrite             | Medium      |

### Where to start

1. **Data reproducibility**: decide which inputs must be frozen, including secret handling; prove that
   editing a dataset while a run waits in the queue does not change that run.
2. **Sensitive journey acceptance**: add a small number of complete access/publication/execution flows,
   then extend engines and devices using measured coverage.
3. **Release and recovery**: identify exactly what the customer installs and verify upgrade/restore
   before promising recovery times or capacity.

API performance checks, the load tool, backup and real PostgreSQL RLS jobs already exist. Extend
their observed boundaries instead of replacing them without a concrete reason.

## Documentation audit

Before this revision there were **38 tracked pages per language**, 76 in total, covering users, administration,
security, API/CLI and internals. Design documents and plans under `docs/superpowers/` are historical
material: they can describe intent and are not delivery evidence.

| Gap                                                                   | Reader impact                                                       | Correction in this revision                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Internals introduction centered only on web/API                       | Hides full suite scope                                              | Updated introduction and complete IT/EN handbook                  |
| Overview with 59 migrations and `0058` endpoint                       | Obsolete repository map against journal through `0082`              | Reference to current journal instead of a fragile count           |
| BDD scattered across agent/CLI documentation                          | Author->version->agent->result journey hard to discover             | Dedicated IT/EN BDD user guide                                    |
| No single reading path for a new colleague                            | Reader must assemble the story across many pages                    | Suite handbook, personas, flows, prerequisites and detailed links |
| Technical conventions without a complete practical contribution route | Tenancy/migrations/API/tests/locales/acceptance steps can be missed | IT/EN implementation guide with extension points and checks       |
| Telemetry absent from sidebar                                         | Existing page hard to discover                                      | Administration menu link                                          |
| PGlite confused with real PostgreSQL RLS validation                   | Local tests mistaken for isolation evidence                         | Corrected architecture wording and distinct RLS verification      |
| README describes only two UI languages and OIDC                       | Incomplete first introduction                                       | Four UI languages, SAML and BDD listed                            |

New pages are linked from menus and introductory pages. Documentation remains bilingual; commercial
materials have separate IT/EN editions. The handbook explains relationships and delegates detailed
options to existing guides to prevent duplicate descriptions from drifting.

## Keep documentation complete

For each improvement, update the contract/data, user guide, operational prerequisites, public API
reference when applicable, architecture when the flow changes, translations and acceptance cases in
the same change. New pages need a counterpart in the other language and a menu entry.

`npm run docs:build` checks links and builds the site; it does not verify every procedure on a live
installation. `npm run docs:pdf` exports sections for offline reading. Record commit, environment,
commands and outcomes for installation, upgrade, restore, providers or devices. Avoid commercial
claims without measured evidence.

Turn the backlog into small changes with verifiable acceptance. The
[implementation guide](./contributing-guide) explains how to preserve the suite's invariants.

## Progress: reproducible releases

The [release path](../admin/releases) adds base digests, a Lighthouse lock, dual builds, CycloneDX SBOMs and a HIGH/CRITICAL gate. The manifest links images, commit and migration checksums. Release-tag CI and installed upgrade acceptance remain separate evidence to record before distribution.
