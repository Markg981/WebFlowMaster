# Tenant Quotas and Administration Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for native execution or
> superpowers:subagent-driven-development if the user selects delegated execution.
> Implement each task with a failing regression, the production change, and verification.

**Goal:** Enforce and administer organization limits for saved tests, retained artifact bytes,
and monthly execution minutes, while preserving concurrent/queued execution quota behavior.

**Architecture:** Extend the existing tenant quota resolver and installation administrator model.
Database enforcement protects all test insertion paths; durable execution occupancy and artifact
inventory records provide usage independent of report retention. Storage publication uses
reservations and reconciliation because database commits cannot be atomic with local/S3 writes.

**Tech Stack:** TypeScript, Express, Drizzle, PostgreSQL/PGlite, BullMQ, React, TanStack Query,
Vitest, existing local/S3 artifact storage. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-tenant-quota-administration-design.md`

## Global constraints

- Monthly execution time is the approved resource measure; CPU/RAM is not represented by minutes.
- New quota defaults are unlimited to preserve existing installations.
- Organization overrides inherit environment defaults when null; zero explicitly means unlimited
  for the new dimensions. Existing execution quota fields remain strictly positive.
- Lowering a limit below existing usage preserves data and running work.
- Saved UI/BDD, API, and mobile definitions each count once, including archived definitions.
- Count occupancy from the successful transition to running until a terminal transition; exclude queued time.
- Split occupancy across UTC month boundaries; durable metering survives report retention.
- An admission budget permits already running executions to finish beyond the allowance.
- Only authenticated human installation administrators can change quotas or enumerate other tenants.
- Ordinary tenant owners cannot raise their own quotas or inspect other organizations' usage.
- Use HTTP 429 for quota admission refusals, 400 for invalid input, 403 for forbidden administration,
  and 409 for stale administrative revisions.
- Preserve existing untracked local files. Do not apply migrations to a live database as part of tests.
- Supply EN/IT strings, administration docs, and acceptance procedures; billing remains out of scope.
- Prepared branch: `codex/tenant-quota-administration`, base `148ce8a` (`origin/main`, PR #294).

## Review focus

- A member restricted to one project must still be subject to the organization's total usage.
  Add aggregate tests using definitions hidden by project RLS in Task 1.
- A timed-out S3 request may have persisted the object. Preserve its reservation until a successful
  inventory reconciles it; test ambiguous failures and restart recovery in Task 3.
- An execution spanning midnight on the first day belongs partly to both months. Test exact
  boundaries and finalized/recovered intervals in Task 2.
- A stored object that exists before the migration must not appear as zero usage. Test incomplete
  legacy scans and rejection of cap activation in Tasks 3 and 4.
- A concurrent admin update or import must not overwrite another update or partly consume the
  final slots. Test stale revisions in Task 4 and atomic multi-definition imports in Task 1.

## File responsibilities and shared contract

- `shared/tenant-quotas.ts` (new): shared quota, usage, override, period, and error contracts.
- `shared/schema.ts`: quota organization columns; artifact inventory and execution usage tables;
  audit action and tenant/schema inventory registration.
- `migrations/0081_tenant_quota_metering.sql` (new), `migrations/meta/_journal.json`:
  schema, grants, policies, restricted aggregate/test-capacity functions, initial usage backfill.
- `server/tenant-quotas.ts`: effective quota resolution and organization usage summary.
- `server/execution-usage.ts` (new): idempotent occupancy sessions, admission and finalization.
- `server/artifact-metering.ts` (new): byte reservations, commit, delete and reconciliation.
- `server/routes/tenant-quota-admin.routes.ts` (new): scoped privileged administration and audit.
- `server/artifact-store.ts`: local/S3 inventory operations and metered integration points.
- `client/src/components/settings/QuotaAdministrationCard.tsx` (new): admin organization quota editor.
- `client/src/components/settings/RunUsageCard.tsx`: tenant quota and consumption presentation.

Public interfaces used by subsequent tasks:

```typescript
export interface TenantQuotas {
  maxConcurrentRuns: number;
  maxQueuedRuns: number;
  maxTests: number;
  maxArtifactBytes: number;
  maxMonthlyExecutionMinutes: number;
}
export type QuotaOverrides = { [K in keyof TenantQuotas]: number | null };
export interface QuotaUsage {
  running: number; queued: number; tests: number;
  artifactBytes: number; reservedArtifactBytes: number;
  executionMs: number;
  periodStart: string; periodEnd: string;
  artifactsReconciledAt: string | null;
}
export interface OrganizationQuotaSummary {
  organizationId: number; name: string; revision: number;
  quotas: TenantQuotas; overrides: QuotaOverrides; usage: QuotaUsage;
}
```

New numeric limits must be safe nonnegative integers. Concurrent/queued values must also
be positive and fit PostgreSQL integer columns. Keep byte/duration storage as bigint and reject
unsafe numeric conversion before returning JSON. Resolution falls back to validated environment
defaults: `ORG_MAX_TESTS`, `ORG_MAX_ARTIFACT_BYTES`, `ORG_MAX_MONTHLY_EXECUTION_MINUTES`.
Database-enforced test admission must resolve the same authoritative defaults as application
admission; a private installation defaults row, synchronized by the privileged startup path,
provides defaults to database functions. API, worker and migrator deployments use identical
quota environment configuration. Application-role grants do not allow changing that row.

### Task 1: Quota persistence, aggregates and test capacity

**Files:** Shared contract/schema and migration above; `server/tenant-quotas.ts`,
`server/index.ts`, `server/worker.ts`, `server/routes/tests.routes.ts`,
`server/routes/mobile-tests.routes.ts`, `server/routes/requirements.routes.ts`, `server/storage.ts`;
new `server/tenant-quota-metering.test.ts` and `server/tests/tenant-quota-isolation.test.ts`.

**Produces:** `quotaUsage(tx, organizationId, now?)`, extended `quotasFor`, quota error mapping,
and complete database enforcement for saved test count.

- [x] Write integrations that seed an organization with `maxTests: 1`, insert one UI definition,
  and assert API/mobile insertion fails, another organization succeeds, and editing/deleting
  remains possible. Cover BDD using `tests.bdd` without counting scenarios separately.

```typescript
it('applies one limit across UI, API and mobile', async () => {
  const { organizationId, userId } = await seedQuotaOrganization({ maxTests: 1 });
  await insertDefinition('ui', organizationId, userId);
  await expect(insertDefinition('api', organizationId, userId))
    .rejects.toMatchObject({ code: 'P0001', message: 'test_quota_exceeded' });
  await expect(insertDefinition('mobile', organizationId, userId))
    .rejects.toMatchObject({ code: 'P0001', message: 'test_quota_exceeded' });
});
```

  Implement `seedQuotaOrganization` in this test file using `createTestOrganization`, an
  organization quota update, and a seeded person; implement `insertDefinition` with the existing
  required UI/API/mobile field patterns from route integration tests and a tenant transaction.
- [x] Run `npx vitest run server/tenant-quota-metering.test.ts`; confirm failure because the new
  quota columns/constraints and aggregate behavior are missing.
- [x] Add migration and schema definitions. Serialize test insert/delete capacity decisions under
  one organization lock. Use aggregate functions that can count definitions hidden by project
  RLS while validating the ambient organization and exposing only counts, not rows. Pin
  `search_path`, revoke default PUBLIC execution, and grant only required application functions.
- [x] Test two concurrent insertions at the final slot and a two-definition bulk insert/import
  above capacity: exactly one concurrent writer succeeds; the bulk operation leaves no new rows.
  Ensure relevant route catch blocks map the database quota error to structured HTTP 429.
- [x] Backfill execution usage from available historical plan executions without altering results;
  leave artifact reconciliation explicitly incomplete. Register new RLS tables and migration.
- [x] Verify null inheritance, zero unlimited, invalid/unsafe numbers, environment defaults,
  hidden-project totals and cross-tenant access. Run the new suites plus `server/tenant-quotas.test.ts`.

### Task 2: Durable monthly execution occupancy and admission

**Files:** New `server/execution-usage.ts`, `server/execution-usage.test.ts`;
`server/execution-state.ts`, `server/execution-orchestrator.ts`, `server/run-promotion.ts`,
`server/run-recovery.ts`, `server/browser-tasks.ts`, `server/api-test-runner.ts`,
`server/mobile-runner.ts`, `server/routes/tests.routes.ts`, `server/routes/mobile-tests.routes.ts`,
`server/routes.ts`; lifecycle and runner regression suites.

**Consumes:** Effective monthly minutes and tenant aggregate functions from Task 1.
**Produces:** Transactional `beginExecutionUsage(tx, organizationId, kind, executionId, now)`
and `finishExecutionUsage(tx, organizationId, kind, executionId, now)`, plus
`executionUsage(tx, organizationId, now)` and an admission check with `execution_quota_exceeded`.
`kind` distinguishes plan, standalone browser, API and mobile execution identifiers.

- [x] Write a failing interval regression using sessions spanning `2026-09-30T23:59:30Z` to
  `2026-10-01T00:00:30Z`; assert 30,000 ms in each month and no charge for queued work.

```typescript
expect(overlapMs(start, end, new Date('2026-10-01T00:00:00Z'),
  new Date('2026-11-01T00:00:00Z'))).toBe(30_000);
```

  `overlapMs` uses `max(0, min(end, periodEnd) - max(start, periodStart))`; persisted aggregate
  SQL must have identical interval semantics. Cover exact-boundary and zero-length intervals.
- [x] Run `npx vitest run server/execution-usage.test.ts`; confirm missing metering behavior.
- [x] Persist occupancy separately from deletable reports; unique `(organization_id, kind,
  execution_id)` makes repeated lifecycle writes idempotent. Create the plan session in the
  transaction that actually takes the run and close it in the successful terminal transition.
- [x] Include active sessions in monthly consumption; close stale sessions through existing
  heartbeat/recovery logic. A recovered session cannot reopen from a late worker callback.
- [x] Guard enqueue, take and promotion. Idempotent enqueue replay returns the previously
  accepted run without consuming another slot. Exhausted queued runs stay queued with an
  explicit reason and are reconsidered by existing deferred-job retries after rollover/increase.
- [x] Inventory standalone execution entry points, including `/api/proxy-api-request`, direct API
  execution, `/api/tests/:id/run`, browser task dispatch and `/api/mobile-tests/:id/runs`.
  Guard actual start, finalize in success/error/finally paths, and avoid charging child tests twice
  when already inside a metered plan. Mobile device occupancy follows its runner lifecycle.
- [x] Verify cancelled/failed/timed-out runs, duplicate delivery, recovery, month crossover,
  history deletion, a retry with a new identifier, other-tenant progress and running overage.
  Run execution usage, tenant quota, orchestrator, execution-state, promotion and recovery suites.

### Task 3: Artifact inventory, reservations and reconciliation

**Files:** New `server/artifact-metering.ts`, `server/artifact-metering.test.ts`;
`server/artifact-store.ts`, `server/artifact-store.test.ts`, `server/artifact-retention.ts`,
`server/artifact-retention.test.ts`, `server/visual-testing.ts`, `server/test-execution-service.ts`,
`server/organization-lifecycle.ts`, `server/routes/artifacts.routes.ts`, `server/report-model.ts`.

**Consumes:** Byte limits, artifact inventory schema and tenant organization lock.
**Produces:** Metered write/publication/deletion and
`reconcileOrganizationArtifacts(organizationId, store): Promise<void>`.
Extend `ArtifactStore` with paginated metadata inventory returning canonical key and byte size;
both stores must support inventory without loading file contents into memory.

- [x] Write failing integrations for 10 bytes committed under a 12-byte cap: replacing with
  11 bytes succeeds; a separate 2-byte object fails; another tenant has independent capacity.
- [x] Run `npx vitest run server/artifact-metering.test.ts server/artifact-store.test.ts`;
  confirm absence of quota enforcement/inventory.
- [x] Reserve the growth delta under the organization lock, prevent concurrent operations on
  the same key with a unique reservation token, release the database transaction before storage
  I/O, and commit only after publication succeeds. A failed/ambiguous write keeps conservative
  reserved capacity until inventory resolves the actual object size. No long S3 transaction.
- [x] Use staging for generated evidence; local public result directories must not expose files
  that bypass successful quota admission. Record artifact outcome separately from test verdict,
  update report availability and artifact route checks, and clean temporary staging safely.
  Baseline replacement preserves the previous baseline if capacity cannot be reserved.
- [x] Meter all retained execution evidence and visual baselines. Retention, baseline removal and
  organization erasure release inventory only for physically removed objects. Inspect S3
  `DeleteObjects` per-object errors and leave failed objects accounted for.
- [x] Reconciliation resolves canonical keys to their real organization through execution or
  baseline ownership, scans legacy data and resolves stale reservations. Serialize reconciliation
  with writes/deletes per organization without holding a transaction over the scan; use a lease
  or generation fence so a concurrent mutation cannot be overwritten by a stale scan.
- [x] Verify local/S3 parity, partial publish/delete, duplicate retries, restart recovery, concurrent
  reservations, unknown legacy usage and correct retention release. A failed scan never marks
  usage complete. Run metering, store, retention, visual testing and organization lifecycle suites.

### Task 4: Installation administration, tenant usage and audit

**Files:** New `server/routes/tenant-quota-admin.routes.ts` and `.test.ts`;
`server/routes/organization.routes.ts`, `server/routes.ts`, `server/installation-admin.ts`,
`shared/schema.ts`, `server/tests/tenant-quota-isolation.test.ts`.

**Consumes:** Quota resolver/usage, metering reconciliation and existing installation admin guard.
**Produces:** `GET /api/admin/organization-quotas?search=&limit=&offset=`,
`PATCH /api/admin/organization-quotas/:id` with `{ revision, overrides }`,
`POST /api/admin/organization-quotas/:id/reconcile-artifacts`, and additive tenant usage fields.

- [x] Add route regressions: tenant owner gets 403 for foreign/global admin routes; named human
  installation administrator gets the permitted overview; service account never administers quotas.
  Respect existing single-organization owner fallback. Use explicit authentication before the
  installation guard rather than trusting client `installationAdmin` metadata.
- [x] Run `npx vitest run server/routes/tenant-quota-admin.routes.test.ts`; confirm routes missing.
- [x] Paginate and validate search/IDs; return only organization ID/name, quotas, revision and usage.
  Use the target tenant context for metering and a narrowly scoped privileged transaction for
  organization override writes and target-organization audit entries.
- [x] Apply optimistic revision and audit atomically. Add `organization.quotas_updated` and
  `organization.artifacts_reconciled` audit actions. Test conflicts and ensure audit cannot record
  a quota change that rolled back. Reconciliation status/errors expose no object credentials.
- [x] Reject enabling a finite storage limit until initial inventory is complete; permit lowering
  a cap below measured usage without deleting data. Return both inherited and effective values.
- [x] Extend `/api/organization/usage` additively, preserve existing fields, include UTC period and
  queued quota reason. Compute organization totals independently of member project visibility.
- [x] Run administration, organization routes, installation admin, audit and isolation suites;
  run new isolation cases under real PostgreSQL with `WFM_TEST_REQUIRE_POSTGRES=1` when configured.

### Task 5: Usage and quota administration UI

**Files:** New `client/src/components/settings/QuotaAdministrationCard.tsx` and `.test.tsx`;
`client/src/components/settings/RunUsageCard.tsx` and `.test.tsx`,
`client/src/pages/settings-page.tsx` and `.test.tsx`,
`client/src/locales/en/translation.json`, `client/src/locales/it/translation.json`.

**Consumes:** Shared contract and endpoints from Task 4.
**Produces:** Tenant-visible consumption and administrator-only quota editor in Settings.

- [x] Write component tests showing tests/bytes/monthly minutes, an unlimited limit, over-limit
  usage and incomplete artifact measurement. Do not render unmeasured usage as zero.

```typescript
expect(await screen.findByText('Not measured yet')).toBeInTheDocument();
expect(screen.queryByText('0 / 0')).not.toBeInTheDocument();
```

- [x] Run `npm run test:client -- --run src/components/settings/RunUsageCard.test.tsx
  src/components/settings/QuotaAdministrationCard.test.tsx`; confirm missing UI behavior.
- [x] Keep existing Settings cards/layout. Add labelled numeric fields for the five overrides,
  explicit inherit controls, effective defaults, UTC month boundaries and revision handling.
  Format storage units and fractional consumed minutes for display without losing precision
  in payloads. Disable duplicate submits; handle 400/403/409/429 and offer refresh on stale edits.
- [x] Installation administration visibility requires `user.installationAdmin === true`, avoiding
  the existing broad fallback used by unrelated settings. Preserve server authorization as the
  source of truth; test owner denied, administrator allowed, save/clear/inherit and reconciliation.
- [x] Add EN/IT quota labels, errors, overage/admission-budget explanation and loading states.
  Run both component suites, settings-page tests and locale tests.

### Task 6: Documentation, acceptance and complete verification

**Files:** `docs/en/admin/administration.md`, `docs/it/admin/administration.md`,
`docs/administration-acceptance.md`, `.env.example`; schema inventory/docs generators when
the existing repository checks require regenerated output. Update this plan's progress ledger.

- [x] Document all five quotas, environment variables, override/null/zero semantics, permissions,
  UTC resource period, already-running overage, legacy inventory, staging and recovery procedures.
- [x] Add repeatable acceptance cases: mixed test count/import rejection, artifact replacement
  and retention, exhaustion on plan and direct execution, monthly rollover, cross-tenant denial,
  admin inheritance/change, stale revision, lowering a cap, audit and failed reconciliation.
- [x] Run `npm run check`, scoped ESLint, `npm run build`, `npm run docs:build`, `git diff --check`.
  Run relevant complete server/client suites; rerun load-related failures in isolation before
  attributing them to product behavior. Capture actual commands/results, not inferred success.
- [x] Obtain an independent final code review through the selected execution workflow; fix
  correctness/security findings with reproducing regressions and rerun affected checks.
- [x] Report automated results, actual PostgreSQL RLS validation, live acceptance and database
  deployment separately. Prepare a reviewable branch/PR according to the user's delivery scope;
  do not claim a PR exists if GitHub creation/authentication did not succeed.

## Plan self-review

- All approved dimensions, permission boundaries, local/S3 lifecycle and standalone execution
  paths map to Tasks 1–5; docs and acceptance map to Task 6.
- Review focus tests are assigned to the owning task. Shared numeric/usage contracts are defined
  once and consumed by subsequent tasks. No billing, CPU/RAM integration or dependencies added.
- Implementation approved inline, including configurable free local use; final verification underway.

## Progress ledger

- 2026-10-05: Written design and monthly execution time approved by the user ("Conferma").
- 2026-10-05: Plan prepared and checked against approved scope; awaiting plan review/execution method.
- 2026-10-05: User approved inline execution with configurable local free use. Added modes off/monitor/enforce, per-tenant overrides, no payment requirement.
- Tasks 1–5 implemented and tested RED→GREEN. Targeted server regression: 12 files / 127 tests passed; client: 6 files / 45 tests passed. PostgreSQL RLS validation: 4 files / 18 tests passed.
- Ruling: session advisory lock fences artifact writes/deletes/scans rather than an expiring lease — prevents uploads outliving a lease; no SQL transaction spans storage I/O — cost if wrong: long storage operations can hold a dedicated lock connection.
- Ruling: mobile screenshot storage counts stored base64 bytes and additional shard workers contribute occupancy — covers persistence/execution paths outside object storage and parent worker — cost if wrong: resource minutes reflect worker occupancy, not CPU utilization.
- Ruling: use one reviewable feature commit after final verification rather than per-task commits — tasks share migration/contract and remain reviewable together — cost if wrong: less granular history.
- Additional regression fixes: active execution staging excluded from inventory; admission failure clears initialized debug session. Both reproducing tests failed first, then 13/13 passed.
- Independent whole-feature review completed. Four Important findings fixed: orphan artifact accounting/erasure, queued debug admission cleanup, visible monthly deferral reason/period, per-evidence availability. Each reproduction failed first; affected suites passed 87/87. No deferred minor findings.
- Final review scope rulings: payment collection and CPU/RAM stay outside this approved version; staging disk remains operational capacity; live S3/UI/deployment remain distinct from automated verification. These match the approved scope and are not claims of live acceptance.
- Final PostgreSQL verification of migration/RLS and fixes: 5 files / 33 tests passed on a new disposable PostgreSQL 16 database. Container removed afterward; no application database migrated.
- Client complete suite: 89 files / 510 tests passed. BDD runtime child-process suite: 21/21 passed. TypeScript check and application/documentation builds passed; scoped lint has no errors and one pre-existing unused import warning.
- Audit revision regression failed first; revision now included with old/new values.
- Tasks 1–6 complete. Final complete server suite: 241 files / 2251 passed, 4 deliberately skipped; client: 89 files / 510 passed; BDD runtime: 21 passed; PostgreSQL: 33 passed. `npm run check`, `npm run build`, `npm run docs:build`, scoped ESLint and `git diff --check` verified. No live application migration or authenticated UI/S3 acceptance claimed.
