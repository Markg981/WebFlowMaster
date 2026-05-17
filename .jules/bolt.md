## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2026-05-17 - O(N) Memory Pagination with UnionAll
**Learning:** In endpoints that aggregate multiple entity types (e.g., UI tests and API tests) and paginate the results, fetching all rows into memory and using array concatenations and `.slice()` causes significant O(N) memory allocation and processing overhead as the tables grow.
**Action:** Use Drizzle ORM's `unionAll` (imported from `drizzle-orm/pg-core` for Postgres/PGlite). Pass unawaited query builders to `unionAll` and append `.limit()`, `.offset()`, and `.orderBy()` on the combined result to perform pagination directly at the database level.
