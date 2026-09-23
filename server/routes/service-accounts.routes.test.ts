import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * Accounts that are not people, and the keys they hold.
 *
 * What these hold: only an owner makes one, or issues it a key; it can never be an owner or sign
 * in; it is not listed or managed as a member; and disabling it stops every key it holds.
 */

const { privilegedDb } = await import('../db');
const { apiKeys, auditLog, users } = await import('@shared/schema');
const { createTestOrganization, createTestUser } = await import('../tests/factories');
const { runWithTenant } = await import('../middleware/tenancy');
const { storage } = await import('../storage');
const { default: serviceAccountsRoutes } = await import('./service-accounts.routes');
const { default: apiKeysRoutes } = await import('./api-keys.routes');
const { default: organizationRoutes } = await import('./organization.routes');

let app: express.Express;
let org: number;
let owner: number;
let otherOrg: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };

beforeAll(async () => {
  org = await createTestOrganization('Machines Org');
  owner = await createTestUser(org, `sa-owner-${Date.now()}`);
  await privilegedDb.update(users).set({ role: 'owner' }).where(eq(users.id, owner));
  otherOrg = await createTestOrganization('Other Machines Org');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(serviceAccountsRoutes);
  app.use(apiKeysRoutes);
  app.use(organizationRoutes);
});

beforeEach(async () => {
  await privilegedDb.delete(apiKeys);
  await privilegedDb.delete(auditLog);
  await privilegedDb.delete(users).where(eq(users.kind, 'service'));
  currentUser = { id: owner, username: 'sa-owner', organizationId: org, role: 'owner' };
});

const create = (body: Record<string, unknown>) => request(app).post('/api/service-accounts').send(body);

describe('creating a service account', () => {
  it('makes an account of this organization that cannot sign in, and records it', async () => {
    const created = await create({ name: 'GitHub Actions', role: 'editor' }).expect(201);

    expect(created.body).toMatchObject({ name: 'GitHub Actions', role: 'editor', disabledAt: null });
    const [row] = await privilegedDb.select().from(users).where(eq(users.id, created.body.id));
    expect(row).toMatchObject({ kind: 'service', organizationId: org, displayName: 'GitHub Actions' });

    const [entry] = await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'service_account.created'));
    expect(entry).toMatchObject({ organizationId: org, actorUserId: owner, targetId: String(created.body.id) });
  });

  it('is never an owner, by the request or by the database', async () => {
    await create({ name: 'Root', role: 'owner' }).expect(400);

    const account = await storage.createServiceAccount({ organizationId: org, displayName: 'Bot', role: 'editor', actor: { id: owner, username: 'x' } });
    await expect(privilegedDb.update(users).set({ role: 'owner' }).where(eq(users.id, account.id))).rejects.toThrow();
  });

  it('is for owners only', async () => {
    currentUser = { ...currentUser, role: 'editor' };
    await create({ name: 'Sneaky', role: 'editor' }).expect(403);
    await request(app).get('/api/service-accounts').expect(403);
  });

  it('is not a member: not listed as one, and its role not changed as one', async () => {
    const created = await create({ name: 'Nightly', role: 'viewer' }).expect(201);

    const organization = await request(app).get('/api/organization').expect(200);
    expect(organization.body.members.map((m: { id: number }) => m.id)).not.toContain(created.body.id);

    await request(app).patch(`/api/organization/members/${created.body.id}`).send({ role: 'owner' }).expect(404);
    await request(app).post('/api/organization/members').send({ userId: created.body.id, role: 'owner' }).expect(404);
    await request(app).delete(`/api/organization/members/${created.body.id}`).expect(404);

    const listed = await request(app).get('/api/service-accounts').expect(200);
    expect(listed.body.map((a: { id: number }) => a.id)).toEqual([created.body.id]);
  });
});

describe('its keys', () => {
  it('an owner issues one, and it acts as the account', async () => {
    const account = await create({ name: 'CI', role: 'editor' }).expect(201);

    const key = await request(app)
      .post('/api/api-keys')
      .send({ name: 'ci', serviceAccountId: account.body.id, scopes: ['runs:write'] })
      .expect(201);

    const [row] = await privilegedDb.select().from(apiKeys).where(eq(apiKeys.id, key.body.id));
    expect(row).toMatchObject({ userId: account.body.id, scopes: ['runs:write'] });

    const listing = await request(app).get('/api/api-keys').expect(200);
    expect(listing.body[0].holder).toMatchObject({ kind: 'service', displayName: 'CI' });
  });

  it('an editor cannot issue one to a service account', async () => {
    const account = await create({ name: 'CI', role: 'editor' }).expect(201);
    currentUser = { ...currentUser, role: 'editor' };

    await request(app).post('/api/api-keys').send({ name: 'ci', serviceAccountId: account.body.id }).expect(403);
  });

  it("nor can anyone issue one to a person, or to another organization's account", async () => {
    const person = await createTestUser(org, `sa-person-${Date.now()}`);
    await request(app).post('/api/api-keys').send({ name: 'x', serviceAccountId: person }).expect(404);

    const theirs = await storage.createServiceAccount({ organizationId: otherOrg, displayName: 'Theirs', role: 'editor', actor: { id: owner, username: 'x' } });
    await request(app).post('/api/api-keys').send({ name: 'x', serviceAccountId: theirs.id }).expect(404);
  });

  it('refuses a scope that does not exist', async () => {
    await request(app).post('/api/api-keys').send({ name: 'x', scopes: ['tests:delete'] }).expect(400);
  });
});

describe('disabling a service account', () => {
  it('revokes every key it holds, keeps the row, and cannot be done twice', async () => {
    const account = await create({ name: 'Retired', role: 'editor' }).expect(201);
    await request(app).post('/api/api-keys').send({ name: 'a', serviceAccountId: account.body.id }).expect(201);
    await request(app).post('/api/api-keys').send({ name: 'b', serviceAccountId: account.body.id }).expect(201);

    const disabled = await request(app).delete(`/api/service-accounts/${account.body.id}`).expect(200);
    expect(disabled.body.revokedKeys).toBe(2);

    const live = await privilegedDb.select().from(apiKeys).where(and(eq(apiKeys.userId, account.body.id)));
    expect(live.every((k) => k.revokedAt !== null)).toBe(true);
    const [row] = await privilegedDb.select().from(users).where(eq(users.id, account.body.id));
    expect(row.disabledAt).not.toBeNull();

    await request(app).delete(`/api/service-accounts/${account.body.id}`).expect(404);
    await request(app).post('/api/api-keys').send({ name: 'c', serviceAccountId: account.body.id }).expect(404);
  });
});
