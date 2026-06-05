## 2025-06-05 - DB Pagination Bottleneck
**Learning:** The application previously fetched multiple tables (UI tests and API tests) completely into memory before applying sorting, offset, and limiting. This O(n) memory and processing overhead caused a serious performance bottleneck for large test datasets.
**Action:** Utilize Drizzle ORM's `unionAll` to combine unawaited queries and perform pagination logic (ORDER BY, LIMIT, OFFSET) directly on the DB engine.
