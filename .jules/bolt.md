## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2025-06-20 - O(N) Loop Consolidation for Metrics Processing
**Learning:** Found multiple instances where large arrays of results were iterated over 4-6 times sequentially using `.filter()`, `.forEach()`, and `.map()` to build various aggregate metrics. This creates substantial array allocation overhead and O(K*N) complexity.
**Action:** Always combine sequential array reduction operations into a single `for...of` loop when extracting multiple metrics from a large dataset to minimize garbage collection overhead and ensure single-pass O(N) performance. Ensure that TypeScript types match when combining outputs (e.g. `string | number` for IDs).
