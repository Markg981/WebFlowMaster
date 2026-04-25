## 2023-10-27 - Test Execution Service N+1 Optimization
**Learning:** `server/test-execution-service.ts` had an N+1 query loop for fetching test configurations.
**Action:** Use `inArray` to fetch data and store it in an O(1) hash map before loop execution to eliminate DB round-trips.
