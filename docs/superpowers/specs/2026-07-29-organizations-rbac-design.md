# Organizations & RBAC — Design

**Date:** 2026-07-29
**Status:** Approved, ready for implementation planning

## Goal

Give WebFlowMaster a tenancy boundary and a permission model, enforced by the database rather
than by developer discipline. This is the prerequisite for every other enterprise pillar:
scoped API keys, audit trails, per-tenant queue isolation, and team dashboards all need an
organization to hang from.

## The evidence that shaped this design

Investigation of the current code found that ownership is enforced ad hoc and inconsistently.
17 of 20 tables carry `userId`, but some queries filter on it and some do not:

- `server/routes/tests.routes.ts:18` — `GET /api/tests` runs
  `db.select().from(tests).orderBy(desc(tests.createdAt))` with no `userId` filter. **Today,
  any authenticated user sees every other user's UI tests.**
- `server/routes/tests.routes.ts:50` — `POST /api/tests/:id/run` loads a test by id with no
  ownership check and executes it.

This is a data-isolation bug now, in single-tenant operation. It becomes a cross-tenant leak
the moment organizations exist. The lesson drives the central decision below: the risk is not
adding an `organizations` table, it is guaranteeing that ~58 endpoints across 20 tables all
respect the boundary. Adding tenancy on top of inconsistent enforcement multiplies the hole
instead of closing it.

## Decisions taken

| Question | Decision |
|---|---|
| Membership model | One user belongs to exactly one organization. No bridge table. |
| Roles | Three: `owner`, `editor`, `viewer`. Stored on `users`. |
| Enforcement | Postgres Row-Level Security. The database filters, not the query author. |
| Binding | `SET LOCAL ROLE` per request; connection string unchanged. |
| Existing data | One organization per existing user; that user becomes its owner. |

---

## Verified constraint: RLS is silently inert under a superuser

This was tested empirically against PGlite before the design was settled, because the whole
approach rests on it.

A table with `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a correct policy
filtered **nothing**:

```
current_user: 'postgres', usesuper: true
policy exists: org_isolation
rls flags: relrowsecurity=true, relforcerowsecurity=true
as org 1: [ 'org1-secret', 'org2-secret' ]      ← both rows
as org 2: [ 'org1-secret', 'org2-secret' ]      ← both rows
UPDATE targeting org 2 while org 1: 1 row affected
```

Superusers bypass RLS unconditionally. `FORCE ROW LEVEL SECURITY` does not change this — it
subjects the table *owner* to policies, not superusers. PGlite connects as `postgres`, a
superuser, and many development Postgres setups do the same.

With a non-superuser role, the same policy binds correctly:

```
after SET ROLE, current_user: 'app_user'
rows visible as app_user: [ 'org1-secret' ]     ← filtered
```

**RLS works, including in PGlite, but only if the application is not running as a superuser.**
The failure mode is silent: no error, no warning, every row visible to everyone. This is why
the design includes a test that asserts the bypass still happens under a superuser — so the
day that changes, something breaks loudly.

---

## Schema

### New and modified tables

```
organizations
  id, name, createdAt

users  (modified)
  + organizationId  → organizations.id, NOT NULL
  + role            → 'owner' | 'editor' | 'viewer', NOT NULL, default 'editor'
```

No bridge table: with single membership, `role` belongs on `users`.

`userId` is **kept** on every table that has it. `organizationId` is the security boundary;
`userId` remains attribution — who created this test. Dropping it would lose information.

### Table classification

All 20 tables, explicitly, so nothing is left ambiguous:

**Org-scoped** — gain `organizationId NOT NULL` and an RLS policy (16 tables):
`projects`, `tests`, `test_runs`, `detected_elements`, `api_tests`, `api_test_history`,
`test_plans`, `test_plan_schedules`, `test_plan_executions`, `test_plan_selected_tests`,
`test_plan_webhooks`, `report_test_case_results`, `execution_logs`, `environments`,
`secrets`, `excel_sequences_map`.

**User-scoped, not org-scoped** — `user_settings` (theme, language, preferred browser). These
are personal preferences; the boundary is already the user, and an owner should not be able to
change a colleague's theme. Stays filtered by `userId`, no org policy.

**Global** — `system_settings` (`logLevel`, `clientLogLevel`, `logRetentionDays`). Instance
configuration, not customer data. No `organizationId`. Becomes writable by `owner` only, which
is not true today.

**Infrastructure** — `sessions`, the express-session store, keyed by session id. Not org-scoped.

**Modified** — `users` (above).

### Why `organizationId` is denormalized onto every table

The alternative is deriving it through a join (`tests` → `projects` → `organizationId`). More
normalized, but RLS policies become subqueries evaluated per row on every table, and every
wrong join is a hole. With a direct column the policy is
`organization_id = current_setting('app.current_org', true)::int`: readable, indexable, hard to
get wrong. The cost is maintaining consistency on write, which is a much smaller problem than
auditing subquery policies.

### Known limitation: secret encryption is not per-organization

`secrets` is encrypted with AES-256-GCM (`server/crypto.ts`) using a **single instance-wide
key** from `ENCRYPTION_KEY`. `organizationId` plus RLS stops one organization reading another's
secrets *through the application*. It does not stop anyone with database access and the
environment variable from decrypting all of them.

This is not changed here — per-organization keys are a separate project, and where those keys
live is its central question. It is recorded because "secrets are isolated per organization"
would be a false statement to make to an enterprise customer.

---

## The RLS mechanism

### What it must achieve

Not "filter by organization" — that is trivial. **Make forgetting impossible.** The current
code proves that remembering does not work.

### How it binds

Every request that touches the database runs inside a transaction that begins:

```sql
SET LOCAL ROLE app_user;
SET LOCAL app.current_org = '<orgId>';
```

Three parts, each necessary for a different reason:

**`SET ROLE app_user`** — verified above: as `postgres`, policies exist, flags are on, and
nothing filters. Without this line the entire mechanism is decorative and silent.

**`LOCAL`** — `server/db.ts:22` uses `new Pool()`. With a pool, `SET` without `LOCAL` outlives
the request: the connection returns to the pool carrying the organization, and the next
request — belonging to a different customer — inherits it. That would be a cross-tenant leak
*created by* the anti-leak mechanism. `LOCAL` ties the state to the transaction, which ends on
its own.

**The transaction** — gives `LOCAL` a boundary. Without one there is nothing to scope to.

### Where it attaches

`server/middleware/correlation.ts` already has this exact shape: a middleware opening an
`AsyncLocalStorage` context that wraps the request's whole async chain. Tenancy follows the
same pattern and the same attachment point — a middleware reading `req.user.organizationId`
into an `AsyncLocalStorage`, plus a `withTenantTransaction(fn)` helper that opens the
transaction and sets both variables.

Reusing the existing pattern means no second context-propagation model: anyone who understands
the correlation ID already understands this.

### The gap RLS does not close, and how it is closed

`SET LOCAL ROLE` applies only inside the transaction. A query written outside it — importing
`db` directly and calling `db.select().from(tests)`, exactly as the code does today — still
runs as superuser and sees everything.

So RLS alone is insufficient. Two things together:

1. **RLS** as the strong guarantee for everything on the correct path.
2. **A test proving no incorrect path exists** — not "we remember to use the transaction", but
   a test that fails if a route module imports `db` and queries outside the tenant context.

Practically: `db.ts` stops exposing raw `db` to routes. It exports a `db` reserved for
migrations and bootstrap; routes obtain their handle only from inside `withTenantTransaction`.
An architecture test greps route code for direct `db` imports and fails on a hit. Crude, but it
is the only thing that holds over time.

### PGlite in tests

PGlite is single-connection, so the pooling risk is absent there. But `SET LOCAL ROLE` behaves
identically — verified. Tests therefore exercise the **real mechanism**, not a simulation. This
is why "RLS in production only, application filtering in tests" was rejected: those tests would
pass even with the policies broken.

---

## Roles and API surface

The current surface is 58 endpoints: 24 reads, 34 mutations.

### Permissions

| | viewer | editor | owner |
|---|---|---|---|
| Read tests, plans, reports, logs | yes | yes | yes |
| Create/modify/delete tests and plans | no | yes | yes |
| Execute tests, start recordings | no | yes | yes |
| Manage environments and secrets | no | yes | yes |
| Invite members, change roles, remove | no | no | yes |
| Modify `system_settings` | no | no | yes |

The rule that makes this implementable without 58 separate decisions: **RLS decides which
rows, the role decides which verbs.** They do not interact. A viewer and an owner in the same
organization see exactly the same rows; they differ only in what they may do with them.

### How it is applied

A `requireRole('editor')` middleware mounted per route group, not per endpoint. Defaults are
restrictive: mutating routes require `editor`, administrative routes require `owner`, reads
require only authentication (RLS has already restricted the rows).

The hazard is that no route declares anything today, so forgetting the middleware leaves an
endpoint open to everyone — the same class of error as `GET /api/tests`. Countermeasure: a test
that enumerates registered routes and fails if a mutating route has no `requireRole` in its
chain. Same principle as the architecture test above: verify the *shape* of the code, not only
its behaviour.

### `POST /api/tests/:id/run` requires `editor`

Today it loads a test by id with no ownership check and executes it
(`server/routes/tests.routes.ts:50`). Under RLS that query no longer finds another
organization's test — it returns 404, which is correct. The remaining question is the verb.

Executing a test launches a browser, reaches external systems, consumes resources, writes
`execution_logs`, and may run preconditions that mutate the system under test. It is a
mutation. A viewer must not be able to trigger it.

### New endpoints

The minimum, all `owner`:

- `GET /api/organization` — the current organization and its members
- `POST /api/organization/members` — add an existing user
- `PATCH /api/organization/members/:userId` — change a role
- `DELETE /api/organization/members/:userId` — remove a member

Two non-negotiable rules, because these are the classic ways a role system destroys itself:

1. An owner cannot drop their own `owner` role if they are the last one.
2. An owner cannot remove themselves if they are the last one.

Both enforced **inside the transaction**, not as a read-then-write check — otherwise two owners
removing each other concurrently both succeed and the organization is left unmanageable, a
state unrecoverable without direct database access.

### Out of this feature's scope

Email invitations, self-service onboarding, creating new organizations from the app. An owner
adds an existing user to their organization; that is all. The rest is product flow, not
security foundation.

---

## Migration

The existing runner (`scripts/apply-migrations.ts`) uses `db` from `server/db.ts` — the
superuser. That is correct: migrations *must* bypass RLS, or they cannot populate the columns
the policies will later read. It makes the step order non-negotiable.

1. Create `organizations`, the `app_user` role, and the new columns — all **nullable** at first.
2. Create one organization per existing user; point `users.organizationId` at it; role `owner`.
3. Populate `organizationId` on every org-scoped table, derived from `userId`.
4. **Verify**: no row anywhere has `organizationId IS NULL`. If one remains, the migration
   fails here.
5. Only now `NOT NULL`, and only now `ENABLE` / `FORCE ROW LEVEL SECURITY` plus the policies.

Step 4 exists because the worst failure is not an error: it is an orphan row that survives
silently and then becomes **invisible to everyone** the moment RLS activates. The data is not
lost, but no query will ever find it and nothing will say so. Better to fail the migration
while it can still be investigated.

`GRANT` for `app_user` must be issued per table. A table added later without a grant produces
permission errors — loud, therefore acceptable — but this is documented as a required step.

---

## Testing

Four categories. The first justifies the entire choice of RLS.

**Real isolation.** Two organizations, data in both. As organization A,
`db.select().from(tests)` **with no WHERE clause at all** must return only A's tests. This
proves the mechanism holds regardless of what a route author writes. Repeated for SELECT,
UPDATE and DELETE — in the verification above a cross-org UPDATE succeeded under a superuser,
so it must be covered explicitly.

**The silent failure.** A test running as superuser that **asserts isolation does NOT hold**.
It looks absurd, but it pins the finding from this design: if the connection ever returns to
superuser, this test changes behaviour and someone notices. Without it the regression is mute.

**Shape of the code.** The test that fails if a route imports `db` directly, and the test that
fails if a mutating route has no `requireRole`. These verify that wrong paths do not exist,
not that right paths work.

**Roles.** For each role × verb combination: a viewer attempting a mutation gets 403; the last
owner attempting to demote themselves gets an error; two owners concurrently removing each
other do not both succeed.

## Failure modes

| Risk | Mitigation |
|---|---|
| App connects as superuser, RLS inert and silent | Test asserting the bypass; if it ever stops bypassing, the test breaks and we find out |
| Query outside the transaction runs as superuser | Architecture test on imports; raw `db` unreachable from routes |
| `SET` without `LOCAL` with a pool, org leaks into the next request | Only `SET LOCAL`, never `SET`; test running two different-org requests over one connection |
| Orphan row after migration, invisible forever | Verification at step 4; the migration fails |
| New table without a policy, not isolated | Test enumerating org-scoped tables **from the schema** and asserting each has RLS enabled |
| Last owner removes themselves, organization unmanageable | Constraint enforced inside the transaction |

The last row's test reads the schema rather than a hand-written list. A hand-written list gets
forgotten — the same class of error this whole design corrects.

## Build order

1. Schema, `app_user` role, migration including the step-4 verification
2. `withTenantTransaction` + tenancy middleware + isolation tests
3. RLS enabled table by table, with the schema-enumerating test
4. `requireRole` + role tests
5. Organization routes
6. Cleanup of existing queries + architecture tests

Steps 1-3 change no visible behaviour: with one organization per user, everything works as
before — except that `GET /api/tests` stops showing other users' tests, which is the bug being
fixed, not a regression.

## Out of scope

Per-organization encryption keys (recorded as a known limitation above), SSO/OIDC, public API
keys, email invitations, multiple organizations per user. Each is a separate project, and none
is blocked by this one — all of them presuppose it.
