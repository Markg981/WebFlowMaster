# Product audit and v1 acceptance

Updated on 8 October 2026 against main commit `c24cbea` (merged PR #311).
The suite covers its functional scope. Closing v1 still requires current acceptance, an installed
release and evidence from the environments included in customer support commitments.
Read the [complete handbook](./suite-handbook) for roles and workflows.

## Scope and confidence

This audit compares source, documentation, the acceptance catalog and CI evidence. It is neither
a penetration test nor certification of the entire manual catalog. Main CI on `c24cbea` passed,
including real PostgreSQL isolation, application recovery, network checks and UI E2E on three engines.
CI success does not establish publication or installation of a release.

The 6 October baseline is superseded for pagination, snapshots/replay, API/mobile authoring,
load profiles, critical E2E, local recovery and expanded WSDL import. These capabilities are
implemented and should not be described as missing development.

- Paginated catalogs, server filters and detail on demand: `server/catalog.ts` and
  `server/routes/catalog.routes.ts`.
- UI/API/mobile definitions and datasets frozen at enqueue, hashes/provenance and historical replay:
  `server/execution-definitions.ts`, `server/execution-provenance.ts` and
  [execution](../guide/running). Replay uses current external systems, devices and secrets.
- Public UI/manual/BDD/API/mobile authoring and import/export with scopes, versions and audit:
  [public API](../reference/api).
- [Load tests](../guide/load-tests): warm-up, ramp/hold, per-user/iteration data, percentiles and
  persisted outcomes. Current limits: 200 users, one hour, one run per organization; server generation.
- Critical E2E on Chromium, Firefox and WebKit: `e2e/playwright.config.ts` and
  `e2e/critical-workflows.spec.ts`. Real grids and Appium use a separate certification command.
- Local recovery and resilience on disposable stacks: `npm run backup:drill` and
  `npm run load:resilience`. Synthetic fixtures do not establish production RPO/RTO or capacity.
- [WSDL/XSD](../guide/api-tests): nested compositors/model groups, occurrences and wildcard warnings;
  customer contracts still need compatibility acceptance.
- [Releases](../admin/releases): digest-pinned bases, non-root runtime, reproducible builds,
  SBOMs and security gates are implemented. Publication and upgrade need separate evidence.

The current source catalog is `collaudo/casi.json`: protocol 42, 583 cases. The local 27 September
cycle holds 299 outcomes (290 pass, 8 blocked, 1 N/A) with its frozen catalog. Local alignment
loads the current catalog and opens a new pending cycle; automated outcomes do not become
manual acceptance results.

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

## Conditions for closing v1

| Priority | Remaining work | Required evidence |
| --- | --- | --- |
| High | Current acceptance and regression | New cycle on the installed commit; all P1 pass or justified N/A, no failed P2 without a decision and at least 95% of P2 executed. Frozen history. |
| High | Installable release and upgrade | Verified candidate, matching manifest/SBOM/digests, staging from the previous baseline, verified backup, login/report/new run and rollback according to schema compatibility. OPS-20…OPS-25. |
| High when S3 is in scope | Real S3 recovery | Disposable bucket, checkpoint key/version/checksum inventory, recoverable versioning/replication, report/baseline/tenant checks. OPS-31. |
| High | Representative capacity and recovery | Declared workload/data/resources, agreed duration/thresholds, no lost/duplicate runs, retained evidence and phase timings. OPS-27…OPS-30, OPS-32…OPS-35. |
| According to declared support | Real grids and Appium | Observed session/capabilities matching requested targets, functional result, report and exports. AUT-11…AUT-12. |
| By 6 November 2026 | braces dependency | Upstream verification, effective mitigation and fresh scans; remove the exception only after verifying an equivalent fix. Expiry is not extended automatically. OPS-26. |

The local recovery drill covers the database and local artifacts. S3 object recovery is external.
SIGTERM is tested as controlled recovery; after SIGKILL, the identified run ends as
`worker_lost` without automatic replay to prevent duplicate operations on the system under test.
A passing crash diagnosis does not certify continuation of the interrupted run.

The operational acceptance record is `collaudo/v1-closure-2026-10-08.md`, listing executed checks,
missing prerequisites and local evidence references. SaaS billing remains suspended; including it
in the commercial scope requires separate requirements and implementation.

## Requirement-dependent extensions

Distributed load, higher limits, SOAP RPC/encoded/complex restrictions and automatic crash recovery
need a concrete requirement and verifiable acceptance criteria. Incremental refactoring of larger
services is maintenance, not a general prerequisite for closing v1. Avoid rewrites and scope growth
during acceptance.

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
