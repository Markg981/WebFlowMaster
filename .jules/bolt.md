## 2026-04-20 - [Fixing N+1 Queries in test plan executions]
**Learning:** `executeTestPlan` in `test-execution-service.ts` had an N+1 query loop when reading ui or api test metadata for every test link execution.
**Action:** Always batch fetch ORM records with `inArray()` instead of iterating inside a for loop, storing fetched arrays into `Map()` for O(1) loop retrieval.
