## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2026-05-16 - [Drizzle unionAll optimization]
**Learning:** [Using unionAll pushes pagination array sorting processing to DB instead of handling massive queries in memory in nodejs using array slices. Remember to use 'unionAll' from 'drizzle-orm/pg-core', not the base 'drizzle-orm'.]
**Action:** [Leverage unionAll combined with DB limit, offset, and orderBy functions to combine queries without loading them to memory and slicing them manually.]
