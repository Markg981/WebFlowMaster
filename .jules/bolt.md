## 2024-04-19 - [Fixing N+1 Queries in Execute Test Plan Loop]
**Learning:** Found a specific N+1 bottleneck where tests associated with a Test Plan were individually queried from the database inside a `for` loop in `executeTestPlan`. This is an architectural trap in Drizzle codebases looping over associations.
**Action:** Always batch fetch related models using `inArray` and store them in memory lookup maps (e.g., `new Map()`) prior to looping when dealing with associations in a plan execution context.
