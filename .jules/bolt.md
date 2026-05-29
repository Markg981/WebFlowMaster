## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2026-05-29 - [Drizzle ORM Pagination Optimization]
**Learning:** [Using `unionAll` combined with CTE via `$with` significantly reduces Node.js memory footprint when paginating datasets originating from multiple DB tables (e.g., UI vs API tests) instead of fetching all records into memory first.]
**Action:** [Always leverage database-level tools like `unionAll` and CTEs for multi-table pagination/sorting and avoid combining and slicing arrays in Node runtime.]
