## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2024-07-06 - O(K*N) Array Iteration in Reporting
**Learning:** Processing large arrays of test results (`testCaseResults` in `server/routes.ts`) using chained `.filter()`, `.map()`, and `.forEach()` methods created unnecessary K passes (approx. 8 loops) and degraded API performance for large reports.
**Action:** Consolidate multiple array iterations into a single `for...of` loop to calculate all metrics, distributions, and groupings in a single O(N) pass, reducing runtime complexity and memory allocations.
