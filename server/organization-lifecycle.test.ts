import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from './db';
import { ORG_SCOPED_TABLES } from '@shared/schema';
import { exportOrganization, eraseOrganization } from './organization-lifecycle';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { recordAudit } from './audit';
import { AUDIT_ACTIONS } from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';

let orgA: number;
let orgB: number;
let userA: number;
let userB: number;

/** A project, a test and an audit entry in each organization, so erasure has real work to do. */
async function seed(organizationId: number, userId: number, label: string) {
  await privilegedDb.execute(sql`
    INSERT INTO projects (name, user_id, organization_id) VALUES (${`${label}-project`}, ${userId}, ${organizationId})
  `);
  await privilegedDb.execute(sql`
    INSERT INTO tests (user_id, organization_id, name, url, sequence, elements)
    VALUES (${userId}, ${organizationId}, ${`${label}-test`}, 'https://app.test', '[]'::jsonb, '[]'::jsonb)
  `);
  await runWithTenant(organizationId, () =>
    withTenantTransaction((tx) =>
      recordAudit(tx, { action: AUDIT_ACTIONS.MEMBER_REMOVED, actor: { id: userId, username: label } }),
    ),
  );
}

beforeEach(async () => {
  orgA = await createTestOrganization('Erasable');
  orgB = await createTestOrganization('Bystander');
  userA = await createTestUser(orgA, 'erasable_user');
  userB = await createTestUser(orgB, 'bystander_user');
  await seed(orgA, userA, 'a');
  await seed(orgB, userB, 'b');
});

afterEach(async () => {
  // Cleanup by the function under test. A hand-written list here would need updating every
  // time a table is added — the first version of this hook forgot `invitations` and the
  // resulting foreign-key failure surfaced three tests later as a username collision. Erasing
  // an already-erased organization is a no-op, so this is safe after the erasure tests too.
  await eraseOrganization(orgA);
  await eraseOrganization(orgB);
});

describe('exportOrganization', () => {
  it('includes every org-scoped table, so nothing is silently left out', async () => {
    const exported = (await exportOrganization(orgA)) as {
      organization: { id: number };
      data: Record<string, unknown[]>;
    };

    expect(exported.organization.id).toBe(orgA);
    // Enumerated from the schema, not from a list in the test: a table added to
    // ORG_SCOPED_TABLES and forgotten in the exporter fails here.
    for (const table of ORG_SCOPED_TABLES) {
      expect(exported.data[table], `${table} missing from the export`).toBeDefined();
    }
    expect(exported.data.users).toBeDefined();
    expect(exported.data.invitations).toBeDefined();
  });

  it('carries the organization’s own rows and none of the other’s', async () => {
    const exported = (await exportOrganization(orgA)) as { data: Record<string, { name?: string }[]> };

    expect(exported.data.projects.map((p) => p.name)).toEqual(['a-project']);
    expect(exported.data.tests.map((t) => t.name)).toEqual(['a-test']);
    expect(exported.data.audit_log).toHaveLength(1);
  });

  it('excludes password hashes and invitation tokens', async () => {
    await privilegedDb.execute(sql`
      INSERT INTO invitations (organization_id, username, role, token, invited_by_user_id, expires_at)
      VALUES (${orgA}, 'pending', 'editor', ${'c'.repeat(64)}, ${userA}, now() + interval '7 days')
    `);

    const exported = await exportOrganization(orgA);
    const serialised = JSON.stringify(exported);

    // An export is data portability, not a credential dump, and it lands in a file the customer
    // will email to someone.
    expect(serialised).not.toContain('c'.repeat(64));
    expect(serialised).not.toContain('fixture_password');
    // Sanity: the rows are actually present, so the assertions above are not passing on empty
    // collections.
    expect((exported as { data: Record<string, unknown[]> }).data.invitations).toHaveLength(1);
    expect((exported as { data: Record<string, unknown[]> }).data.users).toHaveLength(1);
  });
});

describe('eraseOrganization', () => {
  const countIn = async (table: string, organizationId: number) => {
    const rows = await privilegedDb.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId}`,
    );
    return (rows.rows[0] as { n: number }).n;
  };

  it('removes the organization and everything belonging to it', async () => {
    await eraseOrganization(orgA);

    for (const table of ['projects', 'tests', 'users', 'audit_log']) {
      expect(await countIn(table, orgA), `${table} still has rows`).toBe(0);
    }
    const org = await privilegedDb.execute(sql`SELECT id FROM organizations WHERE id = ${orgA}`);
    expect(org.rows).toHaveLength(0);
  });

  it('leaves every other organization untouched', async () => {
    await eraseOrganization(orgA);

    expect(await countIn('projects', orgB)).toBe(1);
    expect(await countIn('tests', orgB)).toBe(1);
    expect(await countIn('users', orgB)).toBe(1);
    expect(await countIn('audit_log', orgB)).toBe(1);
  });

  /**
   * audit_log is append-only to the application — app_user holds SELECT and INSERT and nothing
   * else, which is what makes it evidence. Erasure has to be able to remove it anyway, which is
   * exactly why this module is privileged rather than going through a tenant transaction.
   */
  it('can delete the audit trail, which a tenant connection deliberately cannot', async () => {
    await expect(
      runWithTenant(orgA, () =>
        withTenantTransaction(async (tx) => {
          await tx.execute(sql`DELETE FROM audit_log`);
        }),
      ),
    ).rejects.toThrow(/permission denied/i);

    await eraseOrganization(orgA);
    expect(await countIn('audit_log', orgA)).toBe(0);
  });

  it('reports what it deleted', async () => {
    const { deleted } = await eraseOrganization(orgA);

    expect(deleted.organizations).toBe(1);
    expect(deleted.users).toBe(1);
    expect(deleted.projects).toBe(1);
    expect(deleted.tests).toBe(1);
  });
});
