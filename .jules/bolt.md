## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2024-05-24 - O(N) Array Iteration Optimization
**Learning:** Chaining multiple `.filter()` calls on an array to aggregate metrics results in multiple O(N) iterations, causing unnecessary memory allocation and CPU overhead.
**Action:** When calculating multiple aggregations from an array, use a single `for...of` loop to compute all metrics in one O(N) pass. Also ensure you discard logs/ and lockfile changes before committing.
