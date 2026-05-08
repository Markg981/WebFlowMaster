## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2024-05-24 - O(N) Memory Bottleneck in In-Memory Pagination
**Learning:** Combining data from `tests` and `apiTests` tables by fetching all matching rows into arrays and slicing them in Node.js memory (`server/routes.ts` `/api/selectable-tests`) creates an O(N) memory and processing bottleneck that fails to scale for users with many tests.
**Action:** Use Drizzle ORM's `unionAll` (from `drizzle-orm/pg-core`) combined with `orderBy`, `limit`, and `offset` to perform sorting and pagination directly within the database query instead of in application memory.
