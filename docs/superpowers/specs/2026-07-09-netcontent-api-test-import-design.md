# Design: Import DMO.NetContent API endpoints as WebFlowMaster API tests

**Date:** 2026-07-09
**Status:** Approved (design), pending implementation plan

## Goal

Auto-configure WebFlowMaster API tests from the DMO.NetContent ASP.NET controllers so
the user selects and runs them instead of authoring each by hand. WebFlowMaster is the
test tool; DMO.NetContent is the system under test.

The DMO.NetContent controllers use explicit attribute routing — every action carries a
`[HttpGet]`/`[HttpPost]` and a `[Route("api/.../Action")]` with the full path — so the
endpoint surface (~168 actions across 13 controllers) is statically and precisely
extractable. Action parameters are scalar (`int headerRowId, double tareValue,
string comment, bool isManual = false`), bound from the query string, not a `[FromBody]`
JSON model. There is therefore no complex request body to synthesize: inputs are named
scalar parameters with a C# type and optional default.

## Context / findings

- DMO.NetContent is **not a standalone web app**: no `Program.cs`/`Startup.cs`/
  `launchSettings.json`. It is a package/plugin that runs inside the DMO host
  (`DMOPackageConfig.xml`, `Deploy/`, `_NccNew/`). Controllers are
  `[ApiController] : ControllerBase`.
- No `[Authorize]` attributes on the controllers; authentication is handled by the DMO
  host and **cannot be determined from this repo**. The `ClientApp/` is an empty Angular
  shell (routing/bootstrap only), so it gives no auth signal either.
- Consequence: tests are generated **auth-agnostic**. The real auth mechanism is
  determined empirically at first run against the live host (200 nude? 401? login
  redirect?) and then set as an environment-level setting in the API tester.
- The WebFlowMaster `apiTests` table already fits this use case: it has `projectId`,
  `method`, `url`, `queryParams`, `requestHeaders`, `requestBody`, `assertions`,
  `authType`, `authParams`, plus organizational columns `module`, `featureArea`,
  `scenario`, `component`, `priority`, `severity`.

## Scope

- **In scope:** all 13 controllers / ~168 endpoints, extracted and inserted into the
  WebFlowMaster DB under a single "NetContent" project, grouped by controller domain
  (`module`).
- **Out of scope:** an in-app UI import feature; Roslyn/AST-based C# parsing; auto-filling
  complex JSON bodies (there are none here); auto-chaining dependent calls; determining
  auth automatically.

## Architecture

A Node/TypeScript importer in WebFlowMaster, split into three isolated, testable units.

```
DMO.NetContent/_NccNew/Controllers/*.cs
        │
        ▼
  [Parser]  scripts/netcontent/parse-controllers.ts   (pure: files → manifest)
        │
        ▼
  endpoints.manifest.json                             (inspectable artifact)
        │
        ▼
  [Mapper]  scripts/netcontent/map-to-apitests.ts     (pure: manifest+config → apiTests[])
        │
        ▼
  [Importer] scripts/import-netcontent-api.ts          (orchestrator + Drizzle DB writes)
        │
        ▼
  WebFlowMaster DB (apiTests, project "NetContent")
```

### Unit 1 — Parser (`scripts/netcontent/parse-controllers.ts`)

- **Input:** path to the controllers directory.
- **Behavior:** scans `*.cs`; for each action extracts:
  - `httpMethod` — from `[HttpGet]` / `[HttpPost]`
  - `route` — from `[Route("...")]`
  - `controller` — controller/domain name (from the file / class name)
  - `action` — method name
  - `params[]` — `{ name, type, required, default }` parsed from the method signature
    (a param with a C# default value is `required: false`, otherwise `required: true`)
- **Output:** normalized manifest object; the importer writes it to
  `scripts/netcontent/endpoints.manifest.json`.
- **No DB access.** This is the critical unit and is unit-tested in isolation.
- **Robustness:** actions the parser cannot interpret are **skipped, not fatal**, and
  collected into a `warnings[]` list reported at the end — no endpoint is lost silently.

### Unit 2 — Mapper (`scripts/netcontent/map-to-apitests.ts`)

- **Input:** manifest + config `{ baseUrlVar, projectId, userId }`.
- **Output:** array of `apiTests` insert records (no side effects). Field mapping below.

### Unit 3 — Importer (`scripts/import-netcontent-api.ts`)

- Orchestrates: parse → write manifest → map → **insert/update in the DB via Drizzle**.
- Finds or creates the "NetContent" project for the resolved user.
- Runs DB writes in a **transaction**.
- Prints a summary: created / updated / skipped / orphaned / parser-warnings.

## Data mapping (action → `apiTests` row)

| Column | Value |
|---|---|
| `method` | `GET` / `POST` from `[HttpX]` |
| `url` | `{{baseUrl}}` + route, e.g. `{{baseUrl}}/api/NetContentTareCheck/GetLastOpenTareCheck`. `baseUrl` is an API-tester environment variable (the local DMO host), so the port lives in one place. |
| `queryParams` | one entry per signature parameter: `{ key: name, value, enabled }`. Optional params (have a C# default) → pre-filled with the default, `enabled: false`. Required params (no default) → `value: ""`, `enabled: true` — the values the user fills in. |
| `requestBody` | empty; `bodyType: 'none'` (scalars are sent as query params for both GET and POST) |
| `assertions` | one default: **`status_code less_than 500`** — a smoke assertion ("endpoint reachable and handled, did not throw an unhandled exception"). Real assertions are refined later by the user. |
| `name` | the action name, e.g. `GetLastOpenTareCheck` |
| `module` | controller domain (`TareCheck`, `Scale`, `Filler`, `Checkweigher`, `Reports`, …) → the folder-style grouping |
| `featureArea` | the route prefix (`NetContentTareCheck`) |
| `priority` / `severity` | defaults (`Medium` / `Major`) |
| `authType` / `authParams` | `null` for now — auth is set at the environment level after the first run |
| `projectId` | the "NetContent" project (auto-created if missing) |
| `userId` | resolved via `WFM_IMPORT_USER_ID`, default = the primary (lowest-id / single) user in the local DB — i.e. the user's own account |

**Why `status_code < 500` as the default assertion:** many endpoints, run before their
required params are filled, will return 4xx — that is handled behaviour, not a crash. The
500 threshold distinguishes "endpoint alive and handled" from "unhandled exception". It is
an honest smoke default; real assertions come after the user fills the params.

## Idempotency / re-run behaviour

Re-running the importer after NetContent changes must not destroy the user's work.
Natural key of a test: `(projectId, method, url)`.

- **Exists already** → update **only structural fields** (`module`, `featureArea`, and
  **add** any new parameters to `queryParams`) while **preserving** user-owned data:
  `assertions`, already-filled param **values**, `authType`/`authParams`.
- **New endpoint** → insert.
- **Endpoint gone** from the controllers → **not deleted**; reported as an "orphan" so the
  user decides. Never auto-delete.

## Configuration

- `NETCONTENT_CONTROLLERS_DIR` — path to controllers (default:
  `C:\Users\marco.oliva\source\repos\DMO_3\DMO.NetContent\_NccNew\Controllers`)
- `WFM_IMPORT_USER_ID` — optional; default = primary user
- `--dry-run` — parse and write the manifest only; **no DB writes** (for inspection)
- `DATABASE_URL` — existing WebFlowMaster env
- npm script: `npm run import:netcontent`

## Error handling

- Parser: unparseable actions skipped and listed in `warnings[]`; the run continues.
- Importer: all DB writes inside one transaction — all-or-nothing.
- Missing controllers directory / no users in DB → clear error, non-zero exit, no partial
  writes.

## Testing (Vitest + PGlite, matching the existing suite)

- **Parser:** a fixture `.cs` controller (GET + POST, required and optional params) →
  asserted expected manifest. The critical unit.
- **Mapper:** manifest → expected `apiTests` records (url, queryParams, module, defaults,
  required-vs-optional handling).
- **Importer (against PGlite):** insert path creates the project + tests; **re-run path
  preserves** user-edited assertions and filled param values, adds new params, and reports
  orphans.

## Deliverables

- `scripts/netcontent/parse-controllers.ts` (+ test)
- `scripts/netcontent/map-to-apitests.ts` (+ test)
- `scripts/import-netcontent-api.ts` (+ importer test)
- `scripts/netcontent/endpoints.manifest.json` (generated artifact; git-ignored)
- `package.json` script `import:netcontent`

## First-run outcome

~168 API tests created under the "NetContent" project, grouped by `module`, each with
method + URL + parameter placeholders + a smoke assertion — ready to fill required values,
set the environment `baseUrl` and auth, select, and run.
