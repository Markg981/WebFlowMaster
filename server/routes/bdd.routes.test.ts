import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { privilegedDb } from '../db';
import { agents, bddExecutionProfiles } from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { runWithTenant, withTenantTransaction } from '../middleware/tenancy';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { resolveBddBinding } from '../bdd-profiles';
import { publish, publishedContentOf } from '../test-publishing';
import type { BddTest } from '@shared/bdd';

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
  ownerId = await createTestUser(org, `bdd-owner-${randomUUID()}`);
  const { default: routes } = await import('./bdd.routes');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = user;
    (req as any).isAuthenticated = () => true;
    runWithTenant(user.organizationId, next, { userId: user.id, role: user.role });
  });
  app.use(routes);
  const { default: testRoutes } = await import('./tests.routes');
  app.use(testRoutes);
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
  it.each([
    { pool: 'other', operatorProfileId: 'shop-js' },
    { pool: 'bdd', operatorProfileId: 'other-js' },
  ])('refuses target changes under an existing UUID: $pool/$operatorProfileId', async target => {
    const fields = { name: 'Pinned', pool: 'bdd', operatorProfileId: 'shop-js', revision: 'commit-abc' };
    const created = await request(app).post('/api/bdd/profiles').send(fields).expect(201);
    const bdd: BddTest = { source: 'Feature: Pinned\n  Scenario: Original\n    Given the original support', uri: 'pinned.feature', language: 'en', scenarioLine: 2, mode: 'cucumber', binding: { id: created.body.id, revision: fields.revision } };
    const saved = await request(app).post('/api/tests').send({ name: `Pinned ${target.pool}/${target.operatorProfileId}`, url: '', elements: [], sequence: [], bdd }).expect(201);
    await runWithTenant(org, () => withTenantTransaction(tx => publish(tx, saved.body.id, org, { id: ownerId, username: 'bdd-owner' })), { userId: ownerId, role: 'owner' });
    await privilegedDb.insert(agents).values({ id: randomUUID(), organizationId: org, name: 'Other support', pool: target.pool, tokenPrefix: 'wfa_', tokenHash: randomUUID(), bddProfiles: [{ ...advertised, id: target.operatorProfileId }] });

    const refused = await request(app).put(`/api/bdd/profiles/${created.body.id}`).send({ ...fields, ...target }).expect(400);
    expect(refused.body.error).toMatch(/new profile/i);
    await runWithTenant(org, () => withTenantTransaction(async tx => {
      const pinned = (await publishedContentOf(tx, [saved.body.id])).get(saved.body.id)!;
      expect(pinned.bdd).toEqual(bdd);
      expect(await resolveBddBinding(tx, pinned.bdd as BddTest, null)).toMatchObject({ pool: 'bdd', operatorProfileId: 'shop-js', revision: 'commit-abc' });
    }), { userId: ownerId, role: 'owner' });
    const replacement = await request(app).post('/api/bdd/profiles').send({ ...fields, ...target }).expect(201);
    expect(replacement.body.id).not.toBe(created.body.id);
  });
  it('invalidates a published old revision instead of redirecting its binding', async () => {
    const fields = { name: 'Revision', pool: 'bdd', operatorProfileId: 'shop-js', revision: 'commit-abc' };
    const created = await request(app).post('/api/bdd/profiles').send(fields).expect(201);
    const bdd: BddTest = { source: 'Feature: Revision\n  Scenario: Original\n    Given the original revision', uri: 'revision.feature', language: 'en', scenarioLine: 2, mode: 'cucumber', binding: { id: created.body.id, revision: 'commit-abc' } };
    const saved = await request(app).post('/api/tests').send({ name: 'Pinned revision', url: '', elements: [], sequence: [], bdd }).expect(201);
    await runWithTenant(org, () => withTenantTransaction(tx => publish(tx, saved.body.id, org, { id: ownerId, username: 'bdd-owner' })), { userId: ownerId, role: 'owner' });
    await privilegedDb.update(agents).set({ bddProfiles: [{ ...advertised, revision: 'commit-next' }] }).where(eq(agents.organizationId, org));
    await request(app).put(`/api/bdd/profiles/${created.body.id}`).send({ ...fields, revision: 'commit-next' }).expect(200);
    await runWithTenant(org, () => withTenantTransaction(async tx => {
      const pinned = (await publishedContentOf(tx, [saved.body.id])).get(saved.body.id)!;
      expect(pinned.bdd).toEqual(bdd);
      await expect(resolveBddBinding(tx, pinned.bdd as BddTest, null)).rejects.toThrow(/revision/i);
      expect(await resolveBddBinding(tx, { ...bdd, binding: { id: created.body.id, revision: 'commit-next' } }, null)).toMatchObject({ pool: 'bdd', operatorProfileId: 'shop-js', revision: 'commit-next' });
    }), { userId: ownerId, role: 'owner' });
  });
});
