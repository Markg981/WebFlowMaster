# REST API

`/api/v1` is the API for pipelines and scripts: list plans, start runs, wait for them, and collect
their results. It is versioned and kept stable; the rest of the server's endpoints serve the web
client and may change without notice.

The machine-readable description is served by every installation at
**`/api/v1/openapi.json`** (OpenAPI 3.1), and a test keeps it identical to what the server
answers. Generate a client from it, or import it into Postman or Insomnia.

For most pipelines the [`wfm` CLI](./cli) is simpler than calling the API directly.

## Authentication

Send an API key, created in **Settings → API keys**, in either header:

```http
Authorization: Bearer wfm_…
X-API-Key: wfm_…
```

A key acts for the account that owns it, and never beyond that account's role. Create keys for
pipelines on a **service account**, so they keep working when people leave. A key can have an
expiry date, and is revoked from the same page.

### Scopes

A key **without scopes** can do anything its account can, on every endpoint. A key **with scopes**
works only on `/api/v1`, and on each endpoint only if it holds the scope the endpoint names:

| Scope | Minimum role | Allows |
|---|---|---|
| `plans:read` | viewer | Listing test plans. |
| `runs:read` | viewer | Reading runs, their status, JUnit and exported reports. |
| `runs:write` | editor | Starting runs and cancelling them. |

A pipeline needs `runs:write` and `runs:read`; add `plans:read` if it looks plans up by name.

## Conventions

- **Errors** are always `{ "error": { "code": "…", "message": "…" } }`, with a stable `code` to
  branch on and a `message` for people.
- **Pagination**: list endpoints take `limit` (1 to 100, default 20) and `offset` (default 0), and
  answer `{ "items": [...], "limit": 20, "offset": 0 }`.
- **Rate limit**: each key may make `API_RATE_LIMIT` requests a minute (600 by default). Past it
  the answer is `429 rate_limited`, with `Retry-After` and the `RateLimit` headers.
- **Idempotency**: starting a run accepts an `Idempotency-Key` header (up to 255 characters). The
  same key returns the same run, so a retried request never starts a second one. Use the build id.

| Code | Status | Meaning |
|---|---|---|
| `unauthenticated` | 401 | No key, or a key that is unknown, revoked or expired. |
| `insufficient_scope` | 403 | The key lacks the scope this endpoint needs. |
| `insufficient_role` | 403 | The key's account has a role below what the scope needs. |
| `invalid_request` | 400 | A body, parameter or header that is not valid. |
| `invalid_format` | 400 | An export format other than `html`, `pdf`, `allure`. |
| `plan_not_found` | 404 | No such plan (or environment) in this organization. |
| `run_not_found` | 404 | No such run in this organization. |
| `not_found` | 404 | No such endpoint under `/api/v1`. |
| `run_already_ended` | 409 | Cancelling a run that has already finished. |
| `queue_quota_exceeded` | 429 | The organization's queue of waiting runs is full. |
| `rate_limited` | 429 | Too many requests from this key in the last minute. |
| `export_failed`, `internal_error` | 500 | Something went wrong on the server; the log has it. |

## Runs

A run has one of these statuses:

| Status | Finished | Meaning |
|---|---|---|
| `queued` | no | Waiting for a runner, or for the organization's limit. |
| `running` | no | Being run. |
| `cancelling` | no | Asked to stop; ends at its current step. |
| `completed` | yes | Every test passed (failures of tests in quarantine do not count). |
| `failed` | yes | At least one test failed. |
| `error` | yes | The run could not be carried out (its runner stopped, a setup failed). |
| `cancelled` | yes | Stopped by someone. |
| `timed_out` | yes | Took longer than allowed. |

Poll a run until its status is no longer `queued`, `running` or `cancelling`. Every few seconds is
plenty; the CLI polls every five.

The run object:

```json
{
  "id": "4f1c…",
  "planId": "12",
  "planName": "Checkout, nightly",
  "status": "failed",
  "trigger": "api",
  "attempt": 1,
  "maxAttempts": 1,
  "queuedAt": "2026-09-24T02:00:00.000Z",
  "startedAt": "2026-09-24T02:00:03.120Z",
  "completedAt": "2026-09-24T02:06:41.905Z",
  "durationMs": 398785,
  "tests": { "total": 42, "passed": 40, "failed": 2, "skipped": 0, "quarantinedFailures": 1 },
  "runner": "build-1:4211:ab12",
  "failure": null,
  "ci": { "provider": "github", "repository": "acme/shop", "commit": "9fceb02", "branch": "main" },
  "links": {
    "self": "/api/v1/runs/4f1c…",
    "junit": "/api/v1/runs/4f1c…/junit",
    "report": "https://webflowmaster.example.com/test-plans/12/executions/4f1c…/report"
  }
}
```

`trigger` is `manual`, `scheduled`, `webhook` or `api`. `failure` explains a run that ended in
`error`, `cancelled` or `timed_out`. `links.report` is null when the server does not know its own
address (`WEBFLOW_PUBLIC_URL`).

## Endpoints

### List plans

`GET /api/v1/plans` · scope `plans:read`

```bash
curl -s -H "Authorization: Bearer $WFM_API_KEY" "$WFM_URL/api/v1/plans?limit=50"
```

Answers a page of `{ "id", "name", "description", "createdAt" }`, by name.

### Start a run

`POST /api/v1/plans/{planId}/runs` · scope `runs:write`

```bash
curl -s -X POST "$WFM_URL/api/v1/plans/12/runs" \
  -H "Authorization: Bearer $WFM_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: build-$BUILD_ID" \
  -d '{ "environmentId": 3, "ci": { "provider": "github", "repository": "acme/shop", "commit": "9fceb02" } }'
```

The body is optional:

| Field | Meaning |
|---|---|
| `environmentId` | The environment whose secrets the run uses. |
| `updateBaselines` | Make this run's screenshots the new visual baselines. |
| `ci` | The build that asked for the run: `provider` (required: `github`, `gitlab`, `jenkins`, `azure`, `bitbucket`, `circleci` or `other`), `repository`, `commit` (7 to 64 hex characters), `branch`, `pullRequest`, `buildId`, `buildUrl` (http or https), `actor`. Shown in the report, notifications and exports. |

Answers `202` with the run, and its address in `Location`. Also `400`, `404` for an unknown plan
or environment, `429 queue_quota_exceeded`, and `503` when the run could not be handed to a
worker — retry with the same `Idempotency-Key`.

### List runs

`GET /api/v1/runs` · scope `runs:read`

Most recent first. Filter with `planId` and `status`; paginated.

### Get a run

`GET /api/v1/runs/{runId}` · scope `runs:read`

### Cancel a run

`POST /api/v1/runs/{runId}/cancel` · scope `runs:write`

A queued run is cancelled at once (`200`); a running one is asked to stop (`202`) and ends at its
next step. `409 run_already_ended` if it had finished.

### JUnit XML

`GET /api/v1/runs/{runId}/junit` · scope `runs:read`

The run as JUnit XML, for the CI system's test report: one test suite per browser, one test case
per test, with the failure message. A failure of a test in quarantine is reported as skipped, so
it does not turn the build red.

### Export

`GET /api/v1/runs/{runId}/export/{format}` · scope `runs:read`

`format` is `html` (one self-contained file), `pdf`, or `allure` (a zip of Allure results). A PDF
needs a browser on the server; without one the answer is `503` — the HTML has the same content.

## Plan webhooks

A plan can also be started with a **webhook**: a URL and a token created on the plan (**Test plans
→ Webhooks** on the plan's row), for systems that can make an HTTP call but cannot hold an API key.

```bash
curl -s -X POST "$WFM_URL/api/webhooks/execute" -H "X-Webhook-Token: $WFM_WEBHOOK_TOKEN"
```

The token is shown once, when it is created, and stored only as a hash. It may also be sent as
`Authorization: Bearer`. It starts that one plan and nothing else; an `Idempotency-Key` header
works as above. The answer is `202` with `{ "success": true, "testPlanRunId": "…", "status":
"queued" }`; `401` for a missing or revoked token. Webhooks are limited to
`WEBHOOK_RATE_LIMIT` calls a minute per address (120 by default).

Reading the run's result needs an API key: prefer the API, or the CLI, whenever the caller can
keep one.
