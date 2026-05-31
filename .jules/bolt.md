## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2026-05-31 - Pagination with multiple tables using unionAll
**Learning:** The /api/selectable-tests endpoint was fetching all UI and API tests into Node.js memory arrays, combining them with the spread operator, sorting them in memory, and then manually slicing them for pagination. This O(N) memory allocation and processing causes severe performance bottlenecks for users with many tests.
**Action:** Use Drizzle ORM's `unionAll` function from `drizzle-orm/pg-core` to combine unawaited queries from different tables. Chain `.limit()`, `.offset()`, and `.orderBy()` directly onto the combined query to push pagination and sorting logic to the database, preventing memory bloat in Node.js.
