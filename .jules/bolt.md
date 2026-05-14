## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.

## 2023-10-27 - Drizzle unionAll Order By Gotcha
**Learning:** When using `unionAll` in Drizzle ORM, applying `orderBy(asc(table.column))` can result in invalid SQL because table aliases are often lost in the union projection.
**Action:** Use `orderBy(sql\`column_name ASC\`)` instead to reference the correctly projected column name in the union result without table qualification.
