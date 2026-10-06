# Historical replay implementation plan

**Goal:** Freeze UI/API definitions and their version provenance at enqueue; report input fingerprints and explicitly replay retained historical configuration.

**Authorization:** The user requested implementation on a new branch. Work locally from updated main; publication requires separate authorization.

**Design:** Extend the existing JSON configuration snapshot without a migration. Freeze effective published or working UI/API content in the enqueue tenant transaction. New workers must consume these fields without falling back to live definitions; historical snapshots keep their existing execution behavior and cannot claim complete replay. SHA-256 over canonical JSON identifies frozen definitions, datasets and plan settings. Reports expose only metadata and fingerprints. Replay copies a verified, complete snapshot, associates the source execution, starts a new manual attempt and respects current access, review and quota constraints.

**Limits:** Replay reproduces saved configuration and definitions, not external application state, live environment secrets, grids, agents, browser binaries, BDD profile revisions, quarantine or notification integrations. These dependencies are explicitly identified as live in provenance.

- [x] Add failing tests for changed UI/API definitions/publications, provenance stability, replay after plan edits, legacy refusal, tampering, tenant and role boundaries.
- [x] Add definition freezing, canonical fingerprints and safe provenance summary; use frozen content and captured versions in the worker, with current review enforcement.
- [x] Add replay command and authenticated route with quotas, idempotency, source lineage and no current-plan test selection.
- [x] Present provenance and explicit historical replay in report UI and exports; test failures and permissions.
- [x] Update EN/IT documentation and add pending Collaudo cases without altering historical cycles.
- [x] Run focused and broader regression suites, TypeScript, lint and builds; review final diff and report actual validation limits.

**Verification:** Full server suite: 2,359 tests passed, 4 skipped, across 254 files. Dedicated real BDD runtime: 21 tests passed. All 536 client tests passed. The 178 selected server regressions also passed independently. TypeScript, lint on all modified code, application build and documentation build passed. Collaudo: 13 application tests plus Chromium catalog test passed. 39 orchestrator/replay route tests also passed on isolated PostgreSQL 15 using a non-superuser bootstrap login (BYPASSRLS for fixtures) and `app_user` runtime tenant transactions. Two independent review passes; private snapshots were removed from existing execution responses and deleted definition result links were made safe. Seven manual cases REP-26…REP-32 remain Da eseguire. CI, deployment, authenticated acceptance and real-device replay remain unverified.
