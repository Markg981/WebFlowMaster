## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2024-05-25 - O(N) Array Operations in DB Queries
**Learning:** When combining results from multiple tables in Express endpoints (e.g., `/api/selectable-tests`), fetching all records into application memory to use `[...results].slice(offset, offset + limit)` introduces severe memory and CPU overhead at scale.
**Action:** Always leverage `unionAll` from `drizzle-orm/pg-core` to merge the query builders and chain `.limit().offset().orderBy()` to push pagination logic down to the database.
