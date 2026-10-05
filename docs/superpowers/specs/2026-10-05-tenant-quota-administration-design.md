# Tenant quotas and administration

Status: approved by the user on 2026-10-05; implementation under final verification.

## Requested outcome

Give installation administrators measurable, enforceable organization quotas for retained
artifact storage, the number of saved tests, and execution resource consumption, alongside
the existing running/queued execution limits. Teams can see their consumption and why an
operation is refused. This feature works independently of billing.

The user confirmed monthly execution time as the resource measure for this version.
CPU/RAM requires a separate runner telemetry contract and must not be inferred from elapsed
execution time.

## Verified starting point

- `server/tenant-quotas.ts` resolves installation environment defaults and organization overrides
  for concurrent and queued runs, with a transaction-scoped organization advisory lock.
- `server/execution-orchestrator.ts`, `server/execution-state.ts`, and `server/run-promotion.ts`
  already enforce execution admission and fair queueing.
- `GET /api/organization/usage` exposes current running/queued counts and effective limits.
- `server/installation-admin.ts` distinguishes installation administrators from tenant owners.
  Named administrators are configured through `INSTALLATION_ADMINS`; the single-organization
  owner fallback is already established. Organization rows are read-only for the application role.
- `server/artifact-store.ts` supports local and S3 stores but has no persistent tenant byte ledger.
  `server/artifact-retention.ts` removes expired execution evidence; visual baselines are retained.
- UI and BDD definitions share `tests`; API and mobile definitions use `api_tests` and
  `mobile_tests`. Creation also happens through imports, requirements, and shared storage methods.
- The previous BDD branch is merged in `origin/main` through PR #294 (base `148ce8a`).

## Approaches considered

1. **Recommended: extend tenant quotas with persistent metering and the existing admin model.**
   One policy source, reliable counters, and enforcement at the actual write/admission boundaries.
   Requires schema changes and artifact lifecycle integration.
2. **Dashboard and periodic scans only.** Smaller change, but writes can exceed limits between
   scans and failed/repeated uploads can distort usage. Does not meet the requested limit behavior.
3. **External resource/billing platform.** Adds service dependencies and provider integration
   without improving the requested installation administration. Outside this feature's scope.

## Quota semantics

| Dimension | Measured usage | Admission rule |
| --- | --- | --- |
| Concurrent runs | Running and cancelling plan executions | Existing behavior: excess stays queued |
| Queued runs | Waiting plan executions | Existing behavior: refuse excess with HTTP 429 |
| Tests | Saved UI/BDD + API + mobile definitions | Refuse creation/import above the limit |
| Artifact storage | Persisted execution evidence and visual baselines, in bytes | Reserve capacity before publishing or replacing an object |
| Execution resources | Cumulative runner occupancy time in the UTC calendar month | Refuse new execution admission when the monthly allowance is exhausted |

New quota defaults are unlimited to preserve existing installations. Organization overrides
inherit environment defaults when null; zero explicitly means unlimited for the new dimensions.
Existing execution quota fields retain their current strictly positive semantics.
The API and UI return both overrides and effective limits, so inheritance is visible.

User amendment approved before implementation: all quota policy remains configurable and local
use never requires payment. Installation default `TENANT_QUOTA_MODE` and per-organization mode
support `off` (no enforcement or execution metering), `monitor` (measure without refusal), and
`enforce` (measure/enforce). Default `enforce` preserves existing run limits; new caps remain
unlimited. Test counting and artifact bookkeeping remain available in `off`. Actual subscriptions,
payment provider and collection are a separate future integration, never implied by enabling quotas.

Tests count once per saved definition, including archived definitions that still occupy storage.
Versions, steps, scenarios within a BDD definition, publication records, results, and plan references
do not count as additional tests. Editing an existing test remains available at the limit; cloning
creates a new definition and needs capacity. Deletion releases capacity.

Lowering a limit below existing usage preserves data and running work. Usage is displayed as
over-limit and operations that increase that dimension are refused until consumption falls or
an administrator raises the limit. No automatic deletion or termination follows a limit change.

## Persistence and enforcement

Extend organization quota columns and the quota resolver with the three selected dimensions.
Use database constraints to reject malformed quota values and explicit safe integer validation
at the API boundary. Byte and duration values use a representation that cannot silently overflow
PostgreSQL integer columns or JavaScript's safe integer range.

Enforce test capacity transactionally across every production insertion path. Prefer shared
database enforcement for the three test tables, so imports and future creation paths cannot
bypass the quota. Lock the organization before counting and inserting; batch imports are atomic
and provide a clear quota error without a partly imported batch. Verify the trigger and grant
design against the application's restricted database role and production RLS.

Introduce a tenant-scoped artifact inventory keyed by organization and canonical artifact key,
tracking committed bytes and in-progress reservations. Replacing an object reserves only the
additional bytes. Persistence uses a recoverable reservation/publish/commit sequence rather
than holding a database transaction open during network uploads. Repeated publication is
idempotent; a failed upload releases capacity only when it is confirmed not to have persisted.
Ambiguous storage failures retain a reservation until reconciliation checks the object.

Local and S3 stores use the same accounting rules. Generated files use temporary staging before
becoming retained artifacts; staging disk is a separate operational limit and is not presented
as tenant retained storage. A failed reservation produces an explicit artifact quota outcome
in the report. Previously retained evidence is preserved. New evidence that cannot be retained
is marked unavailable because of quota, rather than serving a broken URL or silently claiming
the artifact was saved. Test verdict and evidence-retention outcome remain separate.

Deletion and retention release bytes only after successful physical removal. S3 batch deletion
must inspect per-object errors even when the request itself succeeds. Organization erasure,
baseline replacement/removal, retry publication, and failed partial upload use the same ledger.
Administrative reconciliation inventories legacy objects and repairs stale reservations; its
state and last successful reconciliation time are visible. Do not display legacy unmeasured
storage as zero. Enabling a storage cap requires completed initial reconciliation for that tenant.

## Execution time

Count occupancy from the successful transition to running until a terminal transition. Include
failed, cancelled, timed-out, and recovered executions that occupied a runner; exclude queued
time. Metering is committed with lifecycle changes, not an asynchronous notification listener.
The execution identifier and lifecycle boundary prevent duplicate charging after redelivery.

Store durable monthly usage independent of report/history retention. Split occupancy across
UTC month boundaries, include active executions when calculating current consumption, and
use heartbeats/recovery to stop stale workers from consuming indefinitely. Repeated finalization
and recovery must not double count. A retry with a new execution identifier consumes new time.

Admission checks apply when enqueueing and again when taking a queued run, covering work
accepted before the allowance was exhausted. Queue promotion skips exhausted tenants and
continues serving others; runs already queued remain visible with the monthly quota reason
and become eligible after the next UTC month or an administrative quota increase.

This is an admission budget, not a promise of exact runtime cutoff: already running executions
may finish beyond the allowance. Show the overage explicitly and document that distinction.
Before claiming resource coverage, inventory standalone UI/API/mobile execution routes and
either meter and guard them with the same policy or explicitly limit the exposed metric to
plan executions. An unguarded execution route must not silently bypass a purported tenant-wide budget.

## Administration and team experience

Extend the existing usage card with values, units, effective limits, over-limit states, UTC period,
and reconciliation status. Read access remains scoped to the signed-in organization.

Add an installation quota administration section with paginated organization search, current
usage, inherited/default limits, and editable per-organization overrides for all dimensions.
Only authenticated human installation administrators can enumerate other tenants or change
their limits. Tenant owners cannot raise their own quotas. Sensitive organization data is not
included in this overview. Clearing an override returns it to the environment default.

Administrative writes use a narrowly scoped privileged operation, validate the target organization,
and atomically record the actor, target, old limits, and new limits in the audit log. Preserve
ordinary tenant RLS and existing organization column grants. Use optimistic concurrency so
one administrator cannot silently overwrite another's change.

Quota errors use stable codes, dimension, current usage, limit, and period when relevant.
Use HTTP 429 for admission refusals, HTTP 400 for invalid input, and HTTP 403 for missing admin
authorization. UI labels, messages, and administrator documentation are supplied in EN and IT.

## Verification and delivery

- Database integration: defaults/overrides, all definition types, deletion, batch import rollback,
  simultaneous creation, restricted application grants, and cross-organization isolation.
- Artifact integration: local/S3 parity, overwrite deltas, concurrent reservations, duplicate
  publication, partial upload/deletion failure, retention, baseline lifecycle, initial legacy
  reconciliation, and restart recovery.
- Execution integration: all terminal statuses, duplicate delivery/finalization,
  active usage, stale workers, UTC rollover, queued work, retries, and standalone admission paths.
- API and UI regressions: tenant owner denial, installation administrator access, malformed
  limits, inheritance, stale admin updates, audit evidence, quota errors, and unavailable artifacts.
- Run type checks, relevant server/client suites, production and documentation builds, and the
  appropriate PostgreSQL RLS tests when an actual PostgreSQL test environment is available.
  PGlite integration results do not prove PostgreSQL RLS behavior.
- Add repeatable acceptance cases covering quota administration and refused operations. Live
  execution evidence, migration application, and automated results are reported separately.

Prepared branch: `codex/tenant-quota-administration`, from updated `origin/main`.
Preserve the pre-existing untracked local files. No product code or live database has been changed.

## Design approval and implementation handoff

The user approved the written design and monthly execution time on 2026-10-05 ("Conferma").
Prepare and review the concrete implementation plan, then implement and verify the agreed scope.
Billing, subscriptions, and payment-provider integration remain outside the design.
