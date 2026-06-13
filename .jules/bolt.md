## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2026-06-13 - Replaced memory pagination with DB unionAll pagination
**Learning:** The /api/selectable-tests route was fetching all records into memory, concatenating, sorting, and then slicing. This is an O(N) memory bottleneck.
**Action:** Use Drizzle ORM's unionAll with .limit, .offset, and .orderBy directly at the database level to maintain O(1) memory and improve latency.
