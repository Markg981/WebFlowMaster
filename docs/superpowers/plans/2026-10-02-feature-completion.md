# Complete API, BDD and collaboration features

Goal: Complete the user's six requested capabilities on claude/vibrant-allen-8mh32x, continuing existing commits.

The existing commits implement SOAP/WSDL, WebSocket, unary gRPC, downloaded-file assertions, browser location and an organization SMS inbox. Verify these through focused regression tests and build checks. Extend existing test bundle import/export for Gherkin, add comments to tests and results, and persist per-user dashboard layout. Follow the existing Express/Drizzle tenancy, project access, React/i18n and migration patterns.

Constraints: preserve unrelated local files, do not change .claude/, retain the requested branch, do not push or merge. Reject invalid input explicitly; do not turn imported Gherkin prose into executable browser actions without a mapping. Test authorization and tenant isolation. Use existing dependencies where possible.

## Tasks

- [x] Audit and test existing protocol/download/location/SMS implementations; fix concrete failures.
- [x] Gherkin: import Feature/Background/Scenario/Scenario Outline/Examples as manual test steps, and lossless export of supported web test steps; integrate the existing Tests as files dialog and bundle routes. Explicitly describe execution limits. Add parser and route tests.
- [x] Comments: organization-scoped persistence with target visibility checks, authenticated authors, nonempty bounded text, edit/delete ownership and administrator moderation; UI on library tests and reports. Add migration, route tests and component tests.
- [x] Dashboard: per-user persistent widget visibility/order, validated bounded preferences and accessible controls; preserve current default layout and metrics. Add API and UI tests.
- [x] Integrate shared schema, route registration, migration journal and locale changes, and update English/Italian documentation.
- [x] Run focused tests, type checks, client/server builds and broader suites; record outcomes and any environment-dependent limits.

## Review focus

Cross-tenant and restricted-project access; malformed or unsupported Gherkin; SMS polling freshness and pattern behavior; invalid dashboard widget ids and duplicate positions; changes to pre-existing defaults and import/export compatibility.

## Execution ledger

- Branch fetched and checked out at 176a557. Existing untracked .claude/, cookie files, outputs/ and tmp/ preserved.
- Existing graph queried; it reflects older code, so feature status must be verified from current source and tests.
- Synced installed dependencies with branch lockfile using npm ci --ignore-scripts. Existing features: 30/30 regression tests pass, including real SOAP/WebSocket/gRPC servers, PDF/CSV downloads and browser geolocation.
- CSV quote-aware separator detection and UTF-8 BOM handling fixed through RED/GREEN tests.
- Gherkin English subset supports scenarios, backgrounds, outlines/examples and tags; prose stays manual. WFM metadata preserves exported browser actions. UI and CLI support .feature. Restricted-project dry runs now reject impossible writes.
- Comments added to UI/API/mobile saved tests and report results. Independent review found and resolved account-switch cache disclosure and disclosure following deletion of private tests. Cleanup verified under app_user as a restricted-project editor, with cross-tenant data preserved.
- Six composite organization FKs added; deleted authors become null while comment text remains, and personal layouts cascade with the user. Organization export/erasure registry updated. Catalogue and member-removal checks: 33/33 pass.
- Final client suite: 436/436 pass. Final server suite: 1,958 passed, 1 skipped, 0 failed across 196 files. Final product build, documentation build, typecheck and scoped lint pass. JSON/log evidence is under tmp/codex-feature-*-results.json and tmp/codex-feature-*-suite.log. Temporary localhost Redis is stopped after verification.
- No commit, push, merge or live application database migration performed. Test migrations apply to per-file in-memory databases only.
