## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2025-02-09 - O(N) memory slicing pagination in `/api/selectable-tests`
**Learning:** For `/api/selectable-tests`, fetching all tests and api tests from the database, then slicing the combined array in memory using `[...q1, ...q2].slice(offset, offset + limit)` leads to O(N) memory complexity, especially when querying multiple tables.
**Action:** Use `unionAll` from `drizzle-orm/pg-core` to combine the queries and apply `orderBy`, `limit`, and `offset` directly on the `unionAll` query so pagination happens at the database level.
