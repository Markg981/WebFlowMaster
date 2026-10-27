import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import { users, organizations, invitations, auditLog, passwordResets } from '@shared/schema';
import { storage } from './storage';
import { hashInvitationToken } from '../platform/invitation-token';
import { runWithTenant, withTenantTransaction } from '../platform/middleware/tenancy';
import { issuePasswordReset, issueSelfServiceReset } from './password-reset';

vi.mock('../platform/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), http: vi.fn(), debug: vi.fn() },
  updateLogLevel: vi.fn(),
}));

const scryptCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  const counted = ((...args: unknown[]) => {
    scryptCalls.count += 1;
    return (actual.scrypt as any)(...args);
  }) as typeof actual.scrypt;
  return { ...actual, default: { ...actual, scrypt: counted }, scrypt: counted };
});

/** Audit A-12: the authentication minors. */

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

async function seedInviter() {
  const [org] = await privilegedDb
    .insert(organizations)
    .values({ name: 'Acme' } as any)
    .returning();
  const [inviter] = await privilegedDb
    .insert(users)
    .values({ username: 'owner', password: 'x', organizationId: org.id, role: 'owner' } as any)
    .returning();
  return { org, inviter };
}

describe('login for an unknown user', () => {
  it('still runs scrypt, so the response time does not reveal whether the user exists', async () => {
    await request(app)
      .post('/api/register')
      .send({ username: 'alice', password: 'first-password' })
      .expect(201);

    scryptCalls.count = 0;
    await request(app)
      .post('/api/login')
      .send({ username: 'nobody', password: 'whatever-pass' })
      .expect(401);
    const unknown = scryptCalls.count;

    scryptCalls.count = 0;
    await request(app)
      .post('/api/login')
      .send({ username: 'alice', password: 'wrong-password' })
      .expect(401);
    expect(unknown).toBeGreaterThan(0);
    expect(unknown).toBe(scryptCalls.count);
  });
});

describe('POST /api/password-reset policy', () => {
  it('refuses a password equal to the username, and leaves the link usable', async () => {
    await request(app)
      .post('/api/register')
      .send({ username: 'alice-the-user', password: 'first-password' })
      .expect(201);
    const issued = await storage.issuePasswordResetAsOperator('alice-the-user');

    const weak = await request(app)
      .post('/api/password-reset')
      .send({ token: issued!.token, newPassword: 'alice-the-user' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('weak_password');
    await request(app)
      .post('/api/login')
      .send({ username: 'alice-the-user', password: 'first-password' })
      .expect(200);

    await request(app)
      .post('/api/password-reset')
      .send({ token: issued!.token, newPassword: 'a-better-password' })
      .expect(200);
  });
});

describe('self-service reset requests', () => {
  it('add links instead of cancelling the pending one, up to a small cap', async () => {
    await request(app)
      .post('/api/register')
      .send({ username: 'bob', password: 'first-password' })
      .expect(201);
    const [bob] = await privilegedDb.select().from(users).where(eq(users.username, 'bob'));
    const input = { organizationId: bob.organizationId!, userId: bob.id, createdBy: null };
    const run = <T>(fn: (tx: any) => Promise<T>) =>
      runWithTenant(bob.organizationId!, () => withTenantTransaction(fn));

    const owner = await run((tx) => issuePasswordReset(tx, { ...input, createdBy: bob.id }));
    expect(await run((tx) => issueSelfServiceReset(tx, input))).toBeTruthy();
    expect(await run((tx) => issueSelfServiceReset(tx, input))).toBeTruthy();
    // The cap: three valid links at once (the owner's counts), then nothing more is added.
    expect(await run((tx) => issueSelfServiceReset(tx, input))).toBeNull();

    // Nothing was cancelled by asking again: the owner's link still works.
    await request(app)
      .post('/api/password-reset')
      .send({ token: owner.token, newPassword: 'chosen-again' })
      .expect(200);
  });
});

describe('invitation tokens at rest', () => {
  it('are stored as a SHA-256 and still redeemed with the token', async () => {
    const { org, inviter } = await seedInviter();
    const token = 'f'.repeat(64);
    await privilegedDb.insert(invitations).values({
      organizationId: org.id,
      username: 'invitee',
      role: 'editor',
      token: hashInvitationToken(token),
      invitedByUserId: inviter.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [row] = await privilegedDb.select().from(invitations);
    expect(row.token).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token).not.toBe(token);

    // The stored hash is not a credential.
    await request(app)
      .post('/api/register')
      .send({ username: 'invitee', password: 'password123', invitationToken: row.token })
      .expect(400);
    await request(app)
      .post('/api/register')
      .send({ username: 'invitee', password: 'password123', invitationToken: token })
      .expect(201);
  });

  it('migration 0098 hashes existing clear tokens in place', async () => {
    const { org, inviter } = await seedInviter();
    const clear = 'a1'.repeat(32);
    await privilegedDb.insert(invitations).values({
      organizationId: org.id,
      username: 'pending',
      role: 'editor',
      token: clear,
      invitedByUserId: inviter.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const statement = readFileSync('migrations/0098_invitation_token_hash.sql', 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n');
    await privilegedDb.execute(sql.raw(statement));
    const [row] = await privilegedDb.select().from(invitations);
    expect(row.token).toBe(hashInvitationToken(clear));
  });
});
