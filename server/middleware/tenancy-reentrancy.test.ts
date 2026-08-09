import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { projects, users, organizations } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import {
  runWithTenant,
  withTenantTransaction,
  TenantConflictError,
  getTenantOrgId,
} from './tenancy';
import { createTestOrganization, createTestUser } from '../tests/factories';

/**
 * The properties that make withTenantTransaction safe to nest, each asserted directly
 * against the database rather than reasoned about.
 *
 * A nested call joins the outer transaction instead of opening a second one, and therefore
 * does NOT reissue `SET LOCAL ROLE app_user` or `set_config('app.current_org', ...)`. That
 * makes "is the binding still in force inside the join?" the whole question — and it is not
 * a question a test can answer by construction, because RLS is silently inert under a
 * superuser: a join that lost the role would read every tenant's rows with no error and no
 * warning. Hence the explicit `SELECT current_user` assertions.
 *
 * The rest cover the ways carrying a live transaction in AsyncLocalStorage could go wrong:
 * a stale handle outliving its transaction, two concurrent calls sharing one, or two
 * tenants in flight crossing.
 */

let orgA: number;
let orgB: number;
let userA: number;

beforeEach(async () => {
  await privilegedDb.delete(projects);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
  orgA = await createTestOrganization('A');
  orgB = await createTestOrganization('B');
  userA = await createTestUser(orgA);
});

afterEach(async () => {
  await privilegedDb.delete(projects);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
});

async function whoAmI(tx: { execute: (q: unknown) => Promise<{ rows: unknown[] }> }) {
  const r = await tx.execute(
    sql`SELECT current_user::text AS cu, current_setting('app.current_org', true) AS org`,
  );
  return r.rows[0] as { cu: string; org: string | null };
}

describe('reentrancy', () => {
  it('a joined inner call still runs as app_user with the outer organization bound', async () => {
    await runWithTenant(orgA, async () => {
      await withTenantTransaction(async (outerTx) => {
        const outer = await whoAmI(outerTx);
        expect(outer.cu).toBe('app_user');
        expect(outer.org).toBe(String(orgA));

        await withTenantTransaction(async (innerTx) => {
          const inner = await whoAmI(innerTx);
          // The inner call does not reissue SET LOCAL ROLE / set_config, so this is the
          // whole question: is the binding genuinely still in force, or merely assumed?
          expect(inner.cu).toBe('app_user');
          expect(inner.org).toBe(String(orgA));
        });
      });
    });
  });

  it('two sequential transactions in one tenant scope each get a live transaction', async () => {
    await runWithTenant(orgA, async () => {
      await withTenantTransaction(async (tx) => {
        await tx.execute(sql`SELECT 1`);
      });
      // If `tx` lingered in context after the first commit, this would join a closed
      // transaction rather than opening a fresh one.
      await withTenantTransaction(async (tx) => {
        const who = await whoAmI(tx);
        expect(who.cu).toBe('app_user');
        expect(who.org).toBe(String(orgA));
      });
    });
  });

  it('a rollback in the outer undoes writes made by the joined inner', async () => {
    await expect(
      runWithTenant(orgA, () =>
        withTenantTransaction(async () => {
          await withTenantTransaction(async (innerTx) => {
            await innerTx.insert(projects).values({
              name: 'inner-project',
              userId: userA,
              organizationId: orgA,
            });
          });
          throw new Error('outer fails after the inner wrote');
        }),
      ),
    ).rejects.toThrow('outer fails after the inner wrote');

    const rows = await privilegedDb.select().from(projects).where(eq(projects.name, 'inner-project'));
    expect(rows).toHaveLength(0);
  });

  it('rejects a nested runWithTenant that names a different organization', async () => {
    await expect(
      runWithTenant(orgA, () =>
        withTenantTransaction(async () => {
          await runWithTenant(orgB, async () => 'should never run');
        }),
      ),
    ).rejects.toThrow(TenantConflictError);
  });

  it('does not leave the transaction visible in context after it ends', async () => {
    await runWithTenant(orgA, async () => {
      await withTenantTransaction(async () => {});
      expect(getTenantOrgId()).toBe(orgA);
      // A fresh transaction must still be openable — i.e. nothing stale is being joined.
      await withTenantTransaction(async (tx) => {
        await tx.execute(sql`SELECT 1`);
      });
    });
  });

  it('two concurrent transactions in one request do not cross', async () => {
    await runWithTenant(orgA, async () => {
      // Promise.all of two withTenantTransaction calls: each starts from the same ambient
      // context, which has no tx, so each must open its own rather than sharing one.
      const results = await Promise.all([
        withTenantTransaction(async (tx) => (await whoAmI(tx)).org),
        withTenantTransaction(async (tx) => (await whoAmI(tx)).org),
      ]);
      expect(results).toEqual([String(orgA), String(orgA)]);
    });
  });

  it('two different tenants in flight together stay separate', async () => {
    const [a, b] = await Promise.all([
      runWithTenant(orgA, () => withTenantTransaction(async (tx) => (await whoAmI(tx)).org)),
      runWithTenant(orgB, () => withTenantTransaction(async (tx) => (await whoAmI(tx)).org)),
    ]);
    expect(a).toBe(String(orgA));
    expect(b).toBe(String(orgB));
  });
});
