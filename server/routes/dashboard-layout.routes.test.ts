import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { runWithTenant, withTenantTransaction } from '../middleware/tenancy';
import { privilegedDb } from '../db';
import { userDashboardLayouts } from '@shared/dashboard-layout';
import { eq, sql } from 'drizzle-orm';

let app: express.Express;
let user: { id: number; organizationId: number; role: string } | undefined;
let mine: NonNullable<typeof user>;
let colleague: NonNullable<typeof user>;
let outsider: NonNullable<typeof user>;
const widgets = ['kpis', 'status', 'trend', 'schedules', 'reports'].map(id => ({ id, visible: true }));
beforeAll(async () => {
  const org = await createTestOrganization('Dashboard');
  const other = await createTestOrganization('Other dashboard');
  mine = { id: await createTestUser(org), organizationId: org, role: 'viewer' };
  colleague = { id: await createTestUser(org), organizationId: org, role: 'owner' };
  outsider = { id: await createTestUser(other), organizationId: other, role: 'owner' };
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = user;
    (req as any).isAuthenticated = () => !!user;
    if (user) runWithTenant(user.organizationId, next, { userId: user.id, role: user.role });
    else next();
  });
  const { default: router } = await import('./dashboard-layout.routes');
  app.use(router);
});
beforeEach(() => { user = mine; });
describe('personal dashboard layout', () => {
  it('returns the existing default widgets and order', async () => {
    expect((await request(app).get('/api/dashboard/layout')).body).toEqual({ widgets });
  });
  it('requires authentication for every operation', async () => {
    user = undefined;
    for (const method of ['get', 'put', 'delete'] as const) {
      expect((await request(app)[method]('/api/dashboard/layout').send({ widgets })).status).toBe(401);
    }
  });
  it('persists order and visibility for this user only, including for viewers', async () => {
    const changed = [...widgets].reverse().map(w => ({ ...w, visible: w.id !== 'kpis' }));
    expect((await request(app).put('/api/dashboard/layout').send({ widgets: changed })).status).toBe(200);
    expect((await request(app).get('/api/dashboard/layout')).body.widgets).toEqual(changed);
    for (const another of [colleague, outsider]) {
      user = another;
      expect((await request(app).get('/api/dashboard/layout')).body.widgets).toEqual(widgets);
    }
    user = mine;
    expect((await request(app).delete('/api/dashboard/layout')).body.widgets).toEqual(widgets);
    expect((await request(app).get('/api/dashboard/layout')).body.widgets).toEqual(widgets);
  });
  it.each([
    { widgets: [widgets[0], ...widgets.slice(0, 4)] },
    { widgets: [...widgets.slice(0, 4), { id: 'unknown', visible: true }] },
    { widgets: widgets.slice(0, 4) },
    { widgets: widgets.map(w => ({ ...w, visible: 'true' })) },
    { widgets, userId: 999 },
    { widgets, organizationId: 999 },
  ])('rejects invalid or caller-supplied ownership: %j', async body => {
    expect((await request(app).put('/api/dashboard/layout').send(body)).status).toBe(400);
    expect((await request(app).get('/api/dashboard/layout')).body.widgets).toEqual(widgets);
  });
  it('RLS hides and protects another member’s preferences even without route filters', async () => {
    user = colleague;
    await request(app).put('/api/dashboard/layout').send({ widgets });
    const mineOnly = await runWithTenant(mine.organizationId, () => withTenantTransaction(async tx => {
      await tx.update(userDashboardLayouts).set({ widgets: widgets.map(w => ({ ...w, visible: false })) });
      return tx.select().from(userDashboardLayouts);
    }), { userId: mine.id, role: 'viewer' });
    expect(mineOnly.every(row => row.userId === mine.id)).toBe(true);
    const [untouched] = await privilegedDb.select().from(userDashboardLayouts).where(eq(userDashboardLayouts.userId, colleague.id));
    expect(untouched.widgets).toEqual(widgets);
    await privilegedDb.delete(userDashboardLayouts);
  });
  it('rejects a preference whose user belongs to another organization at the database boundary', async () => {
    await expect(privilegedDb.insert(userDashboardLayouts).values({
      organizationId: mine.organizationId, userId: outsider.id, widgets,
    })).rejects.toMatchObject({ code: '23503', constraint: 'user_dashboard_layouts_user_id_same_org_fk' });
  });
  it('deleting a user cascades their saved dashboard preferences', async () => {
    const removed = await createTestUser(mine.organizationId);
    await privilegedDb.insert(userDashboardLayouts).values({ organizationId: mine.organizationId, userId: removed, widgets });
    await privilegedDb.execute(sql`DELETE FROM users WHERE id = ${removed}`);
    expect(await privilegedDb.select().from(userDashboardLayouts).where(eq(userDashboardLayouts.userId, removed))).toEqual([]);
  });
});
