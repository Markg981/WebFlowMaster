## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2026-05-21 - Memory Exhaustion via Array Pagination
**Learning:** In `/api/selectable-tests`, fetching all tests into Node.js arrays to do manual `Array.prototype.sort()` and `.slice()` causes high latency and memory spikes for large test suites. Drizzle allows performing this via the DB natively using `unionAll` on queries with matching interfaces.
**Action:** Always utilize Drizzle `unionAll()` with `.orderBy()`, `.limit()`, and `.offset()` applied to the unified subquery to push pagination and sorting workloads to Postgres rather than Node.js memory.
