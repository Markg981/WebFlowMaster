## 2026-04-24 - [Drizzle ORM N+1]
**Learning:** This codebase executes automated test plans containing multiple UI and API tests. Loading their definitions individually within the execution loop creates an N+1 query bottleneck using Drizzle ORM against SQLite.
**Action:** Always map associations beforehand by extracting IDs, doing one batch fetch with `inArray`, and storing the items in an O(1) Javascript `Map` for quick lookups during the main execution loop.
