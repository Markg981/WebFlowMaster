## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2024-05-24 - Database Pagination with Union
**Learning:** In endpoints that aggregate multiple related tables (like `tests` and `apiTests`), fetching all rows into memory to sort (`.sort()`) and paginate (`.slice()`) causes catastrophic memory/CPU bloat for large accounts.
**Action:** To prevent O(N) memory bottlenecks when paginating combined data, always use Drizzle ORM's `unionAll` (imported from `drizzle-orm/pg-core`). Pass unawaited query builders to `unionAll` and append `.limit()`, `.offset()`, and `.orderBy()` to perform pagination directly at the database level.
