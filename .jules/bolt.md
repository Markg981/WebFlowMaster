## 2026-05-02 - Array Traversal Optimization
**Learning:** This codebase previously had 8 distinct loops traversing the same test results array for simple aggregations, incurring unnecessary iteration overhead.
**Action:** Always combine simple metrics counting, filtering, and grouping into a single O(N) pass, and be careful not to introduce dirty files during debugging.
