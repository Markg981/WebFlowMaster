## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2024-05-18 - PostgreSQL Count Casting in Drizzle ORM
**Learning:** When performing aggregation queries like `count(*)` using Drizzle ORM with PostgreSQL/PGlite, the returned count value is a string (bigint), not a number. If multiple counts are added together, this results in string concatenation bugs.
**Action:** Always wrap the aggregated count result with `Number()` (e.g., `Number(countResult.count)`) before performing arithmetic operations.
