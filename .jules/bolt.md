## 2024-05-24 - N+1 Query in Test Plan Execution
**Learning:** The `runTestPlan` function in `server/test-execution-service.ts` was executing a separate DB query for each UI/API test inside the sequential execution loop, causing an N+1 query bottleneck.
**Action:** Always batch fetch related models using `inArray` and store them in O(1) memory lookup maps (e.g., `new Map()`) prior to looping when querying associations inside loops using Drizzle ORM.
## 2024-05-25 - O(K*N) Array Passes in Report Generation
**Learning:** The reporting API endpoints were creating multiple intermediate arrays by chaining `.filter()` and `.map()`, and running multiple independent `.forEach()` loops over large result sets. This resulted in O(K*N) CPU operations and excessive memory allocations which is a bottleneck on endpoints fetching aggregated data.
**Action:** Consolidate multiple sequential array iterations and aggregations into a single `for...of` O(N) pass to minimize CPU cycles and eliminate temporary array memory footprints.
