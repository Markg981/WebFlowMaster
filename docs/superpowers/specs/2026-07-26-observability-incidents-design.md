# Observability & Incidents — Design

**Date:** 2026-07-26
**Status:** Approved, ready for implementation planning

## Goal

Give the system a memory of its own failures, in two forms:

1. **Logs** — continuous and human-readable, covering server *and* frontend in one
   correlated stream, so a person can read what happened.
2. **Incidents** — structured JSON artifacts containing the stack resolved to a source
   line, the inputs that caused the failure, and the events leading up to it, so an agent
   can reproduce and fix the bug without being told what it was.

The two cross-reference each other: every incident emits a log line carrying its incident
id, and every incident records the correlation id needed to find its log lines.

## Decisions taken

| Question | Decision |
|---|---|
| How the agent is triggered | On demand, reading local files. No watcher, no daemon. |
| What "reproduce automatically" means | Each incident yields a runnable failing test. |
| Which layers produce incidents | All four: server API, client runtime, runner infrastructure, background jobs. |
| Where incidents live | `.observability/` on disk, gitignored, redacted, rotated. |
| Which environment | Development only. Production and source-map resolution are out of scope. |
| Frontend log volume | Continuous, level configurable, batched. |

## What already exists

The codebase has a usable spine, and this design attaches to it rather than replacing it:

- Correlation IDs propagated through the whole async chain via `AsyncLocalStorage`
  (`server/middleware/correlation.ts`), reaching DB queries, BullMQ jobs and Playwright.
- Structured JSON logs with `errors({ stack: true })`, secret redaction, daily rotation,
  and an optional Loki transport (`server/logger.ts`, `server/utils/log-redactor.ts`).
- A central Express error handler (`server/index.ts`).
- An `execution_logs` table with an indexed `correlationId`, and a live WebSocket console.
  These serve the product's own test runs and are **not** replaced by this work.

## Gaps this design closes

1. The frontend reports nothing anywhere: no error boundary, no global handlers, no logs.
2. `apiRequest` neither sends nor stores a correlation id, so a UI action cannot be tied
   to the server work it triggered.
3. Logs are lines, not incidents — reconstructing a failure means grepping rotating files.
4. Request bodies, arguments and environment are never captured with an error, so nothing
   is reproducible.
5. `logs/` is gitignored and unindexed: there is no "recent errors" list to start from.
6. Many `catch` blocks keep only `error.message`, discarding the stack and the arguments.

---

## Architecture

### Identifiers

Two, with distinct lifetimes:

- **`sessionId`** — one per browser tab, stable for the whole session. Reconstructs a
  user's journey across actions.
- **`correlationId`** — one per user action / API call, generated **by the client** and
  sent as `X-Correlation-Id`.

`correlationMiddleware` already adopts an inbound `X-Correlation-Id` when present, so no
server change is needed: a one-line change in `apiRequest` makes a UI action and all its
server work share one id.

### Modules

```
server/observability/
  incident.ts       recordIncident() — build, fingerprint, dedupe, write
  breadcrumbs.ts    bounded per-correlation ring buffer
  stack.ts          stack parsing, app-vs-vendor frames, source snippet
  store.ts          filesystem writer, index, rotation
  fingerprint.ts    stable hash of kind + normalised message + app frames
  repro.ts          generates the .repro.ts files
  taps/express.ts   error handler + async route wrapper
  taps/jobs.ts      BullMQ wrapper
  taps/runner.ts    Playwright infrastructure failures

server/routes/observability.routes.ts
  POST /api/client-logs   batched log ingest from the browser
  POST /api/incidents     client-originated incidents

client/src/observability/
  logger.ts          levels, buffer, batched flush
  breadcrumbs.ts     ring buffer of user actions
  error-boundary.tsx React error boundary
  install.ts         window.onerror, unhandledrejection, apiRequest and route hooks
```

There is no read endpoint for incidents: the agent reads the files directly, and nothing
else consumes them. One is easy to add later if a UI ever needs it.

The two `breadcrumbs.ts` are separate rings by design — the browser one records user
actions and travels with a client incident; the server one records log events per
correlation id and is attached to server incidents.

### Data flow

Normal operation:

```
user action → client logger → console + buffer
                                ↓ every 3s / 25 entries / pagehide
                          POST /api/client-logs
                                ↓ zod validation + redaction
                          winston (source: 'client')
                                ↓
                    logs/app-YYYY-MM-DD.log   ← client and server interleaved
```

Failure:

```
error → tap → recordIncident()
                ├─ breadcrumbs for that correlationId
                ├─ stack resolved to file:line + source snippet
                ├─ fingerprint → dedupe
                ├─ .observability/incidents/<id>.json
                ├─ .observability/index.json  (updated)
                └─ logger.error("... incidentId=inc_xxxx")
```

### Changes to existing code

Deliberately small and localised:

- `client/src/lib/queryClient.ts` — send `X-Correlation-Id` and `X-Session-Id`.
- `client/src/App.tsx` — wrap the router in the error boundary; install global handlers.
- `server/index.ts` — the existing error handler also calls `recordIncident`.
- BullMQ job registration — wrap handlers with the job tap.

Everything else is new and confined to the two `observability/` packages.

---

## Frontend logging pipeline

### Levels and configuration

Winston's levels: `error`, `warn`, `info`, `http`, `debug`. Default `info` in development.

The level comes from a **new** `clientLogLevel` system setting, defaulting to the value of
the existing `logLevel`. A separate key is deliberate: raising server verbosity to `debug`
while chasing a backend problem should not simultaneously flood the ingest endpoint with
browser traffic. A per-tab override lives in `localStorage` under `wfm:logLevel`, so one
session can be made verbose without touching the database.

### Automatic instrumentation

| Event | Level | Payload |
|---|---|---|
| Route change (wouter) | `info` | from → to, time spent on previous route |
| Every API call | `http` | method, url, status, duration, correlationId |
| Failed react-query query/mutation | `error` | key, message, HTTP status |
| `unhandledrejection` | `error` | reason + stack |
| `window.onerror` | `error` | message, file:line:column, stack |
| React error boundary catch | `error` | error + `componentStack` |

Explicit calls remain available for feature code:
`clientLogger.info('recording started', { sessionId })`.

### Logs versus breadcrumbs

Two distinct mechanisms, deliberately:

- **Logs** are continuous, textual, and land in the file a person reads.
- **Breadcrumbs** are a ring of the last 50 events (clicks with a resolvable selector,
  field focus — never field values, route changes), held in memory only and attached to an
  **incident** when one occurs.

Logs narrate the session; breadcrumbs reconstruct the seconds before a failure without
scrolling through them.

### Buffering and transport

In-memory buffer, maximum 200 entries, oldest dropped first, with the drop count reported
so loss is never silent.

Flush triggers: 3 seconds elapsed, 25 entries queued, **immediately** when an `error` is
queued, or on page dismissal.

Page dismissal uses `navigator.sendBeacon`, because a normal `fetch` during `pagehide` is
cancelled by the browser — precisely when the interesting error is lost.

### Two hazards the design must avoid

**The infinite loop.** If a log flush fails and that failure is logged, another flush is
queued that also fails. Rule: logger errors never pass through the logger. They go to
`console.warn` once; the batch is retried at most three times, then dropped.

**Breaking the product.** Every public function in the layer is wrapped in `try/catch`, and
if the module fails to initialise the app runs normally without logging. An observability
bug must never take down what it observes.

### Server ingest

`POST /api/client-logs` accepts `{ sessionId, entries[] }`, zod-validated, maximum 100
entries per batch, with a per-session rate limit (`express-rate-limit` is already a
dependency). Each entry is re-emitted through winston at its own level with
`source: 'client'`, preserving the browser timestamp as `clientTs` so clock skew is
visible. Redaction is the existing winston redactor, unchanged.

**Declared trade-off:** the endpoint requires authentication, but accepts anonymous
requests outside production. This is needed to capture errors on the login page, otherwise
the only blind screen in the app. In production it stays closed, because an open
disk-writing endpoint is a disk-exhaustion and log-injection vector.

### What the result looks like

```
14:32:01.115 http  [c-9f3a]: [client] POST /api/start-recording {"status":200,"durationMs":812,"sessionId":"s-7c2"}
14:32:01.120 debug [c-9f3a]: PS:startRecordingSession - Effective settings {"browserType":"chromium"}
14:32:03.402 error [c-9f3a]: [client] mutation failed {"key":"startRecording","message":"Failed during browser launch"}
14:32:03.403 error [c-9f3a]: Unhandled request error incidentId=inc_7f21a9 {"status":500}
```

`grep c-9f3a` returns the whole chain, from click to failure, across both sides.

---

## The incident artifact

One file per distinct failure, at `.observability/incidents/<id>.json`, where `id` is
`inc_` followed by the first six hex characters of the fingerprint. Same bug, same
fingerprint, same filename — so a recurrence updates the existing file rather than adding
another.

```jsonc
{
  "id": "inc_7f21a9",
  "kind": "server-api",              // server-api | client-runtime | job | runner
  "status": "open",                  // open | fixed | ignored
  "count": 12, "firstSeen": "...", "lastSeen": "...",

  "title": "TypeError: Cannot read properties of undefined (reading 'selector')",

  "origin": {                        // first frame belonging to this project
    "file": "server/playwright-service.ts",
    "line": 742, "column": 31,
    "function": "PlaywrightService.executeAdhocSequence",
    "source": [
      "740 |   for (const step of payload.sequence) {",
      "741 |     const actionId = step.action?.id;",
      "742 >     await page.click(step.targetElement.selector);",
      "743 |     stepResults.push({ ... });"
    ]
  },

  "error": { "name": "TypeError", "message": "...", "frames": [ /* app vs vendor */ ] },

  "trigger": { /* shape depends on kind — see below */ },

  "state": {
    "gitCommit": "a1221b5", "gitBranch": "feature/...", "workingTreeDirty": true,
    "nodeVersion": "v20.16.0", "platform": "win32", "nodeEnv": "development"
  },

  "breadcrumbs": [ /* last 50 events before the failure */ ],
  "occurrences": [ { "ts": "...", "correlationId": "c-9f3a", "sessionId": "s-7c2" } ],

  "repro": {
    "path": "server/__repro__/inc_7f21a9.repro.ts",
    "command": "npx vitest run --include '**/*.repro.ts'",
    "confidence": "high"
  }
}
```

`origin.source` is the field that does the work: the real source lines with the failing one
marked, so nothing has to be looked up. `state.gitCommit` records which code produced the
stack — without it, "line 742" means nothing.

### Trigger shapes per kind

| Kind | Trigger contents |
|---|---|
| `server-api` | method, path, query, body (redacted), header allowlist, userId, correlationId |
| `client-runtime` | route, componentStack, serialisable props snapshot when available, last API call |
| `job` | queue, job name, jobData, attemptsMade |
| `runner` | phase, test name, url, browser type, sessionId |

### Stack resolution

A small parser splits frames into *project* and *library*, takes the first project frame as
`origin`, and reads ±5 lines from disk. In development `tsx` and Vite serve real sources,
so paths are genuine TypeScript locations.

If the referenced file does not exist on disk, `origin` is marked `unresolved` with a
reason. An incident that admits it does not know beats one showing the wrong lines because
the commit moved underneath it.

### Deduplication

The fingerprint hashes `kind` + normalised message (UUIDs, numbers and paths stripped) +
the leading project frames. Fifty occurrences of one bug become **one file** with
`count: 50` and the last ten occurrences retained. Without this, ten minutes of a broken
poll buries the directory in identical files.

`.observability/index.json` holds the compact list — id, title, kind, count, status,
repro path — so a single read gives the whole picture.

### Reproduction generation

Generated tests use the **`.repro.ts`** extension, which neither vitest configuration
matches: the server config includes `server/**/*.test.ts`, and the client config uses the
default `**/*.{test,spec}.*` pattern. This buys three things: the main suites stay green
with failing reproductions pending; they run with `--include '**/*.repro.ts'`; and
promoting a reproduction to a permanent regression test is a rename from `.repro.ts` to
`.test.ts`, which is the step taken after each fix.

Reproductions are written next to the suite that will eventually own them:
`server/__repro__/` for `server-api`, `job` and `runner` incidents, and
`client/src/__repro__/` for `client-runtime` ones — so the rename lands the test in a
directory the right vitest project already covers.

Confidence varies by kind and is declared in the artifact rather than assumed:

| Kind | Confidence | What is generated |
|---|---|---|
| `server-api` | **high** | supertest test registering the routes, authenticating the captured user, replaying the request, asserting the response is not 5xx. Follows the existing pattern in `server/test-plan-executions.test.ts` |
| `job` | **high** | Calls the job handler directly with the captured `jobData` |
| `runner` | **medium** | Calls the service method with captured arguments; may need a real browser, and is marked as such |
| `client-runtime` | **best-effort** | With serialisable props from the error boundary, a render test using them; otherwise a skeleton with breadcrumbs as comments and `it.todo` |

### Retention

At most 200 incidents or 30 days, whichever comes first; `fixed` incidents are pruned
first. `.observability/` is gitignored, because triggers contain request bodies.

---

## Testing this system

The circularity — testing the thing that reports errors — is addressed explicitly:

- **`fingerprint`** is pure: same error yields the same hash; messages differing only in
  UUIDs or numbers collapse to one; genuinely different errors do not collide.
- **The stack parser** is tested against real captured stack strings from both
  environments (tsx server-side, Vite client-side), including a file that no longer exists.
- **The store** writes, dedupes and rotates against a temporary directory.
- **The taps** run against an Express app with a route that throws on purpose: the request
  must produce a file with the correct trigger.
- **The client logger** is tested for flush triggers, immediate flush on error, and above
  all **non-recursion**: with a transport that always fails, the retry count stays finite.
- **A secrets test** provokes an error carrying a known password in the body and asserts
  that string never appears in the written incident file.

Then the end-to-end proof, itself a test: a deliberately broken route → incident →
generated reproduction → run → red → fix applied → green.

## Failure modes and mitigations

| Risk | Mitigation |
|---|---|
| Observability throws and breaks the product | Every tap wrapped; a `recordIncident` failure goes to `console.error` once and is swallowed |
| Recursive incident (the recorder errors) | Guard flag: the recorder never records itself |
| Hot loop throwing thousands of times | Per-fingerprint rate limit: at most one occurrence recorded per second, the rest counted |
| Disk full or permission denied | Degrades to log-only, without retry loops |
| Hostile payload on the client endpoint | zod validation, size caps, per-session rate limit |
| Breadcrumb ring buffer growing without bound | Maximum 500 correlation ids, LRU eviction, 5-minute TTL |

The last row matters: it is the same class of bug just fixed in the recording sessions map
(an unbounded, non-expiring in-memory `Map`). A second one is not being introduced.

## Build order

The pure core first, because it is testable without infrastructure, and the frontend early
because it is the largest present gap:

1. `fingerprint` + stack parser + store + index
2. Server taps and the Express error handler
3. **Client logger + ingest endpoint** — frontend logs become available here
4. Error boundary, global handlers, breadcrumbs
5. Job and runner taps
6. Reproduction generator
7. End-to-end test of the full loop

## Out of scope

- **Production and source-map resolution.** Development only, as decided.
- **Distributed tracing, spans, performance analysis.** That is OpenTelemetry and a
  separate decision.
- **Session replay or DOM snapshots.** Large effort and a privacy problem; breadcrumbs are
  the chosen substitute.
- **Replacing `execution_logs` or the WebSocket console.** Those narrate the product's own
  test runs — different audience, different purpose.

## A note on "automatic"

With on-demand triggering, "fix it automatically without me telling you anything" means:
**the bug no longer has to be described.** What was clicked, which payload was sent, which
line threw — all of it is in the artifact. Saying "look at the errors" is enough; the agent
reads the index, reproduces, fixes, and presents a diff.

What it does not do, with this choice, is act while nobody is present. That is the watcher
option, deliberately declined. It can be added on top of this design later without redoing
it, because the artifacts are already its interface.
