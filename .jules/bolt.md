## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2024-05-24 - N+1 Array Memory Bottleneck in Selectable Tests Pagination
**Learning:** When combining multiple test types (UI, API) in paginated endpoints, fetching everything into Node.js arrays, combining, sorting, and then slicing is an O(N) memory and compute bottleneck for users with a large number of tests.
**Action:** Use Drizzle ORM's `unionAll` (imported from `drizzle-orm/pg-core`) to perform database-level combining, sorting, and pagination by passing unawaited query builders to it and appending `.orderBy()`, `.limit()`, and `.offset()`.
