# Decision records

The choices that shaped WebFlowMaster, each with the problem it answered, what was decided, and what
it costs. They are the reasons behind the code; read them before changing one of these areas.

## 1. Tenant isolation is enforced by PostgreSQL row-level security

**Context.** Organizations share tables. Filtering by `organization_id` in every query is a rule
that one forgotten handler breaks.

**Decision.** Every organization table has RLS enabled and forced, with a policy on
`app.current_org`. Every tenant query runs in a transaction that switches to the non-bypassing role
`app_user` and sets the organization (`withTenantTransaction`). The server refuses to start if these
preconditions do not hold.

**Consequences.** A missing filter cannot leak data; it returns nothing. Every new table needs its
policy and grants in its migration, which an isolation test checks. Queries must run inside a tenant
context, including background work.

## 2. The privileged handle is budgeted, not banned

**Context.** Some work cannot run inside one organization: registration, login, token lookups,
installation-wide tables, erasure.

**Decision.** Those use `privilegedDb`, and an architecture test lists every file allowed to and how
many statements, each with a written reason.

**Consequences.** Bypassing RLS is always a visible, reviewed decision.

## 3. A run's state moves only through conditional updates

**Context.** Duplicate job deliveries ran plans twice; late writes reopened finished runs.

**Decision.** `server/execution-state.ts` owns every transition, each an `UPDATE … WHERE status IN
(allowed predecessors)`; terminal states have no successors.

**Consequences.** Races have exactly one winner, decided by the database. Code must treat a `null`
transition as "someone else already moved it".

## 4. A run is decided when it is requested

**Context.** A plan edited while its run waited ran with settings nobody chose for that run.

**Decision.** The orchestrator writes a versioned snapshot of every setting the runner reads, with
suites expanded to tests. A test enforces that every plan column is either captured or declared
irrelevant.

**Consequences.** Reports describe exactly what ran. Adding a plan setting the runner reads means
adding it to the snapshot.

## 5. One job per run, idempotent at both ends

**Decision.** Callers may send an idempotency key (unique per organization); the orchestrator submits
exactly one BullMQ job whose id is the run id; the worker takes a run only from `queued`.

**Consequences.** Retried HTTP calls, twin schedulers and duplicate deliveries all produce one run.

## 6. Dead workers are detected by heartbeat, and their runs are not silently re-run

**Decision.** Workers beat every 15 s while running; a sweep ends silent runs as `error`
(`worker_lost`), and runs past their maximum duration as `timed_out`.

**Consequences.** Nothing hangs for ever. A lost run is reported, not repeated, because half a run may
already have created data in the application under test; a scheduled run with attempts left retries.

## 7. The web process does not run browsers

**Context.** Previews and page surveys in the web process slowed every page for everyone.

**Decision.** Plan runs and browser tasks go to workers, on separate queues so a preview never waits
behind a nightly run. Recording is the exception, because its window must open on a machine with a
display.

**Consequences.** Workers scale independently; a single-machine setup can opt into
`BROWSER_TASKS=inline`.

## 8. Hand-written SQL migrations

**Decision.** Migrations are SQL files written by hand, with a journal, applied by `db:migrate` (and
by the `migrate` service before the application starts). `db:push` is not used.

**Consequences.** RLS policies, roles, grants, checks and data fixes live beside the tables they
concern, and every database reaches the same state.

## 9. High-entropy tokens are hashed; secrets we must use are encrypted

**Decision.** API keys, webhook tokens and agent tokens are random 32-byte values stored as SHA-256
and shown once. Credentials the product must present to other systems (environment secrets, tracker
and source-host tokens, login states) are encrypted with AES-256-GCM and never returned by the API.

**Consequences.** A lost key is replaced, never recovered. `ENCRYPTION_KEY` must be kept safe and
stable; losing it loses those secrets.

## 10. Side effects never decide a verdict

**Decision.** Notifications, issue filing, commit statuses and artifact uploads return outcomes and
log failures; they run after the verdict is recorded.

**Consequences.** A Jira outage costs an issue, not a run. The outcome is visible where it matters
(for example the last delivery error on a GitHub connection).

## 11. A small, stable public API

**Decision.** `/api/v1` is the only API promised to pipelines: explicit shapes, uniform errors,
scoped keys, and a hand-written OpenAPI document held to the router by a test. The rest of `/api`
serves the web client and may change with it.

**Consequences.** Pipelines do not break when a page changes; adding to `/api/v1` is deliberate.

## 12. The server hands out its own CLI and agent

**Decision.** `/cli/wfm.mjs` and `/cli/wfm-agent.mjs` are bundles built from the server's own
sources, instead of npm packages.

**Consequences.** A pipeline or an agent always uses the version that matches the server it talks to.

## 13. Local agents lend browsers; they do not run tests

**Context.** Applications behind a customer's firewall cannot be reached from the runners.

**Decision.** An agent starts browsers with Playwright's `launchServer` and lends them over outbound
connections through a relay; the runner connects to them as to its own. API requests of such runs go
through the borrowed browser's request API.

**Consequences.** One runner, one feature set everywhere; the agent is small and needs no inbound
port. Agent and server must share Playwright's major.minor.

## 14. Several web servers share a relay directory instead of sticky routing

**Decision.** Relay instances publish their agents to Redis; a request that lands on the wrong
instance is forwarded, and session ids name the instance that holds them.

**Consequences.** Any load balancer works; instances must reach each other at
`AGENT_RELAY_ADVERTISE_URL`.

## 15. Evidence behind an artifact store, results kept for ever

**Decision.** Screenshots, videos, traces, HAR files and baselines go through one interface with a
local and an S3 implementation. Retention removes files after `ARTIFACT_RETENTION_DAYS` but keeps
results, steps and verdicts; baselines are never removed.

**Consequences.** Several workers on several machines work; history and analytics survive retention.

## 16. Quarantine changes what a failure means, not whether the test runs

**Decision.** A quarantined test still runs and its result is recorded, but its failure does not fail
the run, stop it, file an issue or turn a pipeline red.

**Consequences.** Unreliable tests stop teaching people to ignore red builds, while the evidence that
they are fixed keeps accumulating.

## 17. The AI chooses, it does not invent

**Decision.** Describing a test in sentences may only produce actions from the closed list the runner
implements and elements that exist (repository or page); every line is shown before insertion.
Healing proposes a selector that must succeed on retry before it is saved. Both are optional and off
without an AI key.

**Consequences.** A misread sentence is visible before it becomes a test; the product works fully
without a model.

## 18. Expansion happens at the right moment

**Decision.** Suites are expanded into tests when a run is created (so the run is fixed); step groups
and repository elements are resolved when a test runs (so a fix reaches every test).

**Consequences.** Editing a suite does not change runs already queued; editing a group or an element
changes the next run of every test that uses it.

## 19. History cannot be rewritten

**Decision.** `test_versions`, `test_publications` and `audit_log` have no `DELETE` (or `UPDATE`)
grant for `app_user`. Restoring a test writes a new version.

**Consequences.** "What changed, and who changed it?" always has an answer.

## 20. Commit statuses follow the state machine

**Decision.** The state machine announces every recorded move to listeners registered by the web and
worker processes; the commit status module sets pending, then the verdict, one status after the
other per run.

**Consequences.** Every path that moves a run (cancel, timeout, recovery) is reported without being
wired individually; tests move runs without sending anything unless they register.
