import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { auditLog, AUDIT_ACTIONS } from '@shared/schema';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import { recordAudit } from './audit';
import { createTestOrganization, createTestUser } from './tests/factories';

/**
 * The two properties that make this an audit log rather than another table of log lines:
 * the application cannot rewrite history, and an entry cannot disagree with the change it
 * describes. Everything else about it is ordinary.
 */

let orgA: number;
let orgB: number;
let userA: number;

beforeEach(async () => {
  orgA = await createTestOrganization('Audit A');
  orgB = await createTestOrganization('Audit B');
  userA = await createTestUser(orgA);
});

afterEach(async () => {
  await privilegedDb.execute(sql`DELETE FROM audit_log WHERE organization_id IN (${orgA}, ${orgB})`);
  await privilegedDb.execute(sql`DELETE FROM users WHERE organization_id IN (${orgA}, ${orgB})`);
  await privilegedDb.execute(sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`);
});

const asAppUser = <T>(fn: (tx: { execute: (q: unknown) => Promise<T> }) => Promise<T>) =>
  privilegedDb.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    return fn(tx as never);
  });

describe('recordAudit', () => {
  it('writes an entry attributed to the ambient organization and the given actor', async () => {
    await runWithTenant(orgA, () =>
      withTenantTransaction((tx) =>
        recordAudit(tx, {
          action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
          actor: { id: userA, username: 'someone' },
          targetType: 'user',
          targetId: userA,
          metadata: { from: 'editor', to: 'owner' },
        }),
      ),
    );

    const [entry] = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, orgA));
    expect(entry.action).toBe('member.role_changed');
    expect(entry.actorUserId).toBe(userA);
    expect(entry.actorUsername).toBe('someone');
    expect(entry.targetId).toBe(String(userA));
    expect(entry.metadata).toEqual({ from: 'editor', to: 'owner' });
  });

  it('refuses to write with no tenant context rather than guessing an organization', async () => {
    // The organization is never an argument, so there is no way to attribute an entry to one
    // the caller is not currently acting as.
    await expect(
      privilegedDb.transaction((tx) =>
        recordAudit(tx as never, { action: AUDIT_ACTIONS.MEMBER_REMOVED }),
      ),
    ).rejects.toThrow(/tenant context/i);
  });

  /**
   * The property the whole design turns on. An entry written in its own transaction would
   * survive a change that then failed — a record of something that never happened.
   */
  it('rolls back with the change it describes', async () => {
    await expect(
      runWithTenant(orgA, () =>
        withTenantTransaction(async (tx) => {
          await recordAudit(tx, {
            action: AUDIT_ACTIONS.MEMBER_REMOVED,
            actor: { id: userA, username: 'someone' },
          });
          throw new Error('the change failed after the entry was written');
        }),
      ),
    ).rejects.toThrow('the change failed');

    const entries = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, orgA));
    expect(entries).toHaveLength(0);
  });

  it('is scoped by RLS, so one organization cannot read another’s trail', async () => {
    await runWithTenant(orgA, () =>
      withTenantTransaction((tx) => recordAudit(tx, { action: AUDIT_ACTIONS.MEMBER_REMOVED })),
    );
    await runWithTenant(orgB, () =>
      withTenantTransaction((tx) => recordAudit(tx, { action: AUDIT_ACTIONS.INVITATION_CREATED })),
    );

    const seenByA = await runWithTenant(orgA, () =>
      withTenantTransaction((tx) => tx.select().from(auditLog)),
    );

    expect(seenByA).toHaveLength(1);
    expect(seenByA[0].action).toBe('member.removed');
  });
});

describe('the audit log is append-only at the database level', () => {
  beforeEach(async () => {
    await runWithTenant(orgA, () =>
      withTenantTransaction((tx) =>
        recordAudit(tx, { action: AUDIT_ACTIONS.MEMBER_REMOVED, actor: { id: userA, username: 'someone' } }),
      ),
    );
  });

  /**
   * Not "the application does not do this" but "the application cannot". A log the application
   * is able to edit is not evidence of anything, so the guarantee has to live in the grant
   * rather than in the routes — there is no route that erases an entry, and this is what makes
   * that true of any future route too.
   */
  it('cannot be updated by app_user', async () => {
    await expect(
      asAppUser((tx) => tx.execute(sql`UPDATE audit_log SET action = 'nothing.happened'`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it('cannot be deleted by app_user', async () => {
    await expect(asAppUser((tx) => tx.execute(sql`DELETE FROM audit_log`))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('can still be read and appended to', async () => {
    const read = await runWithTenant(orgA, () =>
      withTenantTransaction((tx) => tx.select().from(auditLog)),
    );
    expect(read).toHaveLength(1);

    await runWithTenant(orgA, () =>
      withTenantTransaction((tx) => recordAudit(tx, { action: AUDIT_ACTIONS.INVITATION_REVOKED })),
    );
    const after = await runWithTenant(orgA, () =>
      withTenantTransaction((tx) => tx.select().from(auditLog)),
    );
    expect(after).toHaveLength(2);
  });

  it('keeps the entry, and the actor’s name, after the actor is deleted', async () => {
    // ON DELETE SET NULL plus a denormalised username: removing a member must not erase what
    // they did, and must not be blocked by the fact that they did it.
    await privilegedDb.execute(sql`DELETE FROM users WHERE id = ${userA}`);

    const [entry] = await privilegedDb.select().from(auditLog).where(eq(auditLog.organizationId, orgA));
    expect(entry).toBeDefined();
    expect(entry.actorUserId).toBeNull();
    expect(entry.actorUsername).toBe('someone');
  });
});
