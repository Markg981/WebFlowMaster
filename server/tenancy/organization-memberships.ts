import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  auditLog,
  invitations,
  organizationMemberships,
  organizations,
  users,
  type User,
} from '@shared/schema';
import { privilegedDb } from '../platform/db';
import type { TenantTx } from '../platform/middleware/tenancy';
import { removePersonalRowsInOrganization } from './member-removal';

/**
 * A person in several organizations (migration 0086).
 *
 * `organization_memberships` is the set of organizations an account may act in, with its role in
 * each. Which one a request acts in belongs to the request, not to the account: a session names
 * its organization (server/identity/auth.ts), an API key is bound to the organization that issued
 * it, and `actingAs` resolves either against the membership on every request. Two browsers of the
 * same person can so act in two organizations without one changing what the other does.
 *
 * `users.organization_id` and `users.role` remain as the organization the account last switched
 * to, and its role there: where a new sign-in starts. Switching copies a membership onto them and
 * re-establishes the session that asked; the person's other sessions keep their own.
 *
 * Two kinds of function live here. Those taking a `TenantTx` run inside an organization and see,
 * through the policy, that organization's members only: listing, re-roling, removing. Those on
 * the privileged handle answer the one question an organization cannot: what *else* does this
 * person belong to. That is a bootstrap read of the same shape as a session lookup — it has to
 * happen before the organization it leads to is bound — and its budget is written down in
 * server/tests/architecture.test.ts.
 */

type PrivilegedTx = Parameters<Parameters<typeof privilegedDb.transaction>[0]>[0];

export interface MembershipSummary {
  id: number;
  name: string;
  role: string;
  /** The organization the request acts in. */
  current: boolean;
}

/**
 * The account acting in `organizationId`: its own row, with the organization and the role its
 * membership there names. Null when it is not (or no longer) a member — a session that was opened
 * in an organization the person has since been removed from ends at its next request, rather than
 * quietly acting somewhere else.
 *
 * Privileged, as the session lookup it follows is: it answers which organization the request is
 * for, so it cannot run inside one.
 */
export async function actingAs(user: User, organizationId: number): Promise<User | null> {
  const [membership] = await privilegedDb
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.userId, user.id),
        eq(organizationMemberships.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!membership) return null;
  return { ...user, organizationId, role: membership.role };
}

/** Every organization the person belongs to, for the switcher. Oldest membership first. */
export async function membershipsOf(
  user: Pick<User, 'id' | 'organizationId'>,
): Promise<MembershipSummary[]> {
  const rows = await privilegedDb
    .select({
      id: organizationMemberships.organizationId,
      name: organizations.name,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(eq(organizationMemberships.userId, user.id))
    .orderBy(asc(organizationMemberships.createdAt), asc(organizationMemberships.id));
  return rows.map((row) => ({ ...row, current: row.id === user.organizationId }));
}

/** Whether the person belongs to an organization other than `organizationId`. */
export async function hasOtherMembership(userId: number, organizationId: number): Promise<boolean> {
  const [row] = await privilegedDb
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.userId, userId),
        ne(organizationMemberships.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function applyMembership(
  tx: PrivilegedTx,
  userId: number,
  membership: { organizationId: number; role: string },
): Promise<User> {
  const [user] = await tx
    .update(users)
    .set({ organizationId: membership.organizationId, role: membership.role })
    .where(eq(users.id, userId))
    .returning();
  return user;
}

/**
 * Makes `organizationId` the person's current organization, with the role their membership there
 * names. Null when they are not a member: the caller answers 403 and nothing changes.
 */
export async function switchOrganization(
  userId: number,
  organizationId: number,
): Promise<User | null> {
  return privilegedDb.transaction(async (tx) => {
    const [membership] = await tx
      .select({
        organizationId: organizationMemberships.organizationId,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.organizationId, organizationId),
        ),
      );
    if (!membership) return null;
    return applyMembership(tx, userId, membership);
  });
}

/**
 * After a membership was removed from under the person's current organization: moves them to their
 * longest-standing remaining one. Null when none is left — then the account itself has been
 * removed, as it always was, and there is nothing to move.
 */
export async function moveToAnotherMembership(
  userId: number,
  leftOrganizationId: number,
): Promise<User | null> {
  return privilegedDb.transaction(async (tx) => {
    const [user] = await tx
      .select({ organizationId: users.organizationId })
      .from(users)
      .where(eq(users.id, userId));
    if (!user || user.organizationId !== leftOrganizationId) return null;
    const [next] = await tx
      .select({
        organizationId: organizationMemberships.organizationId,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          ne(organizationMemberships.organizationId, leftOrganizationId),
        ),
      )
      .orderBy(asc(organizationMemberships.createdAt), asc(organizationMemberships.id))
      .limit(1);
    if (!next) return null;
    return applyMembership(tx, userId, next);
  });
}

/**
 * Before an organization is erased: its members who also belong elsewhere move there, so the
 * erasure's deletion of the organization's accounts does not take them. Inside the erasure's own
 * transaction.
 */
export async function relocateMembersBeforeErasure(
  tx: PrivilegedTx,
  organizationId: number,
): Promise<number> {
  const members = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.organizationId, organizationId));
  let moved = 0;
  for (const member of members) {
    const [next] = await tx
      .select({
        organizationId: organizationMemberships.organizationId,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, member.id),
          ne(organizationMemberships.organizationId, organizationId),
        ),
      )
      .orderBy(asc(organizationMemberships.createdAt), asc(organizationMemberships.id))
      .limit(1);
    if (!next) continue;
    await applyMembership(tx, member.id, next);
    moved += 1;
  }
  return moved;
}

/**
 * Adds the person to an organization, on the privileged handle, before that organization is bound:
 * accepting an invitation as an existing account, or a single sign-on from a verified domain
 * (server/identity/sso.ts). False when they were a member already; the role is then left as it was.
 */
export async function joinOrganization(
  tx: PrivilegedTx,
  userId: number,
  organizationId: number,
  role: string,
): Promise<boolean> {
  // .returning() takes no column list: the transaction type is a union across the two drivers,
  // under which the builder's overloads collapse to the bare one (see organization.routes.ts).
  const inserted = await tx
    .insert(organizationMemberships)
    .values({ userId, organizationId, role })
    .onConflictDoNothing({
      target: [organizationMemberships.userId, organizationMemberships.organizationId],
    })
    .returning();
  return inserted.length > 0;
}

export type AcceptInvitationError = 'invalid' | 'expired' | 'used' | 'other_account' | 'member';

/**
 * An existing, signed-in account accepting an invitation: it joins the inviting organization with
 * the invitation's role and starts acting in it. The invitation names a username, which must be
 * this account's: a stranger with a colleague's link does not get their seat.
 *
 * Privileged, as registering with an invitation is (server/identity/storage.ts): the organization joined is
 * not the one the session is bound to. One transaction for the checks, the membership and the
 * accepted mark, so a link cannot be spent twice.
 */
export async function acceptInvitationAsMember(
  user: Pick<User, 'id' | 'username'>,
  token: string,
): Promise<User | { error: AcceptInvitationError }> {
  return privilegedDb.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.token, token))
      .limit(1);
    if (!invitation) return { error: 'invalid' as const };
    if (invitation.acceptedAt) return { error: 'used' as const };
    if (invitation.expiresAt.getTime() <= Date.now()) return { error: 'expired' as const };
    if (invitation.username !== user.username) return { error: 'other_account' as const };

    const joined = await joinOrganization(tx, user.id, invitation.organizationId, invitation.role);
    if (!joined) return { error: 'member' as const };

    await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, invitation.id));

    // Straight into the trail, as storage.createUserFromInvitation does: the organization comes
    // from the invitation row, not from a tenant context, which is bound to the other one.
    await tx.insert(auditLog).values({
      organizationId: invitation.organizationId,
      actorUserId: user.id,
      actorUsername: user.username,
      action: AUDIT_ACTIONS.INVITATION_ACCEPTED,
      targetType: 'invitation',
      targetId: String(invitation.id),
      metadata: {
        role: invitation.role,
        invitedByUserId: invitation.invitedByUserId,
        existingAccount: true,
      },
    });
    await tx.insert(auditLog).values({
      organizationId: invitation.organizationId,
      actorUserId: user.id,
      actorUsername: user.username,
      action: AUDIT_ACTIONS.MEMBER_JOINED,
      targetType: 'user',
      targetId: String(user.id),
      metadata: { username: user.username, role: invitation.role, byInvitation: invitation.id },
    });

    return applyMembership(tx, user.id, {
      organizationId: invitation.organizationId,
      role: invitation.role,
    });
  });
}

/** What a signed-in person sees before joining: whose invitation it is, and to what. */
export async function describeInvitation(
  user: Pick<User, 'id' | 'username'>,
  token: string,
): Promise<{ organizationName: string; role: string; username: string } | null> {
  const [row] = await privilegedDb
    .select({
      organizationName: organizations.name,
      role: invitations.role,
      username: invitations.username,
      acceptedAt: invitations.acceptedAt,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(eq(invitations.token, token))
    .limit(1);
  if (!row || row.acceptedAt || row.expiresAt.getTime() <= Date.now()) return null;
  // One answer for every way it is not theirs, as registration gives one for every bad token.
  if (row.username !== user.username) return null;
  return { organizationName: row.organizationName, role: row.role, username: row.username };
}

// ─── Inside an organization ─────────────────────────────────────────────────────

export interface MemberRow {
  id: number;
  username: string;
  role: string;
  kind: string;
  disabledAt: Date | null;
  createdAt: Date;
  /** Whether this organization is the one the member last switched to, where a sign-in starts. */
  current: boolean;
}

const memberColumns = {
  id: users.id,
  username: users.username,
  role: organizationMemberships.role,
  kind: users.kind,
  disabledAt: users.disabledAt,
  createdAt: users.createdAt,
  current: sql<boolean>`${users.organizationId} = ${organizationMemberships.organizationId}`,
};

/** The people of the organization, with the role each holds here. The policy scopes the rows. */
export async function listMembers(tx: TenantTx, organizationId: number): Promise<MemberRow[]> {
  return tx
    .select(memberColumns)
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(
      and(eq(organizationMemberships.organizationId, organizationId), eq(users.kind, 'person')),
    )
    .orderBy(asc(users.id));
}

/** One member of the organization, or undefined when the person is not one (or not a person). */
export async function memberOf(
  tx: TenantTx,
  organizationId: number,
  userId: number,
): Promise<MemberRow | undefined> {
  const [row] = await tx
    .select(memberColumns)
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(users.kind, 'person'),
      ),
    );
  return row;
}

/**
 * Owners of the organization other than `userId`. Counted inside the caller's transaction, so two
 * concurrent demotions cannot both see a second owner and both succeed.
 */
export async function otherOwnerCount(
  tx: TenantTx,
  organizationId: number,
  userId: number,
): Promise<number> {
  const [{ others }] = await tx
    .select({ others: sql<number>`count(*)::int` })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.role, 'owner'),
        ne(organizationMemberships.userId, userId),
        eq(users.kind, 'person'),
      ),
    );
  return others;
}

/** The longest-standing owner other than `userId`, who takes over what a removed owner made. */
export async function eldestOtherOwner(
  tx: TenantTx,
  organizationId: number,
  userId: number,
): Promise<{ id: number; username: string } | undefined> {
  const [row] = await tx
    .select({ id: users.id, username: users.username })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.role, 'owner'),
        eq(users.kind, 'person'),
        ne(users.id, userId),
      ),
    )
    .orderBy(asc(organizationMemberships.createdAt), asc(users.id))
    .limit(1);
  return row;
}

/**
 * Sets the role a member holds in the organization. The user row follows when this is the
 * organization they are acting in (the trigger would do the same; said here so it is read here),
 * and is left alone when it is not: their role elsewhere is elsewhere's business.
 */
export async function setMemberRole(
  tx: TenantTx,
  organizationId: number,
  userId: number,
  role: string,
): Promise<void> {
  await tx.execute(sql`
    UPDATE ${organizationMemberships} SET ${sql.identifier('role')} = ${role}
    WHERE ${organizationMemberships.userId} = ${userId}
      AND ${organizationMemberships.organizationId} = ${organizationId}
  `);
  await tx.execute(sql`
    UPDATE ${users} SET ${sql.identifier('role')} = ${role}
    WHERE ${users.id} = ${userId} AND ${users.organizationId} = ${organizationId}
  `);
}

/**
 * Takes a person out of the organization while their account lives on elsewhere: what is theirs
 * here (keys, project seats, reset links, dashboards) goes, as it would with the account; what
 * they made has already been handed on by the caller (transferMemberContent); the membership row
 * goes last. The caller moves their current organization afterwards, outside this transaction,
 * when this was it: the membership that remains is not visible from inside this one.
 */
export async function removeMembership(
  tx: TenantTx,
  organizationId: number,
  userId: number,
): Promise<void> {
  await removePersonalRowsInOrganization(tx, organizationId, userId);
  await tx.execute(sql`
    DELETE FROM ${organizationMemberships}
    WHERE ${organizationMemberships.userId} = ${userId}
      AND ${organizationMemberships.organizationId} = ${organizationId}
  `);
}
