## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2026-07-03 - Array Iteration Bottlenecks
**Learning:** Repeatedly iterating over large arrays using chained `.filter()`, `.map()`, and `.forEach()` methods creates O(K*N) complexity and unnecessary memory allocations. This pattern was found in `server/routes.ts` and `server/test-execution-service.ts` when aggregating test results.
**Action:** Combine multiple array iterations into a single `for...of` loop to calculate all metrics and perform mappings in a single O(N) pass, significantly reducing runtime complexity and memory overhead.
