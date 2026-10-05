import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { tenancyMiddleware } from '../middleware/tenancy';

let org: number;
let target: number;
let user: { id: number; username: string; role: string; kind: string; organizationId: number };
let app: express.Express;
beforeEach(async () => {
  org = await createTestOrganization('Operator'); target = await createTestOrganization('Customer');
  user = { id: await createTestUser(org), username: 'quota-admin', role: 'owner', kind: 'person', organizationId: org };
  vi.stubEnv('INSTALLATION_ADMINS', 'quota-admin');
  const routes = (await import('./tenant-quota-admin.routes')).default;
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = user as Express.User; req.isAuthenticated = (() => true) as never; next(); });
  app.use(tenancyMiddleware); app.use(routes);
});
afterEach(() => vi.unstubAllEnvs());

describe('installation quota administration', () => {
  it('refuses ordinary tenant owners and service accounts', async () => {
    user.username = 'tenant-owner';
    expect((await request(app).get('/api/admin/organization-quotas')).status).toBe(403);
    user.username = 'quota-admin'; user.kind = 'service';
    expect((await request(app).patch(`/api/admin/organization-quotas/${target}`).send({ revision: 1, overrides: { maxTests: 4 } })).status).toBe(403);
  });
  it('lets a named human administrator change quotas with atomic audit and optimistic revision', async () => {
    const result = await request(app).patch(`/api/admin/organization-quotas/${target}`).send({ revision: 1, overrides: { maxTests: 4, mode: 'monitor' } });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ organizationId: target, revision: 2, quotas: { mode: 'monitor', maxTests: 4 } });
    expect((await request(app).patch(`/api/admin/organization-quotas/${target}`).send({ revision: 1, overrides: { maxTests: 9 } })).status).toBe(409);
    const logs = await privilegedDb.execute(sql`SELECT metadata FROM audit_log WHERE organization_id=${target} AND action='organization.quotas_updated'`);
    expect(logs.rows[0].metadata).toMatchObject({ revision: 2 });
    expect(logs.rows).toHaveLength(1);
  });
  it('rejects unsafe values and activation of storage caps before legacy inventory is complete', async () => {
    expect((await request(app).patch(`/api/admin/organization-quotas/${target}`).send({ revision: 1, overrides: { maxTests: -1 } })).status).toBe(400);
    expect((await request(app).patch(`/api/admin/organization-quotas/${target}`).send({ revision: 1, overrides: { maxArtifactBytes: 1024 } })).status).toBe(409);
  });
  it('can return to unlimited inherited quotas and expose free mode without any payment dependency', async () => {
    const result = await request(app).patch(`/api/admin/organization-quotas/${target}`).send({ revision: 1, overrides: { maxTests: 0, mode: 'off' } });
    expect(result.status).toBe(200);
    expect(result.body.quotas).toMatchObject({ maxTests: 0, mode: 'off' });
    const inherited = await request(app).patch(`/api/admin/organization-quotas/${target}`).send({ revision: 2, overrides: { maxTests: null, mode: null } });
    expect(inherited.body.overrides).toMatchObject({ maxTests: null, mode: null });
  });
});
