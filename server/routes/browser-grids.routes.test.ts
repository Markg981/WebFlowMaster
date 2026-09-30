import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { browserGrids, testPlans } from '@shared/schema';
import { decryptSecret } from '../crypto';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * Saving an organization's browser grids: what each provider needs, a key that goes in and never
 * comes out, and plans that go back to the runners when their grid is deleted.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };

beforeAll(async () => {
  organizationId = await createTestOrganization('Grids Org');
  userId = await createTestUser(organizationId, 'grids-user');
  otherOrganizationId = await createTestOrganization('Other Grids Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-grids-user');

  const { default: routes } = await import('./browser-grids.routes');
  const { runWithTenant } = await import('../middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(routes);
});

beforeEach(async () => {
  await privilegedDb.update(testPlans).set({ browserGridId: null });
  await privilegedDb.delete(browserGrids);
  currentUser = { id: userId, username: 'grids-user', organizationId, role: 'editor' };
});

const browserStack = { name: 'BrowserStack', provider: 'browserstack', username: 'acme', key: 'bs-key-123' };

describe('browser grids', () => {
  it('keep the key encrypted and never send it back', async () => {
    const created = await request(app).post('/api/browser-grids').send(browserStack);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'BrowserStack', provider: 'browserstack', username: 'acme', hasKey: true, endpoint: null });
    expect(JSON.stringify(created.body)).not.toContain('bs-key-123');

    const [row] = await privilegedDb.select().from(browserGrids).where(eq(browserGrids.id, created.body.id));
    expect(row.encryptedKey).not.toContain('bs-key-123');
    expect(decryptSecret(row.encryptedKey!, row.keyIv!, row.keyAuthTag!)).toBe('bs-key-123');

    const listed = await request(app).get('/api/browser-grids');
    expect(JSON.stringify(listed.body)).not.toContain('bs-key-123');
  });

  it('ask each provider for what it needs', async () => {
    expect((await request(app).post('/api/browser-grids').send({ ...browserStack, username: '' })).body.error).toMatch(/username/);
    expect((await request(app).post('/api/browser-grids').send({ ...browserStack, key: '' })).body.error).toMatch(/access key/);
    expect((await request(app).post('/api/browser-grids').send({ name: 'Own', provider: 'playwright_server' })).body.error).toMatch(/address/);
    expect((await request(app).post('/api/browser-grids').send({ name: 'Own', provider: 'playwright_server', endpoint: 'http://grid' })).status).toBe(400);
    expect((await request(app).post('/api/browser-grids').send({ name: 'Sauce', provider: 'saucelabs', username: 'a', key: 'b' })).status).toBe(400);

    const own = await request(app).post('/api/browser-grids').send({ name: 'Own', provider: 'playwright_server', endpoint: 'ws://grid:3000/', username: 'ignored' });
    expect(own.status).toBe(201);
    expect(own.body).toMatchObject({ endpoint: 'ws://grid:3000/', username: null, hasKey: false });
  });

  it('keep the saved key when an edit leaves it out, and refuse a duplicate name', async () => {
    const { body: grid } = await request(app).post('/api/browser-grids').send(browserStack);
    const edited = await request(app).put(`/api/browser-grids/${grid.id}`).send({ name: 'BS', username: 'acme2' });
    expect(edited.body).toMatchObject({ name: 'BS', username: 'acme2', hasKey: true });
    const [row] = await privilegedDb.select().from(browserGrids).where(eq(browserGrids.id, grid.id));
    expect(decryptSecret(row.encryptedKey!, row.keyIv!, row.keyAuthTag!)).toBe('bs-key-123');

    await request(app).post('/api/browser-grids').send({ ...browserStack, name: 'Second' });
    expect((await request(app).post('/api/browser-grids').send({ ...browserStack, name: 'bs' })).status).toBe(409);
  });

  it('send the plans that used a deleted grid back to the runners, and say how many', async () => {
    const { body: grid } = await request(app).post('/api/browser-grids').send(browserStack);
    const planId = uuidv4();
    await privilegedDb.insert(testPlans).values({ id: planId, name: 'Nightly', userId, organizationId, browserGridId: grid.id } as any);

    const deleted = await request(app).delete(`/api/browser-grids/${grid.id}`);
    expect(deleted.body).toEqual({ deleted: true, plansMovedToRunners: 1 });
    const [plan] = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, planId));
    expect(plan.browserGridId).toBeNull();
  });

  it("report a grid that cannot be reached, as a check's answer", async () => {
    const { body: grid } = await request(app).post('/api/browser-grids').send({ name: 'Down', provider: 'playwright_server', endpoint: 'ws://127.0.0.1:9/' });
    const checked = await request(app).post(`/api/browser-grids/${grid.id}/test`);
    expect(checked.status).toBe(200);
    expect(checked.body.ok).toBe(false);
    expect(checked.body.message).toBeTruthy();
  }, 90_000);

  it("are not another organization's, and are edited by editors only", async () => {
    const { body: grid } = await request(app).post('/api/browser-grids').send(browserStack);

    currentUser = { id: otherUserId, username: 'other-grids-user', organizationId: otherOrganizationId, role: 'owner' };
    expect((await request(app).get('/api/browser-grids')).body).toEqual([]);
    expect((await request(app).put(`/api/browser-grids/${grid.id}`).send({ name: 'Mine' })).status).toBe(404);
    expect((await request(app).delete(`/api/browser-grids/${grid.id}`)).status).toBe(404);
    expect((await request(app).post(`/api/browser-grids/${grid.id}/test`)).status).toBe(404);

    currentUser = { id: userId, username: 'grids-user', organizationId, role: 'viewer' };
    expect((await request(app).get('/api/browser-grids')).body).toHaveLength(1);
    expect((await request(app).post('/api/browser-grids').send({ ...browserStack, name: 'x' })).status).toBe(403);
    expect((await request(app).delete(`/api/browser-grids/${grid.id}`)).status).toBe(403);
  });
});
