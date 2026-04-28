## 2026-04-28 - N+1 Query Resolution in Test Execution Plan
**Learning:** When executing test plans, querying the database within a loop over selected test links causes a significant N+1 query performance bottleneck.
**Action:** Use `inArray` to bulk fetch all related entities (e.g., UI tests and API tests) prior to the loop and store them in memory maps (O(1) lookup) to reduce the database load to exactly 2 queries regardless of the number of selected tests.
