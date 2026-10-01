import { describe, it, expect, beforeAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { auditLog, testDataSets, tests } from '@shared/schema';
import { sharedSetMarker } from '@shared/test-data';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * Shared test data through the API, and as tests receive it: {{data.<set>.<column>}} values and a
 * shared set's rows in place of the marker a UI test keeps (shared/test-data.ts, server/test-data.ts).
 */

type User = { id: number; username: string; organizationId: number; role: string };

let app: express.Express;
let organizationId: number;
let editor: User;
let viewer: User;
let otherOrg: User;
let currentUser: User;
let ownerId: number;

const customers = {
  name: 'customers',
  description: 'Known customers of the shop',
  columns: ['email', 'country'],
  rows: [
    { email: 'ann@shop.test', country: 'IT' },
    { email: 'bob@shop.test', country: 'DE' },
  ],
};

beforeAll(async () => {
  organizationId = await createTestOrganization('Test Data Org');
  ownerId = await createTestUser(organizationId, 'data-owner');
  editor = { id: await createTestUser(organizationId, 'data-editor'), username: 'data-editor', organizationId, role: 'editor' };
  viewer = { id: await createTestUser(organizationId, 'data-viewer'), username: 'data-viewer', organizationId, role: 'viewer' };
  const otherOrganizationId = await createTestOrganization('Other Test Data Org');
  otherOrg = { id: await createTestUser(otherOrganizationId, 'data-other'), username: 'data-other', organizationId: otherOrganizationId, role: 'owner' };
  const { default: routes } = await import('./test-data.routes');
  const { runWithTenant } = await import('../middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), { userId: currentUser.id, role: currentUser.role });
  });
  app.use(routes);
});

describe('shared test data', () => {
  let id: number;

  it('is kept by editors, read by viewers, and audited', async () => {
    currentUser = viewer;
    await request(app).post('/api/test-data').send(customers).expect(403);

    currentUser = editor;
    const created = await request(app).post('/api/test-data').send(customers).expect(201);
    id = created.body.id;
    expect(created.body).toMatchObject({ name: 'customers', columns: ['email', 'country'], rows: customers.rows });
    await request(app).post('/api/test-data').send(customers).expect(409);

    currentUser = viewer;
    const listed = await request(app).get('/api/test-data').expect(200);
    expect(listed.body.map((s: any) => s.name)).toEqual(['customers']);

    const [entry] = await privilegedDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, organizationId), eq(auditLog.action, 'test_data_set.created')));
    expect(entry.metadata).toMatchObject({ name: 'customers', columns: 2, rows: 2 });
  });

  it('refuses names and columns a placeholder could not name, and values for undeclared columns', async () => {
    currentUser = editor;
    const bad = async (body: object) => (await request(app).post('/api/test-data').send({ ...customers, name: 'other', ...body }).expect(400)).body.error;
    expect(await bad({ name: 'Customers EU' })).toMatch(/lowercase letters/);
    expect(await bad({ columns: ['e-mail'] , rows: [{ 'e-mail': 'x' }] })).toMatch(/letters, digits and underscores/);
    expect(await bad({ columns: ['email', 'email'] })).toMatch(/same name/);
    expect(await bad({ rows: [{ email: 'x', phone: '1' }] })).toMatch(/"phone", which is not a column/);
    expect(await bad({ rows: [] })).toMatch(/at least one row/);
  });

  it("is invisible to another organization, which cannot change it either", async () => {
    currentUser = otherOrg;
    expect((await request(app).get('/api/test-data').expect(200)).body).toEqual([]);
    await request(app).get(`/api/test-data/${id}`).expect(404);
    await request(app).put(`/api/test-data/${id}`).send({ ...customers, name: 'stolen' }).expect(404);
    await request(app).delete(`/api/test-data/${id}`).expect(404);
  });

  it('resolves as {{data.<set>.<column>}} from its first row, under the environment', async () => {
    const { resolveVariables } = await import('../variables');
    const vars = await resolveVariables({ userId: editor.id, organizationId });
    expect(vars['data.customers.email']).toBe('ann@shop.test');
    expect(vars['data.customers.country']).toBe('IT');
    const others = await resolveVariables({ userId: otherOrg.id, organizationId: otherOrg.organizationId });
    expect(others['data.customers.email']).toBeUndefined();
  });

  it('gives its rows to a UI test that points at it, and cannot be deleted while one does', async () => {
    const [uiTest] = await privilegedDb
      .insert(tests)
      .values({ name: 'Sign up per customer', url: 'https://shop.test', sequence: [], elements: [], dataset: sharedSetMarker(id), userId: ownerId, organizationId } as any)
      .returning();
    const { expandSharedDataset, SharedDataError } = await import('../test-data');
    const { withTenantTransaction, runWithTenant } = await import('../middleware/tenancy');
    const expanded = await runWithTenant(organizationId, () => withTenantTransaction((tx) => expandSharedDataset(tx, uiTest)), { userId: editor.id, role: 'editor' });
    expect(expanded.dataset).toEqual(customers.rows);

    // Another organization's run cannot reach it through the marker.
    await expect(
      runWithTenant(otherOrg.organizationId, () => withTenantTransaction((tx) => expandSharedDataset(tx, uiTest)), { userId: otherOrg.id, role: 'owner' }),
    ).rejects.toBeInstanceOf(SharedDataError);

    currentUser = editor;
    const refused = await request(app).delete(`/api/test-data/${id}`).expect(409);
    expect(refused.body.error).toContain('Sign up per customer');
    expect((await request(app).get(`/api/test-data/${id}`).expect(200)).body.usedBy).toEqual(['Sign up per customer']);

    // Renamed and changed, the test follows: it points at the set, not at its name.
    await request(app).put(`/api/test-data/${id}`).send({ ...customers, name: 'shoppers', rows: [customers.rows[1]] }).expect(200);
    const again = await runWithTenant(organizationId, () => withTenantTransaction((tx) => expandSharedDataset(tx, uiTest)), { userId: editor.id, role: 'editor' });
    expect(again.dataset).toEqual([customers.rows[1]]);

    await privilegedDb.update(tests).set({ dataset: null } as any).where(eq(tests.id, uiTest.id));
    await request(app).delete(`/api/test-data/${id}`).expect(204);
    expect(await privilegedDb.select().from(testDataSets).where(eq(testDataSets.id, id))).toEqual([]);
    await expect(
      runWithTenant(organizationId, () => withTenantTransaction((tx) => expandSharedDataset(tx, { ...uiTest, dataset: sharedSetMarker(id) })), { userId: editor.id, role: 'editor' }),
    ).rejects.toThrow(/no longer exists/);
  });
});
