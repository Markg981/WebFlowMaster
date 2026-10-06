import { beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { runWithTenant } from '../middleware/tenancy';
import { DEFAULT_DASHBOARD_WIDGETS } from '@shared/dashboard-layout';
import { userDashboardLayouts } from '@shared/dashboard-layout';
import { privilegedDb } from '../db';
const commitProbe = vi.hoisted(() => ({ enabled: false, committed: false, respondedBeforeCommit: false, response: undefined as express.Response | undefined, pending: undefined as Promise<unknown> | undefined }));
vi.mock('../middleware/tenancy', async importOriginal => {
  const actual = await importOriginal<typeof import('../middleware/tenancy')>();
  return { ...actual, withTenantTransaction: async (fn: Parameters<typeof actual.withTenantTransaction>[0]) => {
    const probing = commitProbe.enabled;
    const pending = actual.withTenantTransaction(async tx => {
      const result = await fn(tx);
      // Capture the response at the transaction callback boundary, before COMMIT. This
      // detects an early response regardless of how quickly the HTTP client is scheduled.
      if (probing) commitProbe.respondedBeforeCommit = commitProbe.response!.headersSent;
      return result;
    });
    if (probing) commitProbe.pending = pending;
    const result = await pending;
    if (probing) commitProbe.committed = true;
    return result;
  } };
});
let app: express.Express;
let current: { id: number; organizationId: number; role: string };
let creator: typeof current, reader: typeof current, admin: typeof current, outsider: typeof current;
beforeAll(async () => {
  const org = await createTestOrganization('Dashboards');
  creator = { id: await createTestUser(org), organizationId: org, role: 'viewer' };
  reader = { id: await createTestUser(org), organizationId: org, role: 'viewer' };
  admin = { id: await createTestUser(org), organizationId: org, role: 'owner' };
  const other = await createTestOrganization('Other');
  outsider = { id: await createTestUser(other), organizationId: other, role: 'owner' };
  app = express(); app.use(express.json());
  app.use((req, res, next) => { if (commitProbe.enabled) commitProbe.response = res; (req as any).user = current; (req as any).isAuthenticated = () => !!current; if (current) runWithTenant(current.organizationId, next, { userId: current.id, role: current.role }); else next(); });
  app.use((await import('./dashboards.routes')).default);
});
const document = { name: 'Team metrics', visibility: 'private', widgets: DEFAULT_DASHBOARD_WIDGETS };
describe('multiple dashboards', () => {
  it('returns created dashboards only after their transaction commits', async () => {
    const organizationId = await createTestOrganization('Dashboard commit probe');
    current = { id: await createTestUser(organizationId), organizationId, role: 'viewer' };
    commitProbe.enabled = true; commitProbe.committed = false; commitProbe.respondedBeforeCommit = false;
    try {
      const created = await request(app).post('/api/dashboards').send({ ...document, visibility: 'organization' }).expect(201);
      expect(commitProbe.respondedBeforeCommit).toBe(false);
      expect(commitProbe.committed).toBe(true);
      current = { id: await createTestUser(organizationId), organizationId, role: 'viewer' };
      await request(app).get(`/api/dashboards/${created.body.id}`).expect(200).expect(res => expect(res.body.canManage).toBe(false));
    } finally { await commitProbe.pending; commitProbe.enabled = false; }
  });
  it('initializes once and preserves selected/default preferences', async () => {
    current = creator;
    const first = (await request(app).get('/api/dashboards')).body;
    const second = (await request(app).get('/api/dashboards')).body;
    expect(first.dashboards).toHaveLength(1); expect(second.dashboards[0].id).toBe(first.dashboards[0].id);
    expect(first.preferences.defaultDashboardId).toBe(first.dashboards[0].id);
  });
  it('imports a legacy layout in its saved order and visibility', async () => {
    current = { id: await createTestUser(creator.organizationId), organizationId: creator.organizationId, role: 'viewer' };
    const widgets = [...DEFAULT_DASHBOARD_WIDGETS].reverse().map(w => ({ id: w.type, visible: w.type !== 'kpis' }));
    await privilegedDb.insert(userDashboardLayouts).values({ organizationId: current.organizationId, userId: current.id, widgets });
    const response = await request(app).get('/api/dashboards'); expect(response.status).toBe(200);
    expect(response.body.dashboards[0].widgets.map((w: any) => ({ id: w.type, visible: w.visible }))).toEqual(widgets);
  });
  it('requires authentication for dashboard reads and mutations', async () => {
    current = undefined as any;
    for (const method of ['get', 'post'] as const) expect((await request(app)[method]('/api/dashboards').send(document)).status).toBe(401);
    for (const method of ['get', 'put', 'delete'] as const) expect((await request(app)[method]('/api/dashboards/00000000-0000-0000-0000-000000000000').send(document)).status).toBe(401);
  });
  it('keeps private dashboards invisible even to admins and other organizations', async () => {
    current = creator;
    const created = await request(app).post('/api/dashboards').send(document); expect(created.status).toBe(201);
    for (const another of [reader, admin, outsider]) { current = another; expect((await request(app).get(`/api/dashboards/${created.body.id}`)).status).toBe(404); }
  });
  it('publishes, duplicates, enforces revision conflicts and clears preferences after deletion', async () => {
    current = creator;
    const row = (await request(app).post('/api/dashboards').send({ ...document, visibility: 'organization' }).expect(201)).body;
    current = reader;
    expect((await request(app).get(`/api/dashboards/${row.id}`).expect(200)).body.canManage).toBe(false);
    expect((await request(app).put(`/api/dashboards/${row.id}`).send({ ...document, visibility: 'organization', version: row.version })).status).toBe(403);
    const copy = await request(app).post(`/api/dashboards/${row.id}/duplicate`).send({ name: 'My copy' });
    expect(copy.status).toBe(201); expect(copy.body.visibility).toBe('private'); expect(copy.body.creatorId).toBe(reader.id);
    await request(app).put('/api/dashboards/preferences').send({ selectedDashboardId: row.id, defaultDashboardId: row.id });
    current = admin;
    const changed = await request(app).put(`/api/dashboards/${row.id}`).send({ ...document, visibility: 'organization', name: 'Renamed', version: row.version });
    expect(changed.status).toBe(200); expect(changed.body.version).toBe(row.version + 1);
    expect((await request(app).put(`/api/dashboards/${row.id}`).send({ ...document, visibility: 'organization', version: row.version })).status).toBe(409);
    expect((await request(app).put(`/api/dashboards/${row.id}`).send({ ...document, version: changed.body.version })).status).toBe(403);
    expect((await request(app).delete(`/api/dashboards/${row.id}`)).status).toBe(204);
    current = reader;
    const list = (await request(app).get('/api/dashboards')).body;
    expect(list.preferences.selectedDashboardId).toBe(copy.body.id);
  });
  it('rejects foreign project filters and caller ownership', async () => {
    current = creator;
    expect((await request(app).post('/api/dashboards').send({ ...document, creatorId: reader.id })).status).toBe(400);
    expect((await request(app).post('/api/dashboards').send({ ...document, widgets: [{ ...DEFAULT_DASHBOARD_WIDGETS[0], config: { projectId: 2147483647 } }] })).status).toBe(400);
    expect((await request(app).put('/api/dashboards/preferences').send({ selectedDashboardId: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);
  });
  it('fails closed for unknown organization roles', async () => {
    current = { ...creator, role: 'admin' };
    expect((await request(app).get('/api/dashboards')).status).toBe(403);
  });
});
