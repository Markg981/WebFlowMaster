import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { eq, sql } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import {
  auditLog,
  invitations,
  organizationMemberships,
  organizations,
  projects,
  users,
} from '@shared/schema';
import { runWithTenant, withTenantTransaction } from '../platform/middleware/tenancy';
import {
  joinOrganization,
  membershipsOf,
  switchOrganization,
} from '../tenancy/organization-memberships';
import organizationRoutes from '../http/routes/organization.routes';

/**
 * A person in several organizations (migration 0086).
 *
 * users.organization_id stays the organization a session acts in, so every policy keeps working;
 * organization_memberships is where else the person may act. These prove the two stay in step,
 * that a switch moves what a request can see — and nothing else — and that joining, leaving and
 * the last-owner rule follow memberships rather than the user row.
 */

vi.mock('../platform/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    http: vi.fn(),
    debug: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));

let app: Express;

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  const { setupAuth } = await import('../identity/auth');
  const { tenancyMiddleware } = await import('../platform/middleware/tenancy');
  const membershipRoutes = (await import('../http/routes/organization-memberships.routes')).default;
  app = express();
  app.use(express.json());
  setupAuth(app);
  app.use(tenancyMiddleware);
  app.use(membershipRoutes);
  // What the session sees: the projects of the organization it is bound to, through RLS.
  app.get('/api/probe', async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const names = await withTenantTransaction(async (tx) =>
      (await tx.select({ name: projects.name }).from(projects)).map((p) => p.name),
    );
    res.json({ organizationId: req.user!.organizationId, role: req.user!.role, names });
  });
});

beforeEach(async () => {
  await privilegedDb.delete(auditLog);
  await privilegedDb.delete(projects);
  await privilegedDb.delete(invitations);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
});

const membershipRows = (userId: number) =>
  privilegedDb
    .select({
      organizationId: organizationMemberships.organizationId,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, userId))
    .orderBy(organizationMemberships.id);

async function organization(name: string) {
  const [row] = await privilegedDb.insert(organizations).values({ name }).returning();
  return row.id;
}

/** A signed-in browser whose account owns a fresh organization. */
async function signedIn(username: string) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/register')
    .send({ username, password: 'password123' })
    .expect(201);
  return { agent, id: res.body.id as number, organizationId: res.body.organizationId as number };
}

describe('the user row and its memberships', () => {
  it('gives a user row exactly one membership, with its role, as the migration backfilled', async () => {
    const orgId = await organization('Acme');
    const [user] = await privilegedDb
      .insert(users)
      .values({ username: 'maria', password: 'x', organizationId: orgId, role: 'viewer' })
      .returning();

    expect(await membershipRows(user.id)).toEqual([{ organizationId: orgId, role: 'viewer' }]);

    // A role change on the row — the paths that predate the table — follows into the membership.
    await privilegedDb.update(users).set({ role: 'owner' }).where(eq(users.id, user.id));
    expect(await membershipRows(user.id)).toEqual([{ organizationId: orgId, role: 'owner' }]);
  });

  it('shows an organization its own members only, and never the memberships elsewhere', async () => {
    const orgA = await organization('A');
    const orgB = await organization('B');
    const [user] = await privilegedDb
      .insert(users)
      .values({ username: 'both', password: 'x', organizationId: orgA, role: 'editor' })
      .returning();
    await privilegedDb.transaction((tx) => joinOrganization(tx, user.id, orgB, 'viewer'));

    const seenFromA = await runWithTenant(orgA, () =>
      withTenantTransaction((tx) => tx.select().from(organizationMemberships)),
    );
    expect(seenFromA.map((m) => m.organizationId)).toEqual([orgA]);

    // Nor can an organization plant a membership in another one.
    await expect(
      runWithTenant(orgA, () =>
        withTenantTransaction((tx) =>
          tx.execute(
            sql`INSERT INTO organization_memberships (user_id, organization_id, role) VALUES (${user.id}, ${orgB}, 'owner')`,
          ),
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('switching', () => {
  it('moves what the session sees from one organization to the other, and refuses one it is not in', async () => {
    const alice = await signedIn('alice');
    const orgB = await organization('B');
    const orgC = await organization('C');
    await privilegedDb.transaction((tx) => joinOrganization(tx, alice.id, orgB, 'viewer'));
    await privilegedDb.insert(projects).values([
      { name: 'a-project', userId: alice.id, organizationId: alice.organizationId },
      { name: 'b-project', userId: alice.id, organizationId: orgB },
    ]);

    const me = await alice.agent.get('/api/user').expect(200);
    expect(me.body.organizations).toEqual([
      { id: alice.organizationId, name: "alice's organization", role: 'owner', current: true },
      { id: orgB, name: 'B', role: 'viewer', current: false },
    ]);
    expect((await alice.agent.get('/api/probe').expect(200)).body).toMatchObject({
      organizationId: alice.organizationId,
      role: 'owner',
      names: ['a-project'],
    });

    const switched = await alice.agent
      .post('/api/organizations/switch')
      .send({ organizationId: orgB })
      .expect(200);
    expect(switched.body).toMatchObject({ organizationId: orgB, role: 'viewer' });
    expect(switched.body.organizations.find((o: { id: number }) => o.id === orgB).current).toBe(
      true,
    );
    expect((await alice.agent.get('/api/probe').expect(200)).body).toMatchObject({
      organizationId: orgB,
      role: 'viewer',
      names: ['b-project'],
    });
    const trail = await privilegedDb
      .select({ action: auditLog.action, organizationId: auditLog.organizationId })
      .from(auditLog)
      .where(eq(auditLog.action, 'organization.switched'));
    expect(trail).toEqual([{ action: 'organization.switched', organizationId: orgB }]);

    // Not a member of C: nothing changes.
    await alice.agent.post('/api/organizations/switch').send({ organizationId: orgC }).expect(403);
    expect((await alice.agent.get('/api/probe').expect(200)).body.names).toEqual(['b-project']);
    expect(await switchOrganization(alice.id, orgC)).toBeNull();
  });
});

describe('joining by invitation as an existing account', () => {
  it('adds the organization to the account and starts acting in it, once', async () => {
    const alice = await signedIn('alice');
    const orgB = await organization('B');
    const token = 'd'.repeat(64);
    await privilegedDb.insert(invitations).values({
      organizationId: orgB,
      username: 'alice',
      role: 'editor',
      token,
      invitedByUserId: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const preview = await alice.agent.get('/api/invitations/preview').query({ token }).expect(200);
    expect(preview.body).toEqual({ organizationName: 'B', role: 'editor', username: 'alice' });

    const joined = await alice.agent.post('/api/invitations/accept').send({ token }).expect(200);
    expect(joined.body).toMatchObject({ organizationId: orgB, role: 'editor' });
    expect(await membershipRows(alice.id)).toEqual([
      { organizationId: alice.organizationId, role: 'owner' },
      { organizationId: orgB, role: 'editor' },
    ]);
    const [invitation] = await privilegedDb.select().from(invitations);
    expect(invitation.acceptedAt).not.toBeNull();
    const actions = (await privilegedDb.select().from(auditLog))
      .filter((e) => e.organizationId === orgB)
      .map((e) => e.action)
      .sort();
    expect(actions).toEqual(['invitation.accepted', 'member.joined', 'organization.switched']);

    // Spent.
    await alice.agent.post('/api/invitations/accept').send({ token }).expect(400);
  });

  it("refuses an invitation for somebody else's username", async () => {
    const alice = await signedIn('alice');
    const orgB = await organization('B');
    const token = 'e'.repeat(64);
    await privilegedDb.insert(invitations).values({
      organizationId: orgB,
      username: 'bob',
      role: 'editor',
      token,
      invitedByUserId: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await alice.agent.get('/api/invitations/preview').query({ token }).expect(404);
    await alice.agent.post('/api/invitations/accept').send({ token }).expect(403);
    expect(await membershipRows(alice.id)).toHaveLength(1);
  });
});

describe('members, by membership', () => {
  // The organization routes as an owner of org A, outside the session machinery.
  let orgA: number;
  let orgB: number;
  let founder: number;
  let bob: number;
  let currentUser: { id: number; role: string; organizationId: number };
  const orgApp = express();
  orgApp.use(express.json());
  orgApp.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: unknown }).user = currentUser;
    req.isAuthenticated = (() => true) as never;
    runWithTenant(currentUser.organizationId, async () => next());
  });
  orgApp.use(organizationRoutes);

  beforeEach(async () => {
    orgA = await organization('A');
    orgB = await organization('B');
    const rows = await privilegedDb
      .insert(users)
      .values([
        { username: 'founder', password: 'x', organizationId: orgA, role: 'owner' },
        // Bob acts in B and is an owner of A as well.
        { username: 'bob', password: 'x', organizationId: orgB, role: 'editor' },
      ])
      .returning();
    founder = rows[0].id;
    bob = rows[1].id;
    await privilegedDb.transaction((tx) => joinOrganization(tx, bob, orgA, 'owner'));
    currentUser = { id: founder, role: 'owner', organizationId: orgA };
  });

  it('lists members by their membership here, with the role they hold here', async () => {
    const res = await request(orgApp).get('/api/organization').expect(200);
    expect(res.body.members).toEqual([
      expect.objectContaining({ id: founder, username: 'founder', role: 'owner', current: true }),
      expect.objectContaining({ id: bob, username: 'bob', role: 'owner', current: false }),
    ]);
  });

  it('counts owners by membership for the last-owner rule, and changes the role held here only', async () => {
    // Bob is the other owner of A, so the founder may step down...
    await request(orgApp)
      .patch(`/api/organization/members/${founder}`)
      .send({ role: 'editor' })
      .expect(200);
    // ...after which Bob is the last one.
    await request(orgApp)
      .patch(`/api/organization/members/${bob}`)
      .send({ role: 'viewer' })
      .expect(409);
    await request(orgApp).delete(`/api/organization/members/${bob}`).expect(409);

    // The founder's row followed (A is where they act); Bob's did not (he acts in B).
    const [founderRow] = await privilegedDb.select().from(users).where(eq(users.id, founder));
    expect(founderRow.role).toBe('editor');
    const [bobRow] = await privilegedDb.select().from(users).where(eq(users.id, bob));
    expect(bobRow).toMatchObject({ organizationId: orgB, role: 'editor' });
    expect(await membershipRows(bob)).toEqual([
      { organizationId: orgB, role: 'editor' },
      { organizationId: orgA, role: 'owner' },
    ]);
  });

  it('removing a member of several organizations takes this one away and moves them when it was current', async () => {
    // Carol acts in A and also belongs to B.
    const [carol] = await privilegedDb
      .insert(users)
      .values({ username: 'carol', password: 'x', organizationId: orgA, role: 'editor' })
      .returning();
    await privilegedDb.transaction((tx) => joinOrganization(tx, carol.id, orgB, 'viewer'));
    await privilegedDb
      .insert(projects)
      .values({ name: 'carols', userId: carol.id, organizationId: orgA });

    const res = await request(orgApp).delete(`/api/organization/members/${carol.id}`).expect(200);
    expect(res.body).toMatchObject({
      removed: carol.id,
      accountDeleted: false,
      transferredTo: { id: founder },
    });

    const [after] = await privilegedDb.select().from(users).where(eq(users.id, carol.id));
    expect(after).toMatchObject({ organizationId: orgB, role: 'viewer' });
    expect(await membershipRows(carol.id)).toEqual([{ organizationId: orgB, role: 'viewer' }]);
    const [project] = await privilegedDb.select().from(projects);
    expect(project.userId).toBe(founder);
    expect(await membershipsOf(after)).toEqual([
      { id: orgB, name: 'B', role: 'viewer', current: true },
    ]);
  });

  it('removing a member of this organization only deletes the account, as before', async () => {
    const [dan] = await privilegedDb
      .insert(users)
      .values({ username: 'dan', password: 'x', organizationId: orgA, role: 'viewer' })
      .returning();
    const res = await request(orgApp).delete(`/api/organization/members/${dan.id}`).expect(200);
    expect(res.body.accountDeleted).toBe(true);
    expect(await privilegedDb.select().from(users).where(eq(users.id, dan.id))).toHaveLength(0);
  });

  it('invites an existing account of another organization, but not a member already', async () => {
    await privilegedDb
      .insert(users)
      .values({ username: 'erin', password: 'x', organizationId: orgB, role: 'editor' });
    const invited = await request(orgApp)
      .post('/api/organization/invitations')
      .send({ username: 'erin', role: 'viewer' })
      .expect(201);
    expect(invited.body).toMatchObject({ username: 'erin', role: 'viewer', existingAccount: true });

    const refused = await request(orgApp)
      .post('/api/organization/invitations')
      .send({ username: 'bob', role: 'viewer' })
      .expect(409);
    expect(refused.body.error).toMatch(/already a member/);
  });
});
