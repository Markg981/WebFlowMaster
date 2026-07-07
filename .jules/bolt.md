## 2024-06-25 - Drizzle ORM unionAll Count Coercion
**Learning:** PostgreSQL (and by extension PGlite) returns `count(*)` results as strings, even when using Drizzle ORM's `sql<number>` generic typing. Failing to cast the result to a JavaScript `Number` can cause string concatenation bugs downstream during mathematical operations.
**Action:** When calculating total counts using Drizzle ORM (e.g., fetching a raw count from a union query `db.select({ count: sql<number>... })`), explicitly cast the result to a number via `Number(result[0]?.count) || 0`.

## 2024-06-25 - Workspace Hygiene with Untracked Files
**Learning:** `git restore` and `git checkout` commands only apply to tracked files. Untracked files (like generated `logs/` files or throwaway scripts) will block clean-ups and accidentally end up in the staging area if not handled.
**Action:** Before committing, always run `git status`. Use `rm -rf` or `git clean -fd` to delete unwanted untracked files or directories in addition to restoring tracked changes.
