# Organizations & RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give WebFlowMaster a tenancy boundary enforced by Postgres Row-Level Security and a three-role permission model, so that data isolation stops depending on every query author remembering to write a `WHERE` clause — which has already failed twice in the current code.

**Architecture:** Every org-scoped table gains an `organizationId` column and an RLS policy reading `current_setting('app.current_org')`. Requests run inside a transaction that first issues `SET LOCAL ROLE app_user` and `set_config('app.current_org', ..., true)`; the database then filters every statement, with or without a `WHERE`. A separate `requireRole` middleware gates verbs. Architecture tests verify the wrong paths cannot exist, rather than only that the right paths work.

**Tech Stack:** TypeScript, Drizzle ORM (`drizzle-orm/node-postgres` in production, `drizzle-orm/pglite` in dev/test), Postgres 15 / PGlite, Express 4, Passport, vitest, supertest.

## Global Constraints

- **RLS is silently inert under a superuser.** Verified: with `ENABLE`, `FORCE`, and a correct policy, PGlite as `postgres` returned every row to every org and allowed a cross-org `UPDATE`. `FORCE ROW LEVEL SECURITY` subjects the table *owner* to policies, not superusers. Every tenant-scoped query must run under `SET LOCAL ROLE app_user`.
- **Never `SET` without `LOCAL`.** `server/db.ts:22` uses `new Pool()`. A non-local `SET` outlives the request; the connection returns to the pool carrying the organization and the next request — a different customer — inherits it.
- **Never build the org setting by string interpolation.** Use `set_config('app.current_org', <bound param>, true)`. Verified: a hostile value is rejected by the integer cast rather than executed. `sql.raw` with a template literal is an injection surface.
- `userId` is kept on every table that has it. `organizationId` is the security boundary; `userId` remains attribution.
- Migrations run as superuser deliberately — they must bypass RLS to populate the columns the policies later read.
- Never use `git commit --no-verify`.
- Commit after each task.
- Test commands, from the repo root: one file `npx vitest run <path>`; full server suite `npm test` (resets the test DB first); typecheck `npx tsc -b`; lint `npx eslint server/ shared/`.

---

## File Structure

**Created**
- `migrations/0003_organizations_and_rbac.sql` — hand-written migration: tables, columns, `app_user` role, grants, backfill, orphan check, `NOT NULL`, RLS policies. Hand-written rather than drizzle-kit generated because the backfill and the orphan check must sit between the column creation and the `NOT NULL`, which a generator will not produce.
- `server/middleware/tenancy.ts` — `AsyncLocalStorage` tenant context + `withTenantTransaction`.
- `server/middleware/require-role.ts` — the `requireRole` verb gate.
- `server/routes/organization.routes.ts` — the four member-management endpoints.
- `server/middleware/tenancy.test.ts`, `server/middleware/require-role.test.ts`, `server/routes/organization.routes.test.ts`, `server/tests/isolation.test.ts`, `server/tests/architecture.test.ts`.

**Modified**
- `shared/schema.ts` — `organizations` table, `users.organizationId`/`users.role`, `organizationId` on 16 tables.
- `server/db.ts` — export the raw handle under a name that signals its privilege.
- `server/auth.ts` — the session user carries `organizationId` and `role`.
- `server/routes.ts` — mount the tenancy middleware and the organization router.
- `server/routes/tests.routes.ts` — the two unfiltered queries.

---

### Task 1: Schema and migration

**Files:**
- Modify: `shared/schema.ts`
- Create: `migrations/0003_organizations_and_rbac.sql`
- Test: `server/tests/schema-migration.test.ts`

**Interfaces:**
- Produces: `organizations` table (`id`, `name`, `createdAt`); `users.organizationId: number`, `users.role: 'owner' | 'editor' | 'viewer'`; `organizationId: number` on the 16 org-scoped tables; the Postgres role `app_user`; exported const `ORG_SCOPED_TABLES: readonly string[]` from `shared/schema.ts`, listing the 16 table names, used by later tasks' tests to enumerate what must be isolated.

- [ ] **Step 1: Add the schema definitions**

In `shared/schema.ts`, add the `organizations` table immediately above the existing `users` table:

```ts
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

Modify the existing `users` table to add the two columns (keep every existing column exactly as it is):

```ts
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  // The tenancy boundary. One user belongs to exactly one organization.
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  // Verbs, not rows: RLS decides which rows are visible, this decides what may be done to them.
  role: text("role").notNull().default('editor'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

Add `organizationId` to each of these 16 tables, as a column alongside the existing ones. For every one of them add exactly this column definition and an index:

```ts
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
```

The 16 tables: `projects`, `tests`, `testRuns`, `detectedElements`, `apiTests`, `apiTestHistory`, `testPlans`, `testPlanSchedules`, `testPlanExecutions`, `testPlanSelectedTests`, `testPlanWebhooks`, `reportTestCaseResults`, `executionLogs`, `environments`, `secrets`, `excelSequencesMap`.

For each, add an index in that table's index array, following the existing naming convention (e.g. for `tests`, whose array already contains `index("tests_user_id_idx").on(table.userId)`):

```ts
  index("tests_organization_id_idx").on(table.organizationId),
```

Do **not** add `organizationId` to `userSettings`, `systemSettings`, or `sessions`.

At the end of the file, export the list later tasks will enumerate:

```ts
/**
 * Tables whose rows belong to exactly one organization and are therefore protected by an
 * RLS policy. Exported so tests can enumerate them from the schema rather than from a
 * hand-maintained list, which would be forgotten the first time a table is added.
 */
export const ORG_SCOPED_TABLES = [
  'projects', 'tests', 'test_runs', 'detected_elements', 'api_tests', 'api_test_history',
  'test_plans', 'test_plan_schedules', 'test_plan_executions', 'test_plan_selected_tests',
  'test_plan_webhooks', 'report_test_case_results', 'execution_logs', 'environments',
  'secrets', 'excel_sequences_map',
] as const;
```

- [ ] **Step 2: Write the migration**

Create `migrations/0003_organizations_and_rbac.sql`. The step order is not negotiable — the backfill and the orphan check must run while the columns are still nullable and before RLS is enabled:

```sql
-- 1. Structure, all nullable for now.
CREATE TABLE "organizations" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "users" ADD COLUMN "organization_id" integer;
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'editor' NOT NULL;

ALTER TABLE "projects" ADD COLUMN "organization_id" integer;
ALTER TABLE "tests" ADD COLUMN "organization_id" integer;
ALTER TABLE "test_runs" ADD COLUMN "organization_id" integer;
ALTER TABLE "detected_elements" ADD COLUMN "organization_id" integer;
ALTER TABLE "api_tests" ADD COLUMN "organization_id" integer;
ALTER TABLE "api_test_history" ADD COLUMN "organization_id" integer;
ALTER TABLE "test_plans" ADD COLUMN "organization_id" integer;
ALTER TABLE "test_plan_schedules" ADD COLUMN "organization_id" integer;
ALTER TABLE "test_plan_executions" ADD COLUMN "organization_id" integer;
ALTER TABLE "test_plan_selected_tests" ADD COLUMN "organization_id" integer;
ALTER TABLE "test_plan_webhooks" ADD COLUMN "organization_id" integer;
ALTER TABLE "report_test_case_results" ADD COLUMN "organization_id" integer;
ALTER TABLE "execution_logs" ADD COLUMN "organization_id" integer;
ALTER TABLE "environments" ADD COLUMN "organization_id" integer;
ALTER TABLE "secrets" ADD COLUMN "organization_id" integer;
ALTER TABLE "excel_sequences_map" ADD COLUMN "organization_id" integer;

-- 2. One organization per existing user; that user becomes its owner.
INSERT INTO "organizations" ("name")
SELECT username || '''s organization' FROM "users" ORDER BY id;

UPDATE "users" u
SET "organization_id" = o.id, "role" = 'owner'
FROM (
  SELECT u2.id AS user_id, o2.id AS id
  FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM "users") u2
  JOIN (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM "organizations") o2
    ON u2.rn = o2.rn
) o
WHERE u.id = o.user_id;

-- 3. Backfill every org-scoped table from its existing user ownership.
UPDATE "projects" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
UPDATE "tests" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
UPDATE "api_tests" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
UPDATE "api_test_history" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
UPDATE "test_plans" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
UPDATE "environments" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;
UPDATE "secrets" t SET "organization_id" = u."organization_id" FROM "users" u WHERE t."user_id" = u.id;

-- Tables without their own user_id inherit through their parent.
UPDATE "test_runs" t SET "organization_id" = p."organization_id" FROM "tests" p WHERE t."test_id" = p.id;
UPDATE "detected_elements" t SET "organization_id" = p."organization_id" FROM "tests" p WHERE t."test_id" = p.id;
UPDATE "test_plan_schedules" t SET "organization_id" = p."organization_id" FROM "test_plans" p WHERE t."test_plan_id" = p.id;
UPDATE "test_plan_executions" t SET "organization_id" = p."organization_id" FROM "test_plans" p WHERE t."test_plan_id" = p.id;
UPDATE "test_plan_selected_tests" t SET "organization_id" = p."organization_id" FROM "test_plans" p WHERE t."test_plan_id" = p.id;
UPDATE "test_plan_webhooks" t SET "organization_id" = p."organization_id" FROM "test_plans" p WHERE t."test_plan_id" = p.id;
UPDATE "execution_logs" t SET "organization_id" = e."organization_id" FROM "test_plan_executions" e WHERE t."test_plan_execution_id" = e.id;
UPDATE "report_test_case_results" t SET "organization_id" = e."organization_id" FROM "test_plan_executions" e WHERE t."test_plan_execution_id" = e.id;
UPDATE "excel_sequences_map" t SET "organization_id" = p."organization_id" FROM "tests" p WHERE t."test_id" = p.id;

-- 4. Refuse to continue if anything is unassigned. An orphan row would survive this
--    migration silently and then become invisible to everyone once RLS activates —
--    not lost, but unfindable, with nothing reporting it.
DO $$
DECLARE
  t text;
  orphans bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','projects','tests','test_runs','detected_elements','api_tests','api_test_history',
    'test_plans','test_plan_schedules','test_plan_executions','test_plan_selected_tests',
    'test_plan_webhooks','report_test_case_results','execution_logs','environments','secrets',
    'excel_sequences_map'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE organization_id IS NULL', t) INTO orphans;
    IF orphans > 0 THEN
      RAISE EXCEPTION 'Migration aborted: % row(s) in % have no organization_id', orphans, t;
    END IF;
  END LOOP;
END $$;

-- 5. Now, and only now, enforce.
ALTER TABLE "users" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "projects" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "tests" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "test_runs" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "detected_elements" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "api_tests" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "api_test_history" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "test_plans" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "test_plan_schedules" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "test_plan_executions" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "test_plan_selected_tests" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "test_plan_webhooks" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "report_test_case_results" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "execution_logs" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "environments" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "secrets" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "excel_sequences_map" ALTER COLUMN "organization_id" SET NOT NULL;

CREATE INDEX "users_organization_id_idx" ON "users" ("organization_id");
CREATE INDEX "projects_organization_id_idx" ON "projects" ("organization_id");
CREATE INDEX "tests_organization_id_idx" ON "tests" ("organization_id");
CREATE INDEX "test_runs_organization_id_idx" ON "test_runs" ("organization_id");
CREATE INDEX "detected_elements_organization_id_idx" ON "detected_elements" ("organization_id");
CREATE INDEX "api_tests_organization_id_idx" ON "api_tests" ("organization_id");
CREATE INDEX "api_test_history_organization_id_idx" ON "api_test_history" ("organization_id");
CREATE INDEX "test_plans_organization_id_idx" ON "test_plans" ("organization_id");
CREATE INDEX "test_plan_schedules_organization_id_idx" ON "test_plan_schedules" ("organization_id");
CREATE INDEX "test_plan_executions_organization_id_idx" ON "test_plan_executions" ("organization_id");
CREATE INDEX "test_plan_selected_tests_organization_id_idx" ON "test_plan_selected_tests" ("organization_id");
CREATE INDEX "test_plan_webhooks_organization_id_idx" ON "test_plan_webhooks" ("organization_id");
CREATE INDEX "report_test_case_results_organization_id_idx" ON "report_test_case_results" ("organization_id");
CREATE INDEX "execution_logs_organization_id_idx" ON "execution_logs" ("organization_id");
CREATE INDEX "environments_organization_id_idx" ON "environments" ("organization_id");
CREATE INDEX "secrets_organization_id_idx" ON "secrets" ("organization_id");
CREATE INDEX "excel_sequences_map_organization_id_idx" ON "excel_sequences_map" ("organization_id");

-- 6. The application role. NOLOGIN because the app reaches it via SET LOCAL ROLE, not by
--    connecting as it — the connection string is deliberately left unchanged.
CREATE ROLE app_user NOLOGIN;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
```

- [ ] **Step 3: Write the migration test**

Create `server/tests/schema-migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { ORG_SCOPED_TABLES } from '@shared/schema';

/**
 * The migration runs as part of the test bootstrap (server/tests/setup.ts), so these
 * assertions describe the database the whole suite runs against.
 */
describe('organizations migration', () => {
  it('creates an organization for every user and makes them its owner', async () => {
    const rows = await db.execute(
      sql`SELECT count(*) FILTER (WHERE organization_id IS NULL) AS orphans FROM users`,
    );
    expect(Number((rows.rows[0] as { orphans: string }).orphans)).toBe(0);
  });

  it('leaves no org-scoped row without an organization', async () => {
    for (const table of ORG_SCOPED_TABLES) {
      const rows = await db.execute(
        sql.raw(`SELECT count(*) AS orphans FROM "${table}" WHERE organization_id IS NULL`),
      );
      expect(
        Number((rows.rows[0] as { orphans: string }).orphans),
        `${table} has rows with no organization_id`,
      ).toBe(0);
    }
  });

  it('creates the app_user role', async () => {
    const rows = await db.execute(sql`SELECT rolname FROM pg_roles WHERE rolname = 'app_user'`);
    expect(rows.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- server/tests/schema-migration.test.ts`
Expected: FAIL — the migration has not been applied yet, so `organization_id` does not exist and the query errors.

- [ ] **Step 5: Apply the migration and run the test**

Run: `npm test -- server/tests/schema-migration.test.ts`
Expected: PASS, 3 tests. (`npm test` runs `test:setup-db` first, which recreates the test database and applies all migrations including the new one.)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all suites pass. Existing tests that insert rows will now fail if they omit `organizationId` on an org-scoped table — fix each by adding the column to the inserted values, using an organization created in that test's own setup. Do not relax the `NOT NULL`.

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc -b && npx eslint server/ shared/`
Expected: no output from either.

- [ ] **Step 8: Commit**

```bash
git add shared/schema.ts migrations/0003_organizations_and_rbac.sql server/tests/schema-migration.test.ts
git commit -m "feat(tenancy): organizations, roles, and the app_user database role

Adds the organizations table, organizationId on the 16 org-scoped tables, and
users.organizationId/role. Existing data is migrated one organization per user,
that user becoming its owner, so nobody loses access and nobody gains any.

The migration refuses to continue if any row is left without an organization.
An orphan would survive silently and then become invisible to everyone once RLS
activates in a later task — not lost, but unfindable, with nothing reporting it."
```

---

### Task 2: Tenant context and transaction helper

**Files:**
- Create: `server/middleware/tenancy.ts`
- Test: `server/middleware/tenancy.test.ts`
- Modify: `server/db.ts`

**Interfaces:**
- Consumes: `organizations`, `users` from Task 1.
- Produces: from `server/middleware/tenancy.ts` — `tenancyMiddleware(req, res, next)` (Express middleware, reads `req.user.organizationId` into an `AsyncLocalStorage`); `getTenantOrgId(): number | undefined`; `withTenantTransaction<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T>`; `type TenantTx` (the Drizzle transaction handle). From `server/db.ts` — the existing `db` export is renamed to `privilegedDb`, with `db` kept as a deprecated alias so nothing breaks until Task 6 cleans up.

- [ ] **Step 1: Write the failing test**

Create `server/middleware/tenancy.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { withTenantTransaction, runWithTenant, getTenantOrgId } from './tenancy';

let orgA: number;
let orgB: number;

beforeEach(async () => {
  const rows = await privilegedDb.execute(
    sql`INSERT INTO organizations (name) VALUES ('A'), ('B') RETURNING id`,
  );
  orgA = Number((rows.rows[0] as { id: number }).id);
  orgB = Number((rows.rows[1] as { id: number }).id);

  await privilegedDb.execute(sql`
    INSERT INTO projects (name, user_id, organization_id)
    VALUES ('a-project', 1, ${orgA}), ('b-project', 1, ${orgB})
  `);
});

afterEach(async () => {
  await privilegedDb.execute(sql`DELETE FROM projects WHERE organization_id IN (${orgA}, ${orgB})`);
  await privilegedDb.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`);
});

describe('withTenantTransaction', () => {
  it('sets the role and the org for the duration of the transaction', async () => {
    const seen = await runWithTenant(orgA, () =>
      withTenantTransaction(async (tx) => {
        const role = await tx.execute(sql`SELECT current_user`);
        const org = await tx.execute(sql`SELECT current_setting('app.current_org', true) AS org`);
        return {
          role: (role.rows[0] as { current_user: string }).current_user,
          org: (org.rows[0] as { org: string }).org,
        };
      }),
    );

    expect(seen.role).toBe('app_user');
    expect(seen.org).toBe(String(orgA));
  });

  /**
   * The setting must not outlive the transaction. server/db.ts uses a connection pool, so a
   * value that survives would be inherited by whichever request gets that connection next —
   * a cross-tenant leak created by the anti-leak mechanism itself.
   */
  it('does not leak the role or the org past the transaction', async () => {
    await runWithTenant(orgA, () => withTenantTransaction(async (tx) => tx.execute(sql`SELECT 1`)));

    const after = await privilegedDb.execute(
      sql`SELECT current_user, current_setting('app.current_org', true) AS org`,
    );
    const row = after.rows[0] as { current_user: string; org: string | null };

    expect(row.current_user).not.toBe('app_user');
    expect(row.org).toBeNull();
  });

  it('rejects being called with no tenant context rather than running unscoped', async () => {
    await expect(withTenantTransaction(async (tx) => tx.execute(sql`SELECT 1`))).rejects.toThrow(
      /tenant context/i,
    );
  });

  it('exposes the current org id inside the context', async () => {
    const seen = await runWithTenant(orgB, async () => getTenantOrgId());
    expect(seen).toBe(orgB);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- server/middleware/tenancy.test.ts`
Expected: FAIL — `Cannot find module './tenancy'`.

- [ ] **Step 3: Rename the raw handle in `server/db.ts`**

In `server/db.ts`, change the export so the privileged handle is named for what it is. Find the existing `export { db }` (or `export const db` / `export { db, closeDb }` — match whatever the file actually has) and make the exported names:

```ts
/**
 * The superuser handle. It BYPASSES row-level security, so it is correct only for
 * migrations, bootstrap and tests. Application code must go through
 * withTenantTransaction in server/middleware/tenancy.ts instead — an architecture test
 * in Task 6 fails if a route imports this.
 */
export { db as privilegedDb };

/** @deprecated Use privilegedDb for bootstrap, or withTenantTransaction in request code. */
export { db };
```

Keep every other export in that file unchanged, including `closeDb`.

- [ ] **Step 4: Implement the tenancy module**

Create `server/middleware/tenancy.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { Request, Response, NextFunction } from 'express';
import { privilegedDb } from '../db';

/** The Drizzle transaction handle, already scoped to one organization. */
export type TenantTx = Parameters<Parameters<typeof privilegedDb.transaction>[0]>[0];

interface TenantContext {
  organizationId: number;
}

/**
 * Same pattern as server/middleware/correlation.ts: one AsyncLocalStorage carrying
 * request-scoped state through the whole async chain, so nothing has to be threaded
 * through every function signature.
 */
const tenantStore = new AsyncLocalStorage<TenantContext>();

export function getTenantOrgId(): number | undefined {
  return tenantStore.getStore()?.organizationId;
}

/** Runs `fn` with the given organization as the ambient tenant. Used by tests and jobs. */
export function runWithTenant<T>(organizationId: number, fn: () => Promise<T> | T): Promise<T> {
  return Promise.resolve(tenantStore.run({ organizationId }, fn));
}

export function tenancyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const organizationId = (req.user as { organizationId?: number } | undefined)?.organizationId;
  if (organizationId === undefined) {
    // Unauthenticated or pre-org routes (login, health) simply have no tenant; the
    // request proceeds and any tenant query inside it will refuse to run.
    return next();
  }
  tenantStore.run({ organizationId }, () => next());
}

/**
 * Opens a transaction bound to the ambient organization.
 *
 * All three statements below are load-bearing:
 *  - SET LOCAL ROLE, because RLS is silently inert under a superuser: with ENABLE, FORCE
 *    and a correct policy in place, a superuser still sees every row and can UPDATE across
 *    organizations. There is no error and no warning.
 *  - LOCAL, because db.ts uses a connection pool. A non-local SET outlives the request and
 *    the next request on that connection inherits this organization.
 *  - set_config with a bound parameter rather than an interpolated SET, because the value
 *    would otherwise be an injection surface. Bound, a hostile value is rejected by the
 *    integer cast in the policy instead of executed.
 */
export async function withTenantTransaction<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  const organizationId = getTenantOrgId();
  if (organizationId === undefined) {
    throw new Error(
      'withTenantTransaction called with no tenant context. Wrap the call in runWithTenant, ' +
        'or ensure tenancyMiddleware ran for this request.',
    );
  }

  return privilegedDb.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.current_org', ${String(organizationId)}, true)`);
    return fn(tx as TenantTx);
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- server/middleware/tenancy.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add server/middleware/tenancy.ts server/middleware/tenancy.test.ts server/db.ts
git commit -m "feat(tenancy): tenant context and RLS-bound transaction helper

withTenantTransaction opens a transaction that first issues SET LOCAL ROLE
app_user and set_config('app.current_org', ..., true). Each part is required for
a different reason: the role because RLS is silently inert under a superuser,
LOCAL because db.ts pools connections and a non-local setting would be inherited
by the next request, and set_config with a bound parameter because an
interpolated SET would be an injection surface.

Renames the raw handle to privilegedDb so its privilege is visible at every call
site. It bypasses RLS and is correct only for migrations, bootstrap and tests."
```

---

### Task 3: Enable RLS

**Files:**
- Create: `migrations/0004_enable_rls.sql`
- Test: `server/tests/isolation.test.ts`

**Interfaces:**
- Consumes: `ORG_SCOPED_TABLES` (Task 1), `withTenantTransaction` / `runWithTenant` (Task 2).
- Produces: an RLS policy named `org_isolation` on each of the 16 org-scoped tables.

- [ ] **Step 1: Write the failing isolation test**

Create `server/tests/isolation.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { withTenantTransaction, runWithTenant } from '../middleware/tenancy';
import { ORG_SCOPED_TABLES } from '@shared/schema';
import { projects } from '@shared/schema';

let orgA: number;
let orgB: number;

beforeEach(async () => {
  const rows = await privilegedDb.execute(
    sql`INSERT INTO organizations (name) VALUES ('A'), ('B') RETURNING id`,
  );
  orgA = Number((rows.rows[0] as { id: number }).id);
  orgB = Number((rows.rows[1] as { id: number }).id);

  await privilegedDb.execute(sql`
    INSERT INTO projects (name, user_id, organization_id)
    VALUES ('a-project', 1, ${orgA}), ('b-project', 1, ${orgB})
  `);
});

afterEach(async () => {
  await privilegedDb.execute(sql`DELETE FROM projects WHERE organization_id IN (${orgA}, ${orgB})`);
  await privilegedDb.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`);
});

describe('row-level isolation', () => {
  /**
   * Deliberately no WHERE clause. This is the property that justifies choosing RLS over
   * disciplined filtering: it must hold regardless of what the query author wrote.
   */
  it('returns only the current organization rows from an unfiltered SELECT', async () => {
    const namesA = await runWithTenant(orgA, () =>
      withTenantTransaction(async (tx) => (await tx.select().from(projects)).map((p) => p.name)),
    );
    const namesB = await runWithTenant(orgB, () =>
      withTenantTransaction(async (tx) => (await tx.select().from(projects)).map((p) => p.name)),
    );

    expect(namesA).toEqual(['a-project']);
    expect(namesB).toEqual(['b-project']);
  });

  it('refuses a cross-organization UPDATE', async () => {
    await runWithTenant(orgA, () =>
      withTenantTransaction((tx) =>
        tx.execute(sql`UPDATE projects SET name = 'hacked' WHERE organization_id = ${orgB}`),
      ),
    );

    const rows = await privilegedDb.execute(
      sql`SELECT name FROM projects WHERE organization_id = ${orgB}`,
    );
    expect((rows.rows[0] as { name: string }).name).toBe('b-project');
  });

  it('refuses a cross-organization DELETE', async () => {
    await runWithTenant(orgA, () =>
      withTenantTransaction((tx) =>
        tx.execute(sql`DELETE FROM projects WHERE organization_id = ${orgB}`),
      ),
    );

    const rows = await privilegedDb.execute(
      sql`SELECT count(*) AS n FROM projects WHERE organization_id = ${orgB}`,
    );
    expect(Number((rows.rows[0] as { n: string }).n)).toBe(1);
  });

  /**
   * Pins the constraint this whole design rests on. A superuser bypasses RLS entirely, with
   * no error and no warning — so if the application ever reverts to connecting as one, this
   * test changes behaviour and someone notices. Without it, that regression is mute.
   */
  it('still bypasses isolation for the privileged handle, as Postgres specifies', async () => {
    const rows = await privilegedDb.execute(sql`SELECT count(*) AS n FROM projects`);
    expect(Number((rows.rows[0] as { n: string }).n)).toBeGreaterThanOrEqual(2);
  });

  it('protects every org-scoped table, enumerated from the schema', async () => {
    const rows = await privilegedDb.execute(sql`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
    `);
    const flags = new Map(
      rows.rows.map((r) => {
        const row = r as { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean };
        return [row.relname, row];
      }),
    );

    for (const table of ORG_SCOPED_TABLES) {
      expect(flags.get(table)?.relrowsecurity, `${table} has RLS disabled`).toBe(true);
      expect(flags.get(table)?.relforcerowsecurity, `${table} does not FORCE RLS`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- server/tests/isolation.test.ts`
Expected: FAIL — the unfiltered SELECT returns both projects, because no policy exists yet.

- [ ] **Step 3: Write the RLS migration**

Create `migrations/0004_enable_rls.sql`:

```sql
-- Enabling and forcing RLS, plus one policy per org-scoped table. FORCE is required so the
-- table owner is subject to the policy too; note it does NOT subject a superuser, which is
-- why the application reaches these tables via SET LOCAL ROLE app_user.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects','tests','test_runs','detected_elements','api_tests','api_test_history',
    'test_plans','test_plan_schedules','test_plan_executions','test_plan_selected_tests',
    'test_plan_webhooks','report_test_case_results','execution_logs','environments','secrets',
    'excel_sequences_map'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING (organization_id = current_setting(''app.current_org'', true)::int) WITH CHECK (organization_id = current_setting(''app.current_org'', true)::int)',
      t
    );
  END LOOP;
END $$;
```

The `WITH CHECK` clause matters as much as `USING`: `USING` controls which rows are visible to read, update and delete, while `WITH CHECK` prevents inserting or updating a row *into* another organization.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- server/tests/isolation.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all suites pass. Any suite that reads org-scoped tables through `privilegedDb` still works — the privileged handle bypasses RLS by design.

- [ ] **Step 6: Commit**

```bash
git add migrations/0004_enable_rls.sql server/tests/isolation.test.ts
git commit -m "feat(tenancy): enable row-level security on every org-scoped table

Each table gets ENABLE, FORCE, and an org_isolation policy with both USING and
WITH CHECK — USING governs what is visible to read, update and delete, WITH CHECK
prevents writing a row into another organization.

The isolation test asserts an unfiltered SELECT returns only the current
organization's rows, which is the property that justifies choosing RLS over
disciplined filtering. It also pins that the privileged handle still bypasses
isolation, so that if the application ever reverts to a superuser connection the
test changes behaviour instead of the regression being silent."
```

---

### Task 4: Role gate

**Files:**
- Create: `server/middleware/require-role.ts`
- Test: `server/middleware/require-role.test.ts`
- Modify: `server/auth.ts`

**Interfaces:**
- Consumes: `users.role` from Task 1.
- Produces: `requireRole(minimum: Role): RequestHandler` and `type Role = 'viewer' | 'editor' | 'owner'` from `server/middleware/require-role.ts`. The session user object gains `organizationId: number` and `role: Role`.

- [ ] **Step 1: Write the failing test**

Create `server/middleware/require-role.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { requireRole, type Role } from './require-role';

const appAs = (role: Role | undefined, minimum: Role) => {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: unknown }).user = role ? { id: 1, role } : undefined;
    req.isAuthenticated = (() => Boolean(role)) as never;
    next();
  });
  app.post('/thing', requireRole(minimum), (_req, res) => res.json({ ok: true }));
  return app;
};

describe('requireRole', () => {
  it('allows a role above the minimum', async () => {
    const res = await request(appAs('owner', 'editor')).post('/thing');
    expect(res.status).toBe(200);
  });

  it('allows a role equal to the minimum', async () => {
    const res = await request(appAs('editor', 'editor')).post('/thing');
    expect(res.status).toBe(200);
  });

  it('refuses a role below the minimum', async () => {
    const res = await request(appAs('viewer', 'editor')).post('/thing');
    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated request with 401, not 403', async () => {
    const res = await request(appAs(undefined, 'viewer')).post('/thing');
    expect(res.status).toBe(401);
  });

  /**
   * A role string that is not one of the three known values must fail closed. A row edited
   * by hand, or a future role added to the database before the code knows about it, must not
   * be treated as sufficient.
   */
  it('refuses an unrecognised role rather than assuming it is sufficient', async () => {
    const res = await request(appAs('superadmin' as Role, 'viewer')).post('/thing');
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- server/middleware/require-role.test.ts`
Expected: FAIL — `Cannot find module './require-role'`.

- [ ] **Step 3: Implement the gate**

Create `server/middleware/require-role.ts`:

```ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export type Role = 'viewer' | 'editor' | 'owner';

/**
 * Ascending capability. RLS decides which rows a request may touch; this decides which
 * verbs it may use on them. The two never interact: a viewer and an owner in the same
 * organization see exactly the same rows.
 */
const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export function requireRole(minimum: Role): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated?.() || !req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const role = (req.user as { role?: string }).role;
    const rank = role === undefined ? undefined : RANK[role as Role];

    // Fails closed on an unknown role: a hand-edited row, or a role added to the database
    // before this code knows it, must not be treated as sufficient.
    if (rank === undefined || rank < RANK[minimum]) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- server/middleware/require-role.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Carry the new fields on the session user**

`server/auth.ts:123` deserialises the session user with `storage.getUser(id)`. Confirm that function selects whole rows (`db.select().from(users)`) — if it selects an explicit column list, add `organizationId` and `role` to it. The session user must carry both, because `tenancyMiddleware` reads `req.user.organizationId` and `requireRole` reads `req.user.role`.

Add a test to `server/auth.test.ts`, inside its existing top-level `describe`:

```ts
  it('carries organizationId and role on the session user', async () => {
    const user = await storage.getUser(1);
    expect(user).toBeDefined();
    expect(typeof user!.organizationId).toBe('number');
    expect(['viewer', 'editor', 'owner']).toContain(user!.role);
  });
```

If `server/auth.test.ts` does not already import `storage`, add `import { storage } from './storage';` at the top.

- [ ] **Step 6: Run the auth suite**

Run: `npm test -- server/auth.test.ts`
Expected: PASS, one more test than before.

- [ ] **Step 7: Commit**

```bash
git add server/middleware/require-role.ts server/middleware/require-role.test.ts server/auth.ts server/auth.test.ts
git commit -m "feat(rbac): role gate for mutating routes

requireRole compares an ascending rank, fails closed on an unrecognised role, and
distinguishes 401 from 403 so an unauthenticated request is not reported as a
permissions problem. The session user now carries organizationId and role, which
the tenancy middleware and this gate both read."
```

---

### Task 5: Organization routes

**Files:**
- Create: `server/routes/organization.routes.ts`
- Test: `server/routes/organization.routes.test.ts`
- Modify: `server/routes.ts`

**Interfaces:**
- Consumes: `requireRole` (Task 4), `withTenantTransaction` (Task 2), `organizations`/`users` (Task 1).
- Produces: a default-exported Express router serving `GET /api/organization`, `POST /api/organization/members`, `PATCH /api/organization/members/:userId`, `DELETE /api/organization/members/:userId`.

- [ ] **Step 1: Write the failing test**

Create `server/routes/organization.routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { runWithTenant } from '../middleware/tenancy';
import organizationRoutes from './organization.routes';

let orgId: number;
let ownerId: number;
let editorId: number;
let currentUser: { id: number; role: string; organizationId: number };

const app = express();
app.use(express.json());
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as Request & { user?: unknown }).user = currentUser;
  req.isAuthenticated = (() => true) as never;
  runWithTenant(currentUser.organizationId, async () => next());
});
app.use(organizationRoutes);

beforeEach(async () => {
  const orgRows = await privilegedDb.execute(
    sql`INSERT INTO organizations (name) VALUES ('Acme') RETURNING id`,
  );
  orgId = Number((orgRows.rows[0] as { id: number }).id);

  const userRows = await privilegedDb.execute(sql`
    INSERT INTO users (username, password, organization_id, role)
    VALUES ('org-owner', 'x', ${orgId}, 'owner'), ('org-editor', 'x', ${orgId}, 'editor')
    RETURNING id
  `);
  ownerId = Number((userRows.rows[0] as { id: number }).id);
  editorId = Number((userRows.rows[1] as { id: number }).id);

  currentUser = { id: ownerId, role: 'owner', organizationId: orgId };
});

afterEach(async () => {
  await privilegedDb.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`);
  await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`);
});

describe('GET /api/organization', () => {
  it('returns the organization and its members', async () => {
    const res = await request(app).get('/api/organization');

    expect(res.status).toBe(200);
    expect(res.body.organization).toMatchObject({ id: orgId, name: 'Acme' });
    expect(res.body.members).toHaveLength(2);
    expect(res.body.members.map((m: { username: string }) => m.username).sort()).toEqual([
      'org-editor',
      'org-owner',
    ]);
  });

  it('never returns password hashes', async () => {
    const res = await request(app).get('/api/organization');
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});

describe('PATCH /api/organization/members/:userId', () => {
  it('changes a member role', async () => {
    const res = await request(app)
      .patch(`/api/organization/members/${editorId}`)
      .send({ role: 'viewer' });

    expect(res.status).toBe(200);
    const rows = await privilegedDb.execute(sql`SELECT role FROM users WHERE id = ${editorId}`);
    expect((rows.rows[0] as { role: string }).role).toBe('viewer');
  });

  it('rejects an invalid role', async () => {
    const res = await request(app)
      .patch(`/api/organization/members/${editorId}`)
      .send({ role: 'superadmin' });

    expect(res.status).toBe(400);
  });

  /**
   * Without this, an organization can be left with nobody able to manage it — a state
   * unrecoverable without direct database access.
   */
  it('refuses to demote the last owner', async () => {
    const res = await request(app)
      .patch(`/api/organization/members/${ownerId}`)
      .send({ role: 'editor' });

    expect(res.status).toBe(409);
    const rows = await privilegedDb.execute(sql`SELECT role FROM users WHERE id = ${ownerId}`);
    expect((rows.rows[0] as { role: string }).role).toBe('owner');
  });

  it('refuses to act on a user in another organization', async () => {
    const otherOrg = await privilegedDb.execute(
      sql`INSERT INTO organizations (name) VALUES ('Other') RETURNING id`,
    );
    const otherOrgId = Number((otherOrg.rows[0] as { id: number }).id);
    const outsider = await privilegedDb.execute(sql`
      INSERT INTO users (username, password, organization_id, role)
      VALUES ('outsider', 'x', ${otherOrgId}, 'editor') RETURNING id
    `);
    const outsiderId = Number((outsider.rows[0] as { id: number }).id);

    const res = await request(app)
      .patch(`/api/organization/members/${outsiderId}`)
      .send({ role: 'viewer' });

    expect(res.status).toBe(404);

    await privilegedDb.execute(sql`DELETE FROM users WHERE id = ${outsiderId}`);
    await privilegedDb.execute(sql`DELETE FROM organizations WHERE id = ${otherOrgId}`);
  });
});

describe('DELETE /api/organization/members/:userId', () => {
  it('removes a member', async () => {
    const res = await request(app).delete(`/api/organization/members/${editorId}`);

    expect(res.status).toBe(204);
    const rows = await privilegedDb.execute(sql`SELECT count(*) AS n FROM users WHERE id = ${editorId}`);
    expect(Number((rows.rows[0] as { n: string }).n)).toBe(0);
  });

  it('refuses to remove the last owner', async () => {
    const res = await request(app).delete(`/api/organization/members/${ownerId}`);
    expect(res.status).toBe(409);
  });
});

describe('role gating', () => {
  it('refuses member management to an editor', async () => {
    currentUser = { id: editorId, role: 'editor', organizationId: orgId };

    const res = await request(app)
      .patch(`/api/organization/members/${ownerId}`)
      .send({ role: 'viewer' });

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- server/routes/organization.routes.test.ts`
Expected: FAIL — `Cannot find module './organization.routes'`.

- [ ] **Step 3: Implement the router**

Create `server/routes/organization.routes.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, ne, sql } from 'drizzle-orm';
import { organizations, users } from '@shared/schema';
import { requireRole } from '../middleware/require-role';
import { withTenantTransaction, getTenantOrgId } from '../middleware/tenancy';

const router = Router();

const RoleSchema = z.enum(['viewer', 'editor', 'owner']);

/**
 * users is not an org-scoped RLS table (it holds the organization pointer itself), so these
 * handlers filter by organizationId explicitly. Every query below carries that filter.
 */
router.get('/api/organization', requireRole('viewer'), async (_req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;

  const result = await withTenantTransaction(async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id, name: organizations.name, createdAt: organizations.createdAt })
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    // An explicit column list, never select(): the password hash must not leave the database.
    const members = await tx
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.organizationId, organizationId));

    return { organization, members };
  });

  res.json(result);
});

router.post('/api/organization/members', requireRole('owner'), async (req: Request, res: Response) => {
  const organizationId = getTenantOrgId()!;
  const parsed = z.object({ userId: z.number().int().positive(), role: RoleSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const updated = await withTenantTransaction((tx) =>
    tx
      .update(users)
      .set({ organizationId, role: parsed.data.role })
      .where(eq(users.id, parsed.data.userId))
      .returning({ id: users.id, username: users.username, role: users.role }),
  );

  if (updated.length === 0) return res.status(404).json({ error: 'User not found' });
  res.status(201).json(updated[0]);
});

router.patch(
  '/api/organization/members/:userId',
  requireRole('owner'),
  async (req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });

    const parsed = z.object({ role: RoleSchema }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid role', details: parsed.error.flatten() });
    }

    const outcome = await withTenantTransaction(async (tx) => {
      const [target] = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)));

      if (!target) return { status: 404 as const };

      // Counted inside the transaction, not before it: a read-then-write check would let two
      // concurrent demotions both observe a second owner and both succeed.
      if (target.role === 'owner' && parsed.data.role !== 'owner') {
        const [{ others }] = await tx
          .select({ others: sql<number>`count(*)::int` })
          .from(users)
          .where(
            and(
              eq(users.organizationId, organizationId),
              eq(users.role, 'owner'),
              ne(users.id, userId),
            ),
          );
        if (others === 0) return { status: 409 as const };
      }

      const [updated] = await tx
        .update(users)
        .set({ role: parsed.data.role })
        .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)))
        .returning({ id: users.id, username: users.username, role: users.role });

      return { status: 200 as const, body: updated };
    });

    if (outcome.status === 404) return res.status(404).json({ error: 'Member not found' });
    if (outcome.status === 409) {
      return res.status(409).json({ error: 'An organization must keep at least one owner' });
    }
    res.json(outcome.body);
  },
);

router.delete(
  '/api/organization/members/:userId',
  requireRole('owner'),
  async (req: Request, res: Response) => {
    const organizationId = getTenantOrgId()!;
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });

    const outcome = await withTenantTransaction(async (tx) => {
      const [target] = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)));

      if (!target) return { status: 404 as const };

      if (target.role === 'owner') {
        const [{ others }] = await tx
          .select({ others: sql<number>`count(*)::int` })
          .from(users)
          .where(
            and(
              eq(users.organizationId, organizationId),
              eq(users.role, 'owner'),
              ne(users.id, userId),
            ),
          );
        if (others === 0) return { status: 409 as const };
      }

      await tx.delete(users).where(and(eq(users.id, userId), eq(users.organizationId, organizationId)));
      return { status: 204 as const };
    });

    if (outcome.status === 404) return res.status(404).json({ error: 'Member not found' });
    if (outcome.status === 409) {
      return res.status(409).json({ error: 'An organization must keep at least one owner' });
    }
    res.status(204).end();
  },
);

export default router;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- server/routes/organization.routes.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Mount the router and the tenancy middleware**

In `server/routes.ts`, add the imports alongside the existing route imports:

```ts
import organizationRoutes from "./routes/organization.routes";
import { tenancyMiddleware } from "./middleware/tenancy";
```

Mount the tenancy middleware **before** every router, so it is in scope for all of them, and register the organization router with the others (the existing block around line 82 has `app.use(authRoutes)` and siblings):

```ts
    // Before every router: establishes the ambient organization for the request, which
    // withTenantTransaction requires and refuses to run without.
    app.use(tenancyMiddleware);

    app.use(authRoutes);
    app.use(organizationRoutes);
```

- [ ] **Step 6: Run the full suite, typecheck and lint**

Run: `npm test && npx tsc -b && npx eslint server/ shared/`
Expected: all suites pass; no output from typecheck or lint.

- [ ] **Step 7: Commit**

```bash
git add server/routes/organization.routes.ts server/routes/organization.routes.test.ts server/routes.ts
git commit -m "feat(rbac): organization member management

Four owner-only endpoints. Member lists use an explicit column list rather than
select(), so the password hash cannot leave the database.

The last-owner constraint is evaluated inside the transaction rather than as a
read-then-write check: otherwise two owners demoting each other concurrently both
observe a second owner and both succeed, leaving the organization with nobody able
to manage it and no way back without direct database access."
```

---

### Task 6: Close the unscoped query paths

**Files:**
- Modify: `server/routes/tests.routes.ts:18`, `server/routes/tests.routes.ts:50`
- Test: `server/tests/architecture.test.ts`

**Interfaces:**
- Consumes: `withTenantTransaction` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing architecture test**

Create `server/tests/architecture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routesDir = path.join(serverDir, 'routes');

const routeFiles = () =>
  fs
    .readdirSync(routesDir)
    .filter((f) => f.endsWith('.routes.ts'))
    .map((f) => ({ name: f, source: fs.readFileSync(path.join(routesDir, f), 'utf8') }));

describe('route modules cannot query outside the tenant context', () => {
  /**
   * privilegedDb bypasses RLS. A route importing it — or the deprecated `db` alias — runs as
   * superuser and sees every organization's rows, which is exactly the failure this whole
   * feature exists to prevent. Verifying the shape of the code is the only check that holds
   * as new routes are added by people who have not read this design.
   */
  it('no route module imports the privileged database handle', () => {
    const offenders = routeFiles()
      .filter(({ source }) => /import\s*\{[^}]*\b(db|privilegedDb)\b[^}]*\}\s*from\s*['"][^'"]*db['"]/.test(source))
      .map(({ name }) => name);

    expect(offenders, `these route modules bypass RLS: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every mutating route declares a required role', () => {
    const offenders: string[] = [];

    for (const { name, source } of routeFiles()) {
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        const isMutating = /router\.(post|put|patch|delete)\s*\(/.test(line);
        if (!isMutating) return;
        // The handler chain may wrap onto following lines; look at a small window.
        const window = lines.slice(index, index + 4).join(' ');
        if (!window.includes('requireRole')) {
          offenders.push(`${name}:${index + 1}`);
        }
      });
    }

    expect(offenders, `mutating routes with no requireRole: ${offenders.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- server/tests/architecture.test.ts`
Expected: FAIL on both tests — `tests.routes.ts` imports `db`, and its mutating routes have no `requireRole`.

- [ ] **Step 3: Fix the two unfiltered queries**

In `server/routes/tests.routes.ts`, replace the `GET /api/tests` handler (currently at line 14-24, which runs `db.select().from(tests)` with no filter — the bug that lets any user see every other user's tests):

```ts
// GET /api/tests - List UI tests
router.get("/api/tests", requireRole('viewer'), async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  try {
    // No organization filter here on purpose: the RLS policy applies it. Adding one would
    // be harmless but would suggest the isolation depends on remembering it.
    const allTests = await withTenantTransaction((tx) =>
      tx.select().from(tests).orderBy(desc(tests.createdAt)),
    );
    res.json(allTests);
  } catch (error: any) {
    logger.error({ message: "Error fetching tests", error: error.message });
    res.status(500).json({ error: "Failed to fetch tests" });
  }
});
```

Replace the `POST /api/tests/:id/run` handler (currently at line 45-58, which loads a test by id with no ownership check and executes it):

```ts
// Executing a test launches a browser, reaches external systems, writes execution_logs and
// may run preconditions that mutate the system under test. It is a mutation, so editor.
router.post("/api/tests/:id/run", requireRole('editor'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

    const testId = parseInt(req.params.id);
    try {
        // Under RLS this finds nothing for another organization's test, so the 404 below
        // is the correct answer rather than a leak.
        const testRecord = await withTenantTransaction((tx) =>
          tx.select().from(tests).where(eq(tests.id, testId)).limit(1),
        );
        if (testRecord.length === 0) return res.status(404).json({ error: "Test not found" });

        const result = await playwrightService.executeTestSequence(testRecord[0], (req.user as any).id);
        res.json(result);
    } catch (e: any) {
        logger.error({ message: "Test execution failed", error: e.message });
        res.status(500).json({ error: "Test execution failed" });
    }
});
```

Update that file's imports: remove `db` from the `../db` import, and add:

```ts
import { withTenantTransaction } from "../middleware/tenancy";
import { requireRole } from "../middleware/require-role";
```

Then work through the remaining handlers in the same file and in the other `*.routes.ts` modules the architecture test reports, applying the same two transformations: wrap each query in `withTenantTransaction`, and add `requireRole('editor')` to each mutating route (`requireRole('owner')` for anything writing `system_settings`). Re-run the architecture test after each file to see the offender list shrink.

- [ ] **Step 4: Run the architecture test to verify it passes**

Run: `npm test -- server/tests/architecture.test.ts`
Expected: PASS, 2 tests, with an empty offender list in both.

- [ ] **Step 5: Run the full suite, typecheck and lint**

Run: `npm test && npx tsc -b && npx eslint server/ shared/`
Expected: all suites pass; no output from typecheck or lint.

- [ ] **Step 6: Commit**

```bash
git add server/routes/ server/tests/architecture.test.ts
git commit -m "fix(tenancy): route every route query through the tenant transaction

GET /api/tests ran db.select().from(tests) with no filter, so any authenticated
user saw every other user's tests. POST /api/tests/:id/run loaded a test by id
with no ownership check and executed it. Both now run inside
withTenantTransaction, where RLS applies the boundary.

The architecture tests are the part that lasts: one fails if a route module
imports the privileged handle, the other if a mutating route declares no required
role. Both check the shape of the code rather than its behaviour, because the
failure being prevented is a route added later by someone who has not read this
design."
```

---

## Self-Review

**Spec coverage.** Schema and the three table categories → Task 1. RLS mechanism, `SET LOCAL ROLE`, `LOCAL`, `set_config` → Task 2. Policies with `USING` and `WITH CHECK`, schema-enumerated coverage test, the superuser-bypass pin → Task 3. Three roles, fail-closed, session user fields → Task 4. Four endpoints, last-owner constraint in-transaction, no password leak → Task 5. The two known unfiltered queries, `POST /run` as `editor`, both architecture tests → Task 6. Migration step order with the orphan check → Task 1, Step 2. Every failure-mode row in the spec's table maps to a test in Tasks 2, 3, 5 or 6.

**Not implemented, matching the spec's "out of scope":** per-organization encryption keys, SSO/OIDC, API keys, email invitations, multiple organizations per user. The spec records per-organization keys as a known limitation rather than a gap.

**Placeholder scan.** No TBD/TODO, no "handle edge cases", every step carries literal code and an exact command with its expected result. Task 6, Step 3 is the one step that cannot enumerate its full work in advance — the remaining route handlers are discovered by running the architecture test — so it names the two known cases in full, states the two transformations precisely, and makes the test the completion criterion rather than a vague instruction.

**Type consistency.** `Role` is declared once (Task 4) and used by `requireRole` and the organization routes. `TenantTx`, `withTenantTransaction`, `runWithTenant`, `getTenantOrgId` are declared in Task 2 and used with identical names in Tasks 3, 5 and 6. `privilegedDb` is introduced in Task 2, Step 3 and used under that name in every later test. `ORG_SCOPED_TABLES` is exported in Task 1 and enumerated in Tasks 1 and 3. The 16 org-scoped table names are identical across `shared/schema.ts`, both migrations, and both tests that enumerate them.
