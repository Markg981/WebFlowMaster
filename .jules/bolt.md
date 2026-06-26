## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2024-05-25 - O(N) Processing in Metric Aggregations
**Learning:** Functions like `calculateFinalTestPlanStatus` and report generation endpoint used multiple O(N) Array passes via `.filter().length`, `.map()`, and `.some()` on test results, causing an O(K*N) bottleneck.
**Action:** When aggregating multiple metrics or calculating summaries from arrays, combine them into a single `for...of` loop to calculate everything in one O(N) pass, reducing runtime complexity and memory pressure.
