# Catalog pagination implementation plan

**Goal:** Bound catalog payloads for large organizations and retrieve definitions only when opened.

**Architecture:** Add `/api/catalog/tests`, `/api/catalog/api-tests`, `/api/catalog/mobile-tests` and `/api/catalog/test-data`. Preserve existing collection endpoints for integrations. Catalog responses are `{items,total,page,pageSize}` with SQL filtering and projection inside the tenant transaction. Default page size 25, maximum 100; deterministic name/id ordering. Search is a literal case-insensitive name substring; selected tags use AND semantics. Optional project/status filters apply to relevant test types. UI tests expose `kind` (`browser`, `manual`, `bdd`, `cucumber`) instead of definitions; datasets expose columns and rowCount instead of rows.

**Authorization:** The user explicitly requested implementation and a new branch. Proceed with reversible implementation choices under that authorization; publishing requires separate authorization.

- [x] Server: validation, SQL catalog query service, authenticated routes and UI-test detail route, regression tests for bounds/filtering/payloads and isolation.
- [x] Client: four paginated catalog managers, search and library tags on server, reset/clamp page, cancellation, detail loading/error handling for editing/using definitions, translations and tests.
- [x] Integration: review remaining catalog consumers, preserve legacy compatibility, EN/IT documentation and seven new pending Collaudo cases (catalog30).
- [x] Verification: 533 client tests; 66 selected server regressions; TypeScript; production and docs builds; 13 Collaudo application tests and Chromium catalog test; independent review. Lint passes excluding pre-existing untracked tmp scripts (15 existing warnings); raw npm run lint fails on tmp/admin-schema-inventory.ts. PostgreSQL15 service validation passed with a non-superuser login and app_user tenant transactions, covering pagination, tenant/restricted-project totals and dataset projection. Manual UI acceptance and CI remain unverified.
