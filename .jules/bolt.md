## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2025-06-23 - Optimizing Loop Passes in Data Processing
**Learning:** Chaining multiple `.filter()` or `.forEach()` array passes for metric aggregations on large datasets generates severe performance bottlenecks (O(K*N) complexity) and unnecessary memory allocations.
**Action:** When aggregating metrics or filtering statuses from large arrays (like `testCaseResults` or `finalDetailedResults`), combine all conditional logic into a single `for...of` loop to ensure a single, highly efficient O(N) pass.
