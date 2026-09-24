import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { users, organizations, invitations, auditLog, passwordResets } from '@shared/schema';
import { storage } from './storage';

vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * Changing a password, and choosing a new one with a reset link.
 *
 * What matters: the current password is asked again; a new password ends every other session of
 * that person but not the one that changed it; a link works once, for a day, and tells nobody
 * which of those it failed on.
 */

let app: Express;

beforeAll(async () => {
  const { setupAuth } = await import('./auth');
  app = express();
  app.use(express.json());
  setupAuth(app);
});

beforeEach(async () => {
  await privilegedDb.delete(auditLog);
  await privilegedDb.delete(passwordResets);
  await privilegedDb.delete(invitations);
  await privilegedDb.delete(users);
  await privilegedDb.delete(organizations);
});

const credentials = { username: 'alice', password: 'first-password' };

async function signedIn() {
  const agent = request.agent(app);
  await agent.post('/api/login').send(credentials).expect(200);
  return agent;
}

describe('POST /api/user/password', () => {
  beforeEach(async () => {
    await request(app).post('/api/register').send(credentials).expect(201);
  });

  it('refuses without a session', async () => {
    await request(app).post('/api/user/password').send({ currentPassword: 'x', newPassword: 'second-password' }).expect(401);
  });

  it('refuses when the current password is wrong, and records the attempt', async () => {
    const agent = await signedIn();

    const res = await agent.post('/api/user/password').send({ currentPassword: 'not-it', newPassword: 'second-password' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('wrong_current_password');
    const entries = await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'auth.login_failed'));
    expect(entries).toHaveLength(1);
  });

  it('refuses a new password shorter than 8 characters', async () => {
    const agent = await signedIn();
    await agent.post('/api/user/password').send({ currentPassword: credentials.password, newPassword: 'short' }).expect(400);
  });

  it('changes it: the new one signs in, the old one no longer does', async () => {
    const agent = await signedIn();

    await agent.post('/api/user/password').send({ currentPassword: credentials.password, newPassword: 'second-password' }).expect(200);

    await request(app).post('/api/login').send(credentials).expect(401);
    await request(app).post('/api/login').send({ username: 'alice', password: 'second-password' }).expect(200);
    const entries = await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'auth.password_changed'));
    expect(entries).toHaveLength(1);
  });

  it('ends every other session of that person, and keeps the one that changed it', async () => {
    const changing = await signedIn();
    const elsewhere = await signedIn();
    await elsewhere.get('/api/user').expect(200);

    await changing.post('/api/user/password').send({ currentPassword: credentials.password, newPassword: 'second-password' }).expect(200);

    await changing.get('/api/user').expect(200);
    await elsewhere.get('/api/user').expect(401);
  });
});

describe('POST /api/password-reset', () => {
  beforeEach(async () => {
    await request(app).post('/api/register').send(credentials).expect(201);
  });

  it('sets a new password with a link, once', async () => {
    const issued = await storage.issuePasswordResetAsOperator('alice');

    await request(app).post('/api/password-reset').send({ token: issued!.token, newPassword: 'chosen-again' }).expect(200);
    await request(app).post('/api/login').send({ username: 'alice', password: 'chosen-again' }).expect(200);

    const again = await request(app).post('/api/password-reset').send({ token: issued!.token, newPassword: 'third-password' });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('reset_invalid');
  });

  it('ends the sessions opened with the old password', async () => {
    const agent = await signedIn();
    const issued = await storage.issuePasswordResetAsOperator('alice');

    await request(app).post('/api/password-reset').send({ token: issued!.token, newPassword: 'chosen-again' }).expect(200);

    await agent.get('/api/user').expect(401);
  });

  it('refuses an expired link, and an unknown one, with the same answer', async () => {
    const issued = await storage.issuePasswordResetAsOperator('alice');
    await privilegedDb.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) });

    const expired = await request(app).post('/api/password-reset').send({ token: issued!.token, newPassword: 'chosen-again' });
    const unknown = await request(app).post('/api/password-reset').send({ token: 'nothing-like-it', newPassword: 'chosen-again' });

    expect(expired.status).toBe(400);
    expect(unknown.body).toEqual(expired.body);
    await request(app).post('/api/login').send(credentials).expect(200);
  });

  it('replaces an earlier link when a new one is issued', async () => {
    const first = await storage.issuePasswordResetAsOperator('alice');
    const second = await storage.issuePasswordResetAsOperator('alice');

    await request(app).post('/api/password-reset').send({ token: first!.token, newPassword: 'chosen-again' }).expect(400);
    await request(app).post('/api/password-reset').send({ token: second!.token, newPassword: 'chosen-again' }).expect(200);
  });

  it('records who issued the link and who used it, never the token', async () => {
    const issued = await storage.issuePasswordResetAsOperator('alice');
    await request(app).post('/api/password-reset').send({ token: issued!.token, newPassword: 'chosen-again' }).expect(200);

    const entries = await privilegedDb.select().from(auditLog);
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('auth.password_reset_issued');
    expect(actions).toContain('auth.password_reset_completed');
    expect(JSON.stringify(entries)).not.toContain(issued!.token);
  });

  it('stores only a hash of the token', async () => {
    const issued = await storage.issuePasswordResetAsOperator('alice');
    const [row] = await privilegedDb.select().from(passwordResets);
    expect(row.tokenHash).not.toBe(issued!.token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sessions from before password stamps', () => {
  it('are not trusted: a bare user id in a session signs nobody in', async () => {
    // deserializeUser was registered on passport by setupAuth above; ask it directly.
    const passport = (await import('passport')).default;
    const [user] = await privilegedDb
      .insert(organizations)
      .values({ name: 'Legacy' })
      .returning()
      .then(([org]) => privilegedDb.insert(users).values({ username: 'legacy', password: 'x.y', organizationId: org.id }).returning());

    const result = await new Promise((resolve, reject) =>
      (passport as unknown as { deserializeUser: (id: unknown, done: (err: unknown, user?: unknown) => void) => void }).deserializeUser(
        user.id,
        (error, found) => (error ? reject(error) : resolve(found)),
      ),
    );
    expect(result).toBeFalsy();
  });
});
