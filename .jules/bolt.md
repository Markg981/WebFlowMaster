## 2025-02-28 - Resolving N+1 Database Query in Test Execution Service
**Learning:** Found an N+1 query loop in `test-execution-service.ts` where we fetch test definitions inside a `for (const link of selectedTestsLinks)` loop causing multiple sequential DB calls.
**Action:** Replaced the loop queries with bulk queries using Drizzle ORMs `inArray` and loaded them into a mapped structure for `O(1)` access before the execution loop.
