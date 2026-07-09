# Security Audit Triage

Snapshot of `npm audit` findings and the decisions taken. Update when dependencies
change or a finding's exposure changes.

**Last reviewed:** 2026-07-09 — `npm audit`: 10 vulnerabilities (2 critical, 2 high, 6 moderate).

## Decision summary

No fixes applied. Every finding is either **dev-only** or **not exploitable in this
application's usage**, and every available fix is a **breaking** major bump (or a
downgrade) with no real security benefit here. Re-evaluate on the next dependency
migration.

## Findings

| Package | Severity | Advisory | Exposure here | Decision |
|---|---|---|---|---|
| `drizzle-orm` `<0.45.2` | High | SQL injection via improperly escaped SQL **identifiers** (GHSA-gpj5-g38j-94v9) | **Not exploitable** — the codebase builds no dynamic identifiers: no `sql.identifier` / `sql.raw` usage; all table/column names come from the static schema. | Defer. Bump to ≥0.45.2 during a planned Drizzle migration (see below). |
| `vitest` / `@vitest/ui` `<=3.2.5` | Critical | Vitest UI server allows arbitrary file read/execute (GHSA-5xrq-8626-4rwp) | **Dev-only.** Triggers only while the Vitest UI server is listening (`npm run test:ui`). `@vitest/ui` is not a direct dependency; CI/prod never run it. | Defer to a coordinated Vitest bump. Don't run `test:ui` on an untrusted network. |
| `esbuild` `<=0.24.2` (via `vite`, `drizzle-kit`, `@esbuild-kit/*`) | Moderate | Dev server accepts cross-origin requests (GHSA-67mh-4wv8-2f99) | **Dev-only.** Affects the local dev server, not the production build/runtime. | Defer to the Vite/drizzle-kit bump. |
| `uuid` `<11.1.1` (nested under `exceljs`) | Moderate | Missing buffer bounds check in v3/v5/v6 when `buf` is provided (GHSA-w5hq-g745-h8pq) | **Not exploitable** — the app uses `uuidv4()` and never passes a `buf`; this is exceljs's own nested `uuid`. The "fix" would **downgrade** `exceljs` 4.x → 3.4.0. | Do not apply (harmful downgrade). |

## Why `npm audit fix` was not run

- `npm audit fix` (non-breaking) resolves nothing here — the fixes it lists actually
  require semver-major bumps.
- `npm audit fix --force` would bump `drizzle-orm` (0.39→0.45), `drizzle-kit`, and
  **downgrade** `exceljs`, for zero real security gain in this app.
- Attempting `npm install drizzle-orm@0.45.2` fails with `ERESOLVE`: 0.45's optional
  peers (`@op-engineering/op-sqlite`, `expo-sqlite`) drag in a conflicting
  `react-native`/`react` peer graph. It is a coordinated migration, not a drop-in.

## Planned follow-up (dedicated branch, with the test suite as the net)

1. Bump `drizzle-orm` → ≥0.45.2 together with `drizzle-zod` and `drizzle-kit`, resolve
   the peer graph, regenerate/verify migrations, run the full suite.
2. Bump `vitest` + `@vitest/ui` and `vite` together to clear the dev-only advisories.
