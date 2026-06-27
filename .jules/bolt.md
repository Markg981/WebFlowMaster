## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2026-06-27 - Avoid Chaining Array Methods for Performance
**Learning:** When aggregating multiple metrics or filtering statuses from a large array, avoid chaining multiple `.filter()`, `.map()`, or `.forEach()` methods as it creates an O(K*N) bottleneck and unnecessary memory allocations.
**Action:** Combine them into a single `for...of` loop to calculate all metrics in a single O(N) pass, reducing runtime complexity and memory usage.
