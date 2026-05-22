## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2024-06-25 - O(N) Array memory slice in pagination
**Learning:** The `/api/selectable-tests` endpoint was loading all `tests` and `apiTests` models into a Javascript array, sorting them, and then using `.slice()` to paginate. This requires O(N) memory.
**Action:** Use Drizzle ORM's `unionAll` to combine unawaited queries and perform pagination directly at the database level with `.orderBy()`, `.limit()`, and `.offset()`.
