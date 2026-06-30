## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2023-10-27 - [Avoid multiple Array iterations when aggregating reporting metrics]
**Learning:** In reporting endpoints with large dataset structures like `testCaseResults`, chaining multiple `.filter().length` and multiple `forEach` loops for metrics and charts scaling creates a significant O(K*N) computational and memory bottleneck due to redundant iterations.
**Action:** Always combine array calculations, groupings, and data transformation operations for reporting endpoints into a single O(N) `for...of` loop.
