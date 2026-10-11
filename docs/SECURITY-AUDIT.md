# Security Audit Triage

Snapshot of `npm audit` findings and the decisions taken. Update it whenever dependencies change
or a finding's exposure changes.

How to report a vulnerability is in [SECURITY.md](../SECURITY.md).

**Last reviewed:** 2026-10-11.

## 11 October 2026

| | Before | After |
|---|---|---|
| Production dependencies (`npm audit --omit=dev`) | 10 (5 high, 5 moderate) | **0** |
| All dependencies (`npm audit`) | high findings through braces | 8 (6 moderate, 2 low), all development tools |

- braces 3.0.3 (CVE-2026-93687, no fixed release) is gone from both lockfiles: Tailwind 3 → 4,
  `@typescript-eslint` 7 → 8, and the unused `@types/jest` and `eslint-plugin-vitest` removed.
  The postinstall patch and the source-only release exception that covered it are removed;
  `server/tests/dependency-locks.test.ts` fails if braces or micromatch return.
- `moment` 2.31.0 (path traversal) and `tedious` 20.3.6 through `overrides` (it no longer
  depends on `sprintf-js`).
- Left: `drizzle-kit`/`esbuild` and `@tailwindcss/typography`'s `postcss-selector-parser`
  (moderate), `mermaid`/`katex` (low). Development tools only; the fix npm proposes for each is a
  downgrade of a major version.

## 24 September 2026

| | Before | After |
|---|---|---|
| Production dependencies (`npm audit --omit=dev`) | 15 (9 high, 5 moderate, 1 low) | **0** |
| All dependencies (`npm audit`) | 25 (2 critical, 11 high, 11 moderate, 1 low) | 7 (1 high, 6 moderate), all development tools |

### What changed

| Change | Findings it cleared |
|---|---|
| `puppeteer` removed. It was a production dependency used only by `scripts/generate-docs-pdf.js`, which now uses Playwright, already installed with its browsers. | `puppeteer`, `puppeteer-core`, `@puppeteer/browsers`, `extract-zip` (high: symlink path traversal) |
| `drizzle-orm` 0.39 → 0.45.3, `drizzle-kit` 0.30 → 0.31.11 | `drizzle-orm` (high: SQL injection through escaped identifiers) |
| `npm audit fix` (in-range updates) | `multer` (high: denial of service on crafted multipart), `express`, `body-parser`, `qs`, `ip-address`, `js-yaml`, `brace-expansion`, `browserslist`, `fflate`, `postcss-selector-parser` |
| `overrides.exceljs.uuid` = `^11.1.1` | `uuid` under `exceljs` (moderate). The fix npm proposes is downgrading `exceljs` to 3.4; instead its own `uuid` is lifted. exceljs only calls `v4()`, which uuid 11 provides. |
| Client: `vite` 5 → 6.4.3, `@vitejs/plugin-react` 4.3 → 4.7, `vitest` and `@vitest/ui` 3.2 → 4.1.11 (root and client) | `vitest`, `@vitest/ui` (critical), `@vitest/mocker`, `@vitejs/plugin-react`, the client's `vite` |

#### drizzle-orm 0.45 wraps database errors

From 0.45 a failed query throws `DrizzleQueryError`, whose message is "Failed query:" followed by
the SQL text and its parameter values, with the driver's error as `cause`. The application told a duplicate (409) from a
missing reference (400) by the database error, so those turned into 500s; and every log line and
error answer carrying `error.message` would have carried the query's parameters (password hashes,
encrypted secrets, test data). `server/db-errors.ts` removes the wrapper at the one method every
Postgres query goes through, so the application sees the driver's error as before; the server
refuses to start if a later drizzle-orm version moves that method, and `server/db-errors.test.ts`
checks both the SQLSTATE and that no SQL or parameter reaches a message.

#### Installing drizzle-orm 0.45 on Windows

`npm install drizzle-orm@0.45` fails with `ERESOLVE`: its optional peers (`expo-sqlite`,
`@op-engineering/op-sqlite`) name `react-native`, whose own peer wants React 19. None of them is
installed; npm's resolver still refuses. What worked: install once with `--legacy-peer-deps`, then
run a plain `npm install`, which restores the peers the first command dropped. Compare the lockfile
before and after: nothing but the replaced packages may disappear. On Windows, put back the
`@emnapi/*` entries npm drops (the architecture test names them).

## Remaining findings, all development-only

As of 11 October 2026.

| Package | Severity | Where it comes from | Exposure | Decision |
|---|---|---|---|---|
| `drizzle-kit`, `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `esbuild` | Moderate | `drizzle-kit` 0.31 (schema tooling) still depends on `@esbuild-kit`, whose esbuild accepts cross-origin requests to its dev server | `drizzle-kit` runs no server here; the application's migrations are hand-written SQL applied by `scripts/apply-migrations.ts` | The fix is `drizzle-kit` 1.0, in beta. Re-evaluate at its release. |
| `@tailwindcss/typography`, `postcss-selector-parser` | Moderate | typography 0.5.20, the latest, pins `postcss-selector-parser` 6.0.10 (quadratic parsing of flat selectors) | Build time only, on the application's own CSS | Forcing version 7 changes the parser's API under the plugin. Re-evaluate at the next typography release. |
| `mermaid`, `katex` | Low | diagrams in the documentation site (`vitepress-plugin-mermaid`) | The documentation build, on the repository's own pages | npm's fix is mermaid 10, a major downgrade. Re-evaluate at the next mermaid release. |

## How to review

```bash
npm audit --omit=dev     # production: must stay at 0
npm audit                # everything: each finding in the table above, or a new decision here
```
