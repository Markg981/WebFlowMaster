## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2026-05-09 - O(N) Array Combination Bottleneck
**Learning:** The selectable tests endpoint was manually fetching two entire datasets into Node.js arrays, concatenating them, and sorting in-memory () before paginating. This is extremely memory intensive for large datasets.
**Action:** Use Drizzle's `unionAll` to combine the queries, and apply sorting and pagination (LIMIT/OFFSET) directly at the database level to drastically reduce application memory overhead.

## 2024-05-24 - O(N) Array Combination Bottleneck
**Learning:** The selectable tests endpoint was manually fetching two entire datasets into Node.js arrays, concatenating them, and sorting in-memory (`Array.prototype.sort`) before paginating. This is extremely memory intensive for large datasets.
**Action:** Use Drizzle's `unionAll` to combine the queries, and apply sorting and pagination (LIMIT/OFFSET) directly at the database level to drastically reduce application memory overhead.
