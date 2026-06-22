## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2026-06-22 - [Array Filtering Bottlenecks in React Rendering]
**Learning:** React components frequently chain `.filter()` methods over the same array to compute multiple aggregate counts, leading to an O(K*N) bottleneck (where K is the number of filters) that allocates K temporary arrays per render cycle. This is an unnecessary source of garbage collection pressure and CPU time in UI thread.
**Action:** Always collapse multiple `.filter()` aggregations on the same array into a single `for...of` loop. Calculate all aggregated states in a single O(N) pass, completely eliminating intermediate array allocations.
