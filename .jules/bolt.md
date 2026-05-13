## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2026-05-13 - O(N) Memory Pagination fix
**Learning:** In `server/routes.ts`, the `GET /api/selectable-tests` endpoint was fetching all records into memory, sorting them, and then paginating. This caused an O(N) memory bottleneck for large result sets.
**Action:** Use Drizzle ORM's `unionAll` (imported from `drizzle-orm/pg-core`) to combine multiple queries, then apply `.orderBy()`, `.limit()`, and `.offset()` directly on the union query to perform pagination and sorting at the database level.
