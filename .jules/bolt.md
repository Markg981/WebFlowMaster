## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2024-06-17 - [Database-Level Pagination via Union]
**Learning:** By utilizing `unionAll` from `drizzle-orm/pg-core` with unawaited subqueries, we can delegate cross-table combination, sorting, and pagination entirely to PostgreSQL, avoiding memory exhaustion and large O(N) array slicing in Node.js.
**Action:** Identify endpoints pulling large datasets from multiple tables into memory simply to paginate them; refactor them using `unionAll` with `.limit()` and `.offset()` for true database-level pagination.
