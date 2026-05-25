## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2024-05-25 - Prevent O(N) memory scaling for paginated union queries
**Learning:** Paginating and combining multiple tables (e.g. `tests` and `apiTests`) by fetching all records into node.js arrays, concatenating them (`[...a, ...b]`), sorting in JS, and then slicing creates an O(N) memory/compute bottleneck on the server that crashes as rows scale.
**Action:** Use Drizzle ORM's `unionAll` (imported from `drizzle-orm/pg-core`) on unawaited queries to perform the combination, counting, `limit()`, `offset()`, and `orderBy()` natively in PostgreSQL/PGlite.
