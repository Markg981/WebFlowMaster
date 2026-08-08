import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { withTenantTransaction, runWithTenant } from '../middleware/tenancy';
import { ORG_SCOPED_TABLES } from '@shared/schema';
import { projects } from '@shared/schema';
import { createTestOrganization, createTestUser } from './factories';

let orgA: number;
let orgB: number;
let userA: number;

beforeEach(async () => {
  orgA = await createTestOrganization('A');
  orgB = await createTestOrganization('B');
  // projects.user_id is NOT NULL and FK-references users.id, so the row must name a real
  // user. Only one is needed: the isolation property under test is organization_id, not
  // ownership, and RLS's org_isolation policy never inspects user_id.
  userA = await createTestUser(orgA);

  await privilegedDb.execute(sql`
    INSERT INTO projects (name, user_id, organization_id)
    VALUES ('a-project', ${userA}, ${orgA}), ('b-project', ${userA}, ${orgB})
  `);
});

afterEach(async () => {
  // FK-safe order: projects references users and organizations; users references organizations.
  await privilegedDb.execute(sql`DELETE FROM projects WHERE organization_id IN (${orgA}, ${orgB})`);
  await privilegedDb.execute(sql`DELETE FROM users WHERE id = ${userA}`);
  await privilegedDb.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`);
});

describe('row-level isolation', () => {
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

  it('refuses to INSERT a row into another organization', async () => {
    // The policy's WITH CHECK clause, which USING does not cover: USING decides which rows
    // you can see and modify, WITH CHECK decides what you are allowed to write. Without it a
    // tenant could plant rows in another organization even while unable to read them.
    await expect(
      runWithTenant(orgA, () =>
        withTenantTransaction((tx) =>
          tx.execute(
            sql`INSERT INTO projects (name, user_id, organization_id) VALUES ('planted', ${userA}, ${orgB})`,
          ),
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    const rows = await privilegedDb.execute(
      sql`SELECT count(*) AS n FROM projects WHERE organization_id = ${orgB}`,
    );
    expect(Number((rows.rows[0] as { n: string }).n)).toBe(1);
  });

  it('shows no rows to a connection with no organization bound, rather than raising', async () => {
    // This is the behaviour the policy's NULLIF exists for. A custom GUC does not revert to
    // unset when a LOCAL scope ends — it reads '' from then on (Postgres bug #15646) — so a
    // bare current_setting(...)::int would raise a cast error here. Failing closed via an
    // error is still safe, but an unbound connection should see nothing, not 500.
    const rows = await privilegedDb.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      await tx.execute(sql`SELECT set_config('app.current_org', '', true)`);
      return tx.execute(sql`SELECT count(*) AS n FROM projects`);
    });

    expect(Number((rows.rows[0] as { n: string }).n)).toBe(0);
  });

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
