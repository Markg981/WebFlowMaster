import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { privilegedDb } from '../db';
import { agents, bddExecutionProfiles } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { runWithTenant } from '../middleware/tenancy';
import { randomUUID } from 'crypto';

vi.mock('../logger', () => ({ default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }));
let app: express.Express;
let org: number;
let otherOrg: number;
let user: { id: number; organizationId: number; role: string };
let ownerId: number;
const advertised = { id: 'shop-js', label: 'Shop definitions', provider: 'cucumber-js', revision: 'commit-abc', maxDurationMs: 60000 };
beforeAll(async () => {
  org = await createTestOrganization('BDD source');
  otherOrg = await createTestOrganization('BDD other');
  ownerId = await createTestUser(org, 'bdd-owner');
  const { default: routes } = await import('./bdd.routes');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = user;
    (req as any).isAuthenticated = () => true;
    runWithTenant(user.organizationId, next, { userId: user.id, role: user.role });
  });
  app.use(routes);
});
beforeEach(async () => {
  await privilegedDb.delete(bddExecutionProfiles);
  await privilegedDb.delete(agents);
  user = { id: ownerId, organizationId: org, role: 'owner' };
  await privilegedDb.insert(agents).values({ id: randomUUID(), organizationId: org, name: 'BDD host', pool: 'bdd', tokenPrefix: 'wfa_test', tokenHash: randomUUID(), bddProfiles: [advertised] });
});
describe('organization-owned BDD execution profiles', () => {
  it('binds only advertised support revisions and does not expose operator paths or credentials', async () => {
    const available = await request(app).get('/api/bdd/profiles/available').expect(200);
    expect(available.body.profiles).toEqual([expect.objectContaining({ pool: 'bdd', ...advertised })]);
    const created = await request(app).post('/api/bdd/profiles').send({ name: 'Shop', pool: 'bdd', operatorProfileId: 'shop-js', revision: 'commit-abc', timeoutMs: 60000 }).expect(201);
    expect(created.body).toMatchObject({ name: 'Shop', organizationId: org, operatorProfileId: 'shop-js' });
    await request(app).post('/api/bdd/profiles').send({ name: 'Injected', pool: 'bdd', operatorProfileId: '../../arbitrary.js', revision: 'commit-abc' }).expect(400);
    await request(app).post('/api/bdd/profiles').send({ name: 'Changed', pool: 'bdd', operatorProfileId: 'shop-js', revision: 'different' }).expect(400);
    expect(JSON.stringify(available.body)).not.toContain('tokenHash');
  });
  it('isolates profiles across organizations and rejects writes from editors/viewers', async () => {
    const created = await request(app).post('/api/bdd/profiles').send({ name: 'Shop', pool: 'bdd', operatorProfileId: 'shop-js', revision: 'commit-abc' }).expect(201);
    user = { ...user, organizationId: otherOrg };
    expect((await request(app).get('/api/bdd/profiles').expect(200)).body.profiles).toEqual([]);
    expect((await request(app).get('/api/bdd/profiles/available').expect(200)).body.profiles).toEqual([]);
    await request(app).delete(`/api/bdd/profiles/${created.body.id}`).expect(404);
    user = { ...user, organizationId: org, role: 'editor' };
    await request(app).delete(`/api/bdd/profiles/${created.body.id}`).expect(403);
  });
  it('refuses a revoked host and a project outside this organization', async () => {
    await request(app).post('/api/bdd/profiles').send({ name: 'Wrong project', pool: 'bdd', operatorProfileId: 'shop-js', revision: 'commit-abc', projectId: 999999 }).expect(400);
    await privilegedDb.delete(agents);
    await request(app).post('/api/bdd/profiles').send({ name: 'Revoked', pool: 'bdd', operatorProfileId: 'shop-js', revision: 'commit-abc' }).expect(400);
  });
});
