## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2024-05-24 - Node.js Memory Exhaustion on Selectable Tests
**Learning:** The `/api/selectable-tests` endpoint was querying all matching UI and API tests into memory, concatenating them, and performing an O(N log N) in-memory array sort before paginating. This causes a severe memory and CPU bottleneck for users with large test suites.
**Action:** Use Drizzle ORM's `unionAll()` with `.as('alias')` to combine queries across tables and apply `.orderBy()`, `.limit()`, and `.offset()` at the database level to drastically reduce backend memory consumption and payload transfer time.
