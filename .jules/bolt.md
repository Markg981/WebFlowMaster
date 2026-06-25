## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2026-06-25 - Array Iteration Consolidation in Aggregations
**Learning:** Multiple array traversals (`.filter()`, `.forEach()`, `.some()`) are often chained when calculating aggregate metrics (e.g., test pass/fail counts, duration sums, distributions) from database results, creating an O(K*N) bottleneck. This is a common pattern in the reporting and execution services.
**Action:** When refactoring aggregations, always look for opportunities to combine multiple O(N) array passes into a single `for...of` loop to calculate all necessary metrics and reduce runtime complexity and memory allocations.
