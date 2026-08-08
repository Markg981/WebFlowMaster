import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { privilegedDb } from '../db';
import { createTestOrganization, createTestUser } from '../tests/factories';
import {
  withTenantTransaction,
  runWithTenant,
  getTenantOrgId,
  tenancyMiddleware,
  TenantConflictError,
} from './tenancy';

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
  //
  // beforeEach seeds four rows in sequence (two organizations, then two users, then two
  // projects). If it throws partway through, some of orgA/orgB/userA/userB are still
  // undefined; deleting with an undefined id would itself throw, which would replace the
  // original beforeEach failure with a confusing afterEach one instead of surfacing it. So
  // each statement below only runs when it has at least one real id to delete.
  const orgIds = [orgA, orgB].filter((id): id is number => id !== undefined);
  const userIds = [userA, userB].filter((id): id is number => id !== undefined);

  if (orgIds.length > 0) {
    const idList = sql.join(
      orgIds.map((id) => sql`${id}`),
      sql`, `,
    );
    await privilegedDb.execute(sql`DELETE FROM projects WHERE organization_id IN (${idList})`);
  }
  if (userIds.length > 0) {
    const idList = sql.join(
      userIds.map((id) => sql`${id}`),
      sql`, `,
    );
    await privilegedDb.execute(sql`DELETE FROM users WHERE id IN (${idList})`);
  }
  if (orgIds.length > 0) {
    const idList = sql.join(
      orgIds.map((id) => sql`${id}`),
      sql`, `,
    );
    await privilegedDb.execute(sql`DELETE FROM organizations WHERE id IN (${idList})`);
  }
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
   *
   * Caveat: this reads back through `privilegedDb.execute`, not through the connection the
   * transaction actually used. Under PGlite (what CI runs) that is the same connection —
   * there is only one — so the assertion is meaningful here. Under node-postgres in
   * production, `privilegedDb.execute` draws an arbitrary client from the pool, which need
   * not be the one the transaction held, so the same assertion there would be vacuous: it
   * could pass by virtue of reading a *different*, never-touched connection rather than by
   * the setting actually having reverted. The real guarantee against a production leak is
   * structural, not something this test observes: the `LOCAL` keyword scopes the `SET`/
   * `set_config` to the transaction itself, and drizzle only releases a node-postgres client
   * back to the pool after COMMIT/ROLLBACK completes, so no other request can observe the
   * binding mid-transaction. Don't read more into a green run of this test than that.
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
    // Redundant given the check above (neither null nor '' can equal String(orgA)), kept
    // anyway because it states the actual security property under test — the org value does
    // not survive — rather than just its two allowed encodings.
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

describe('withTenantTransaction reentrancy', () => {
  /**
   * Nesting withTenantTransaction inside itself must not open a second transaction: under
   * PGlite that deadlocks forever on the client's single-writer mutex (and wedges the shared
   * connection for every later test in the file); under node-postgres it silently takes a
   * second pool client, losing atomicity. This test pins "the inner call reuses the outer
   * transaction" as observable behavior — the same `tx` handle is seen by both levels.
   */
  it('a nested call joins the outer transaction instead of opening a second one', async () => {
    let outerTx: unknown;
    let innerTx: unknown;

    await runWithTenant(orgA, () =>
      withTenantTransaction(async (tx) => {
        outerTx = tx;
        await withTenantTransaction(async (nestedTx) => {
          innerTx = nestedTx;
        });
      }),
    );

    expect(innerTx).toBe(outerTx);
  });

  it('a rollback in the outer transaction undoes work done by a nested call', async () => {
    const orgName = `tenancy-reentrancy-rollback-${orgA}-${orgB}`;

    await expect(
      runWithTenant(orgA, () =>
        withTenantTransaction(async () => {
          await withTenantTransaction(async (nestedTx) => {
            await nestedTx.execute(sql`INSERT INTO organizations (name) VALUES (${orgName})`);
          });
          throw new Error('force rollback');
        }),
      ),
    ).rejects.toThrow('force rollback');

    const rows = await privilegedDb.execute(sql`SELECT id FROM organizations WHERE name = ${orgName}`);
    expect(rows.rows).toHaveLength(0);
  });

  it('throws TenantConflictError when a nested call would bind a different organization', async () => {
    await expect(
      runWithTenant(orgA, () =>
        withTenantTransaction(async () => {
          // orgB differs from the orgA binding the outer transaction already opened; joining
          // it would silently run orgB's work under orgA's SET LOCAL ROLE / app.current_org.
          await runWithTenant(orgB, () => withTenantTransaction(async () => {}));
        }),
      ),
    ).rejects.toThrow(TenantConflictError);
  });
});

describe('tenancyMiddleware', () => {
  function fakeReqRes(user: { organizationId: number } | undefined) {
    const req = { user } as unknown as Request;
    const res = {} as Response;
    return { req, res };
  }

  it('binds req.user.organizationId so a downstream async handler observes it via getTenantOrgId', async () => {
    const { req, res } = fakeReqRes({ organizationId: orgA });

    const seen = await new Promise<number | undefined>((resolve) => {
      tenancyMiddleware(req, res, () => {
        // A real Express handler observes the binding across an async boundary, not just
        // synchronously inside next() — AsyncLocalStorage needs to survive that for this
        // middleware to be useful at all. Simulate it with an awaited microtask.
        void (async () => {
          await Promise.resolve();
          resolve(getTenantOrgId());
        })();
      });
    });

    expect(seen).toBe(orgA);
  });

  it('leaves no tenant bound for a request with no req.user, so a downstream transaction rejects', async () => {
    const { req, res } = fakeReqRes(undefined);

    let seenOrgId: number | undefined;
    let rejection: unknown;

    await new Promise<void>((resolve) => {
      tenancyMiddleware(req, res, () => {
        void (async () => {
          seenOrgId = getTenantOrgId();
          try {
            await withTenantTransaction(async (tx) => tx.execute(sql`SELECT 1`));
          } catch (err) {
            rejection = err;
          }
          resolve();
        })();
      });
    });

    expect(seenOrgId).toBeUndefined();
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toMatch(/tenant context/i);
  });
});
