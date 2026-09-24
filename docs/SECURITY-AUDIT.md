# Security Audit Triage

Snapshot of `npm audit` findings and the decisions taken. Update it whenever dependencies change
or a finding's exposure changes.

**Last reviewed:** 2026-09-24.

| | Before | After |
|---|---|---|
| Production dependencies (`npm audit --omit=dev`) | 15 (9 high, 5 moderate, 1 low) | **0** |
| All dependencies (`npm audit`) | 25 (2 critical, 11 high, 11 moderate, 1 low) | 7 (1 high, 6 moderate), all development tools |

## What changed

| Change | Findings it cleared |
|---|---|
| `puppeteer` removed. It was a production dependency used only by `scripts/generate-docs-pdf.js`, which now uses Playwright, already installed with its browsers. | `puppeteer`, `puppeteer-core`, `@puppeteer/browsers`, `extract-zip` (high: symlink path traversal) |
| `drizzle-orm` 0.39 → 0.45.3, `drizzle-kit` 0.30 → 0.31.11 | `drizzle-orm` (high: SQL injection through escaped identifiers) |
| `npm audit fix` (in-range updates) | `multer` (high: denial of service on crafted multipart), `express`, `body-parser`, `qs`, `ip-address`, `js-yaml`, `brace-expansion`, `browserslist`, `fflate`, `postcss-selector-parser` |
| `overrides.exceljs.uuid` = `^11.1.1` | `uuid` under `exceljs` (moderate). The fix npm proposes is downgrading `exceljs` to 3.4; instead its own `uuid` is lifted. exceljs only calls `v4()`, which uuid 11 provides. |
| Client: `vite` 5 → 6.4.3, `@vitejs/plugin-react` 4.3 → 4.7, `vitest` and `@vitest/ui` 3.2 → 4.1.11 (root and client) | `vitest`, `@vitest/ui` (critical), `@vitest/mocker`, `@vitejs/plugin-react`, the client's `vite` |

### drizzle-orm 0.45 wraps database errors

From 0.45 a failed query throws `DrizzleQueryError`, whose message is "Failed query:" followed by
the SQL text and its parameter values, with the driver's error as `cause`. The application told a duplicate (409) from a
missing reference (400) by the database error, so those turned into 500s; and every log line and
error answer carrying `error.message` would have carried the query's parameters (password hashes,
encrypted secrets, test data). `server/db-errors.ts` removes the wrapper at the one method every
Postgres query goes through, so the application sees the driver's error as before; the server
refuses to start if a later drizzle-orm version moves that method, and `server/db-errors.test.ts`
checks both the SQLSTATE and that no SQL or parameter reaches a message.

### Installing drizzle-orm 0.45 on Windows

`npm install drizzle-orm@0.45` fails with `ERESOLVE`: its optional peers (`expo-sqlite`,
`@op-engineering/op-sqlite`) name `react-native`, whose own peer wants React 19. None of them is
installed; npm's resolver still refuses. What worked: install once with `--legacy-peer-deps`, then
run a plain `npm install`, which restores the peers the first command dropped. Compare the lockfile
before and after: nothing but the replaced packages may disappear. On Windows, put back the
`@emnapi/*` entries npm drops (the architecture test names them).

## Remaining findings, all development-only

| Package | Severity | Where it comes from | Exposure | Decision |
|---|---|---|---|---|
| `vite` 5.4 | High | `vitepress` (the documentation site) bundles its own vite 5 | The documentation dev server (`npm run docs:dev`), on a developer's machine. The production build and the client do not use it. | No fix in vitepress 1.x. Re-evaluate at vitepress 2. Do not run `docs:dev` on an untrusted network. |
| `vitepress`, `vitepress-plugin-mermaid` | Moderate | the same vite 5 | As above | As above |
| `drizzle-kit`, `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `esbuild` | Moderate | `drizzle-kit` 0.31 (schema tooling) still depends on `@esbuild-kit`, whose esbuild accepts cross-origin requests to its dev server | `drizzle-kit` runs no server here; the application's migrations are hand-written SQL applied by `scripts/apply-migrations.ts` | The fix is `drizzle-kit` 1.0, in beta. Re-evaluate at its release. |

## How to review

```bash
npm audit --omit=dev     # production: must stay at 0
npm audit                # everything: each finding in the table above, or a new decision here
```
