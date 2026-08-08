import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { withTenantTransaction, runWithTenant, getTenantOrgId } from './tenancy';

let orgA: number;
let orgB: number;
let userA: number;
let userB: number;

beforeEach(async () => {
  orgA = await createTestOrganization('A');
  orgB = await createTestOrganization('B');
  // One user per organization: this suite seeds two orgs at once, and a single shared
  // user would leave both orgs' project rows looking identically owned.
  userA = await createTestUser(orgA, 'tenancy_test_user_a');
  userB = await createTestUser(orgB, 'tenancy_test_user_b');

  await privilegedDb.execute(sql`
    INSERT INTO projects (name, user_id, organization_id)
    VALUES ('a-project', ${userA}, ${orgA}), ('b-project', ${userB}, ${orgB})
  `);
});

afterEach(async () => {
  // Every suite shares one file-backed PGlite database and runs sequentially, so rows left
  // behind here become another suite's problem (e.g. a bare db.delete(users) failing on a
  // leftover FK it never created). See server/tenancy-routes.test.ts's clearAll and
  // scripts/netcontent/importer.test.ts for the same cleanup.
  await privilegedDb.execute(sql`DELETE FROM projects WHERE organization_id IN (${orgA}, ${orgB})`);
  await privilegedDb.execute(sql`DELETE FROM users WHERE id IN (${userA}, ${userB})`);
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
    // A custom GUC reverts to its empty-string default when the LOCAL scope ends, not to
    // unset: the name springs into existence the first time it is touched on a connection
    // (Postgres bug #15646). current_setting(name, true) only answers NULL before that has
    // ever happened on that backend, so a pooled connection sees '' forever after its first
    // tenant transaction. Both mean "no organization bound"; neither is the org we set.
    expect(row.org === null || row.org === '').toBe(true);
    expect(row.org).not.toBe(String(orgA));
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
