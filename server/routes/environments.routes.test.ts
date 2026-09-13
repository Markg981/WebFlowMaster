import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { privilegedDb } from '../db';
import { environments, secrets } from '@shared/schema';
import { decryptSecret } from '../crypto';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * The environments and secrets API.
 *
 * The Settings screen has always called six endpoints — list, create and delete an
 * environment, list and create its secrets, delete a secret — and not one of them existed
 * anywhere in server/. The tables existed, the AES-256-GCM helpers existed, and
 * resolveVariables and loadLoginState read from them; there was simply no way to put
 * anything there through the application.
 *
 * So the whole feature was unreachable: the Settings card was a dead screen, every
 * `{{secret_…}}` fell back to the process defaults because no environment could exist, and
 * the saved-login work had nowhere to attach.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; organizationId: number; role: string };

beforeAll(async () => {
  organizationId = await createTestOrganization('Env Org');
  userId = await createTestUser(organizationId, 'env-user');
  otherOrganizationId = await createTestOrganization('Other Env Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-env-user');

  const { default: environmentRoutes } = await import('./environments.routes');
  const { runWithTenant } = await import('../middleware/tenancy');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(environmentRoutes);
});

beforeEach(async () => {
  await privilegedDb.delete(secrets);
  await privilegedDb.delete(environments);
  currentUser = { id: userId, organizationId, role: 'owner' };
});

describe('environments', () => {
  it('creates one and lists it back', async () => {
    const created = await request(app).post('/api/environments').send({ name: 'Acceptance' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Acceptance');

    const listed = await request(app).get('/api/environments');
    expect(listed.status).toBe(200);
    expect(listed.body.map((e: any) => e.name)).toEqual(['Acceptance']);
  });

  it('rejects an empty name rather than creating a nameless environment', async () => {
    const res = await request(app).post('/api/environments').send({ name: '  ' });
    expect(res.status).toBe(400);
  });

  it('deletes one, and its secrets with it', async () => {
    const created = await request(app).post('/api/environments').send({ name: 'Doomed' });
    await request(app)
      .post(`/api/environments/${created.body.id}/secrets`)
      .send({ keyName: 'token', value: 'abc' });

    const deleted = await request(app).delete(`/api/environments/${created.body.id}`);
    expect(deleted.status).toBe(204);

    expect((await privilegedDb.select().from(environments))).toHaveLength(0);
    // Orphaned secrets would be undeletable through the interface and still decryptable.
    expect((await privilegedDb.select().from(secrets))).toHaveLength(0);
  });

  it('does not list another organization environments', async () => {
    await request(app).post('/api/environments').send({ name: 'Ours' });

    currentUser = { id: otherUserId, organizationId: otherOrganizationId, role: 'owner' };
    const listed = await request(app).get('/api/environments');

    expect(listed.body).toEqual([]);
  });

  it('will not delete an environment belonging to another organization', async () => {
    const created = await request(app).post('/api/environments').send({ name: 'Ours' });

    currentUser = { id: otherUserId, organizationId: otherOrganizationId, role: 'owner' };
    const res = await request(app).delete(`/api/environments/${created.body.id}`);

    expect(res.status).toBe(404);
    expect((await privilegedDb.select().from(environments))).toHaveLength(1);
  });
});

describe('secrets', () => {
  let environmentId: number;

  beforeEach(async () => {
    const created = await request(app).post('/api/environments').send({ name: 'Acceptance' });
    environmentId = created.body.id;
  });

  it('stores a secret encrypted and never returns its value', async () => {
    const created = await request(app)
      .post(`/api/environments/${environmentId}/secrets`)
      .send({ keyName: 'secret_password', value: 'hunter2' });

    expect(created.status).toBe(201);
    // The response is rendered in a browser and logged by proxies. The whole point of
    // encrypting the column is lost if the value comes back out of the API.
    expect(JSON.stringify(created.body)).not.toContain('hunter2');

    const listed = await request(app).get(`/api/environments/${environmentId}/secrets`);
    expect(listed.status).toBe(200);
    expect(listed.body.map((s: any) => s.keyName)).toEqual(['secret_password']);
    expect(JSON.stringify(listed.body)).not.toContain('hunter2');

    // But it is genuinely recoverable by the runner, which is what it is for.
    const [row] = await privilegedDb.select().from(secrets);
    expect(row.encryptedValue).not.toContain('hunter2');
    expect(decryptSecret(row.encryptedValue, row.iv, row.authTag)).toBe('hunter2');
  });

  it('replaces a secret of the same name instead of storing two', async () => {
    await request(app)
      .post(`/api/environments/${environmentId}/secrets`)
      .send({ keyName: 'token', value: 'first' });
    await request(app)
      .post(`/api/environments/${environmentId}/secrets`)
      .send({ keyName: 'token', value: 'second' });

    const rows = await privilegedDb.select().from(secrets);
    // Two rows with one name means `{{token}}` resolves to whichever the query returns
    // first — a value that changes for no visible reason.
    expect(rows).toHaveLength(1);
    expect(decryptSecret(rows[0].encryptedValue, rows[0].iv, rows[0].authTag)).toBe('second');
  });

  it('deletes a secret', async () => {
    const created = await request(app)
      .post(`/api/environments/${environmentId}/secrets`)
      .send({ keyName: 'token', value: 'abc' });

    const res = await request(app).delete(`/api/secrets/${created.body.id}`);

    expect(res.status).toBe(204);
    expect((await privilegedDb.select().from(secrets))).toHaveLength(0);
  });

  it('refuses to write into another organization environment', async () => {
    currentUser = { id: otherUserId, organizationId: otherOrganizationId, role: 'owner' };

    const res = await request(app)
      .post(`/api/environments/${environmentId}/secrets`)
      .send({ keyName: 'token', value: 'stolen' });

    expect(res.status).toBe(404);
    expect((await privilegedDb.select().from(secrets))).toHaveLength(0);
  });

  it('rejects a name that could never be used as a variable', async () => {
    const res = await request(app)
      .post(`/api/environments/${environmentId}/secrets`)
      .send({ keyName: 'not a name', value: 'x' });

    // `{{not a name}}` does not match the substitution pattern, so the secret would be
    // stored, charged for, and silently unusable.
    expect(res.status).toBe(400);
  });
});

describe('who may change what', () => {
  it('lets a viewer read but not create', async () => {
    currentUser = { id: userId, organizationId, role: 'viewer' };

    expect((await request(app).get('/api/environments')).status).toBe(200);
    expect((await request(app).post('/api/environments').send({ name: 'Nope' })).status).toBe(403);
  });
});
