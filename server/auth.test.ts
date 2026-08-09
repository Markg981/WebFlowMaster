import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { privilegedDb } from './db';
import { users, organizations, invitations, auditLog } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { storage } from './storage';

// Only the logger is mocked; auth runs against the real (PGlite) test database
// with an in-memory session store (NODE_ENV=test).
vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

let app: Express;

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  const { setupAuth } = await import('./auth');
  app = express();
  app.use(express.json());
  setupAuth(app);
});

beforeEach(async () => {
  // FK order. audit_log first: accepting an invitation writes an entry, and audit_log
  // references organizations with no cascade, so leaving one behind blocks the organizations
  // delete on the *next* run of this hook — which surfaces as unrelated tests failing.
  await privilegedDb.delete(auditLog);
  await privilegedDb.delete(invitations);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
});

const validCreds = { username: 'alice', password: 'password123' };

describe('POST /api/register', () => {
  it('creates a user and returns 201 without exposing the password hash', async () => {
    const res = await request(app).post('/api/register').send(validCreds).expect(201);
    expect(res.body.username).toBe('alice');
    expect(res.body.password).toBeUndefined();

    const rows = await privilegedDb.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].password).not.toBe('password123'); // stored hashed
  });

  it('rejects a too-short password with 400', async () => {
    await request(app).post('/api/register').send({ username: 'bob', password: 'short' }).expect(400);
  });

  it('rejects a too-short username with 400', async () => {
    await request(app).post('/api/register').send({ username: 'ab', password: 'password123' }).expect(400);
  });

  it('rejects a duplicate username with 400', async () => {
    await request(app).post('/api/register').send(validCreds).expect(201);
    await request(app).post('/api/register').send(validCreds).expect(400);
  });

  it('gives a newly registered user their own organization, as its owner', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ username: `fresh-${Date.now()}`, password: 'correct horse battery staple' });

    expect(res.status).toBe(201);
    expect(res.body.organizationId).toEqual(expect.any(Number));
    expect(res.body.role).toBe('owner');
  });
});

describe('POST /api/register with an invitation', () => {
  const token = 'a'.repeat(64);

  /** An open invitation from a pre-existing organization, with the given overrides. */
  async function seedInvitation(overrides: { token?: string; expiresAt?: Date; role?: string } = {}) {
    const [organization] = await privilegedDb.insert(organizations).values({ name: 'Inviting Org' }).returning();
    const [inviter] = await privilegedDb
      .insert(users)
      .values({ username: 'inviter', password: 'x', organizationId: organization.id, role: 'owner' })
      .returning();
    const [invitation] = await privilegedDb
      .insert(invitations)
      .values({
        organizationId: organization.id,
        username: 'invitee',
        role: overrides.role ?? 'editor',
        token: overrides.token ?? token,
        invitedByUserId: inviter.id,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
      })
      .returning();
    return { organization, inviter, invitation };
  }

  const register = (body: Record<string, unknown>) => request(app).post('/api/register').send(body);

  it('puts the new account in the inviting organization instead of a fresh one', async () => {
    const { organization } = await seedInvitation();

    const res = await register({ username: 'invitee', password: 'password123', invitationToken: token });

    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(organization.id);
    expect(res.body.role).toBe('editor');

    // The distinguishing assertion: no second organization was created. Without the token
    // this same call would have made one.
    const orgs = await privilegedDb.select().from(organizations);
    expect(orgs).toHaveLength(1);
  });

  it('marks the invitation used, so the same token cannot be redeemed twice', async () => {
    await seedInvitation();
    await register({ username: 'invitee', password: 'password123', invitationToken: token }).expect(201);

    // Second attempt fails on the username, so delete the account to isolate the token check.
    await privilegedDb.delete(users).where(eq(users.username, 'invitee'));

    const second = await register({ username: 'invitee', password: 'password123', invitationToken: token });
    expect(second.status).toBe(400);
  });

  it('refuses an expired invitation', async () => {
    await seedInvitation({ expiresAt: new Date(Date.now() - 1000) });
    const res = await register({ username: 'invitee', password: 'password123', invitationToken: token });
    expect(res.status).toBe(400);
    expect(await privilegedDb.select().from(users).where(eq(users.username, 'invitee'))).toHaveLength(0);
  });

  it('refuses a token that does not exist', async () => {
    await seedInvitation();
    const res = await register({ username: 'invitee', password: 'password123', invitationToken: 'b'.repeat(64) });
    expect(res.status).toBe(400);
  });

  it('refuses to let a different username spend the invitation', async () => {
    // Otherwise a leaked token is an account in someone else's organization for whoever
    // finds it, under any name they like.
    await seedInvitation();
    const res = await register({ username: 'gatecrasher', password: 'password123', invitationToken: token });

    expect(res.status).toBe(400);
    expect(await privilegedDb.select().from(users).where(eq(users.username, 'gatecrasher'))).toHaveLength(0);
  });
});

describe('POST /api/login', () => {
  it('rejects wrong credentials with 401', async () => {
    await request(app).post('/api/register').send(validCreds).expect(201);
    await request(app).post('/api/login').send({ username: 'alice', password: 'wrong' }).expect(401);
  });

  it('accepts correct credentials and returns the user without the password', async () => {
    await request(app).post('/api/register').send(validCreds).expect(201);
    const agent = request.agent(app);
    const res = await agent.post('/api/login').send(validCreds).expect(200);
    expect(res.body.username).toBe('alice');
    expect(res.body.password).toBeUndefined();
  });
});

describe('GET /api/user', () => {
  it('returns 401 when not authenticated', async () => {
    await request(app).get('/api/user').expect(401);
  });

  it('returns the current user (no password) once logged in', async () => {
    const agent = request.agent(app);
    await agent.post('/api/register').send(validCreds).expect(201); // register also logs in
    const res = await agent.get('/api/user').expect(200);
    expect(res.body.username).toBe('alice');
    expect(res.body.password).toBeUndefined();
  });
});

describe('session user shape', () => {
  // storage.getUser backs passport's deserializeUser, so whatever it returns is exactly what
  // tenancyMiddleware and requireRole read off req.user on every request. Creating a user here
  // (rather than assuming a fixed id) keeps this independent of how many rows earlier tests in
  // the shared test database left behind.
  it('carries organizationId and role on the session user', async () => {
    const created = await storage.createUser({ username: 'shape-check', password: 'password123' });
    const user = await storage.getUser(created.id);
    expect(user).toBeDefined();
    expect(typeof user!.organizationId).toBe('number');
    expect(['viewer', 'editor', 'owner']).toContain(user!.role);
  });
});
