## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2024-05-24 - O(N) Memory in Pagination
**Learning:** The `/api/selectable-tests` endpoint was executing queries without limits, loading entire datasets into Node.js memory just to slice arrays for pagination.
**Action:** Always use database-level pagination combined with `unionAll` (from `drizzle-orm/pg-core`) instead of `Array.prototype.slice()` and JS-side `.sort()` when combining results from multiple tables.
