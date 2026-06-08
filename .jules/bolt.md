## 2026-06-08 - [Drizzle ORM UnionAll Pagination]
**Learning:** [When fetching multiple related models to paginate, fetching all rows into memory and slicing them using `Array.slice(offset, offset + limit)` can cause severe Node.js memory bottlenecks as the dataset grows. Using `unionAll` in Drizzle ORM to perform the query concatenation, sorting, and pagination at the database level drastically reduces memory consumption.]
**Action:** [Always use `unionAll()` and chain `.limit().offset().orderBy()` natively for SQL databases rather than downloading entire lists into Node memory.]
