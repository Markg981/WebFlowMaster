import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { privilegedDb } from '../db';
import { apiTests, mobileTests, projects, tags, testDataSets, testTags, tests } from '@shared/schema';
import { toSequence } from '@shared/manual-tests';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({ default: Promise.resolve({ error: vi.fn() }) }));
let app: express.Express;
let org: number;
let userId: number;
let otherOrg: number;
let orgForRequest: number;
let authenticated = true;
let projectId: number;
let smoke: string;
let slow: string;
let manualId: number;
let dataId: number;
const usersByOrg = new Map<number, number>();

beforeAll(async () => {
  org = await createTestOrganization();
  userId = await createTestUser(org);
  otherOrg = await createTestOrganization();
  const otherUserId = await createTestUser(otherOrg);
  usersByOrg.set(org, userId);
  usersByOrg.set(otherOrg, otherUserId);
  orgForRequest = org;
  const [project] = await privilegedDb.insert(projects).values({ name: 'Catalog project', organizationId: org, userId }).returning();
  projectId = project.id;
  const inserted = await privilegedDb.insert(tests).values([
    { name: 'Alpha', status: 'ready', projectId, sequence: [], elements: [], url: 'https://test', organizationId: org, userId },
    { name: 'Beta', status: 'draft', sequence: toSequence([{ action: 'Open', expected: 'Visible' }]), elements: [], url: '', organizationId: org, userId },
    { name: 'literal_%', sequence: [], elements: [], url: '', organizationId: org, userId },
    { name: 'literalXY', sequence: [], elements: [], url: '', organizationId: org, userId },
    { name: 'Alpha', sequence: [], elements: [], url: '', organizationId: org, userId },
    { name: 'Foreign', sequence: [], elements: [], url: '', organizationId: otherOrg, userId: otherUserId },
  ]).returning();
  manualId = inserted[1].id;
  smoke = randomUUID(); slow = randomUUID();
  await privilegedDb.insert(tags).values([{ id: smoke, name: 'smoke', organizationId: org }, { id: slow, name: 'slow', organizationId: org }]);
  await privilegedDb.insert(testTags).values([
    { organizationId: org, testType: 'ui', testId: inserted[0].id, tagId: smoke },
    { organizationId: org, testType: 'ui', testId: manualId, tagId: smoke },
    { organizationId: org, testType: 'ui', testId: manualId, tagId: slow },
  ]);
  const [data] = await privilegedDb.insert(testDataSets).values({ organizationId: org, name: 'customers', columns: ['email'], rows: [{ email: 'secret@test' }, { email: 'second@test' }] }).returning();
  dataId = data.id;
  await privilegedDb.insert(apiTests).values({ name: 'API', method: 'POST', url: 'https://api', requestBody: 'private body', authParams: { password: 'private' }, organizationId: org, userId });
  await privilegedDb.insert(mobileTests).values({ name: 'Mobile', platform: 'android', app: 'bs://app', deviceName: 'Pixel', steps: [], organizationId: org });
  const { default: routes } = await import('./catalog.routes');
  const { runWithTenant } = await import('../middleware/tenancy');
  app = express();
  app.use((req, _res, next) => {
    const requestUserId = usersByOrg.get(orgForRequest)!;
    (req as any).user = { id: requestUserId, organizationId: orgForRequest, role: 'viewer' };
    (req as any).isAuthenticated = () => authenticated;
    runWithTenant(orgForRequest, next, { userId: requestUserId, role: 'viewer' });
  });
  app.use(routes);
});

describe('lightweight catalogs', () => {
  it('paginates in a stable name/id order and counts all visible matches', async () => {
    const first = (await request(app).get('/api/catalog/tests?pageSize=2').expect(200)).body;
    const second = (await request(app).get('/api/catalog/tests?pageSize=2&page=2').expect(200)).body;
    expect(first).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(first.items.map((row: any) => row.name)).toEqual(['Alpha', 'Alpha']);
    expect(second.items[0].name).toBe('Beta');
    expect(new Set([...first.items, ...second.items].map((row: any) => row.id)).size).toBe(4);
    expect(first.items[0].id).toBeLessThan(first.items[1].id);
    expect(first.items.every((row: any) => !('sequence' in row) && !('elements' in row) && !('bdd' in row))).toBe(true);
    const beyond = (await request(app).get('/api/catalog/tests?page=99').expect(200)).body;
    expect(beyond).toMatchObject({ items: [], total: 5, page: 99 });
  });
  it('applies literal name search, project/status and every selected tag before paging', async () => {
    expect((await request(app).get('/api/catalog/tests').query({ search: 'LITERAL_%' }).expect(200)).body.total).toBe(1);
    const tagged = (await request(app).get('/api/catalog/tests').query({ tagIds: `${smoke},${slow},${slow}`, pageSize: 1 }).expect(200)).body;
    expect(tagged.total).toBe(1);
    expect(tagged.items[0]).toMatchObject({ id: manualId, kind: 'manual' });
    expect(tagged.items[0].tags).toHaveLength(2);
    const filtered = (await request(app).get('/api/catalog/tests').query({ projectId, status: 'ready' }).expect(200)).body;
    expect(filtered.total).toBe(1);
    expect((await request(app).get('/api/catalog/tests?search=absent').expect(200)).body).toMatchObject({ total: 0, items: [] });
  });
  it('sends row counts without dataset values, and no API or mobile definitions', async () => {
    const data = (await request(app).get('/api/catalog/test-data').expect(200)).body;
    expect(data.items[0]).toMatchObject({ id: dataId, columns: ['email'], rowCount: 2 });
    expect(data.items[0]).not.toHaveProperty('rows');
    const api = (await request(app).get('/api/catalog/api-tests').expect(200)).body.items[0];
    expect(api).toMatchObject({ name: 'API', method: 'POST' });
    for (const key of ['requestBody', 'authParams', 'assertions', 'protocolConfig', 'protoDefinition']) expect(api).not.toHaveProperty(key);
    const mobile = (await request(app).get('/api/catalog/mobile-tests').expect(200)).body.items[0];
    expect(mobile).toMatchObject({ name: 'Mobile', stepCount: 0, deviceCount: 0, lastRun: null });
    expect(mobile).not.toHaveProperty('steps');
    expect(mobile).not.toHaveProperty('deviceMatrix');
  });
  it('scopes both rows and total to the tenant, and refuses foreign details', async () => {
    orgForRequest = otherOrg;
    try {
      expect((await request(app).get('/api/catalog/tests').expect(200)).body).toMatchObject({ total: 1, items: [expect.objectContaining({ name: 'Foreign' })] });
      expect((await request(app).get('/api/catalog/test-data').expect(200)).body.total).toBe(0);
      await request(app).get(`/api/tests/${manualId}`).expect(404);
    } finally { orgForRequest = org; }
    expect((await request(app).get(`/api/tests/${manualId}`).expect(200)).body.sequence).toEqual(toSequence([{ action: 'Open', expected: 'Visible' }]));
  });
  it('validates pagination and filter shapes instead of silently removing bounds', async () => {
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=x', 'pageSize=0', 'pageSize=101', 'page=99999999999999999', 'search[x]=value', 'projectId=0', 'tagIds[x]=value']) {
      await request(app).get(`/api/catalog/tests?${query}`).expect(400);
    }
    await request(app).get('/api/catalog/api-tests?status=draft').expect(400);
    await request(app).get('/api/catalog/test-data?projectId=1').expect(400);
    await request(app).get('/api/tests/invalid').expect(400);
    authenticated = false;
    try { await request(app).get('/api/catalog/tests').expect(401); } finally { authenticated = true; }
  });
  it('bounds a large catalog at the default and maximum page size without skipping names', async () => {
    const largeOrg = await createTestOrganization();
    const largeUser = await createTestUser(largeOrg);
    usersByOrg.set(largeOrg, largeUser);
    await privilegedDb.insert(tests).values(Array.from({ length: 121 }, (_, i) => ({
      organizationId: largeOrg, userId: largeUser, name: `Test ${String(i).padStart(3, '0')}`, url: '',
      sequence: [{ value: 'x'.repeat(10_000) }], elements: [],
    })));
    orgForRequest = largeOrg;
    try {
      const first = (await request(app).get('/api/catalog/tests').expect(200)).body;
      expect(first).toMatchObject({ total: 121, pageSize: 25 });
      expect(first.items).toHaveLength(25);
      expect(JSON.stringify(first).length).toBeLessThan(20_000);
      const last = (await request(app).get('/api/catalog/tests?pageSize=100&page=2').expect(200)).body;
      expect(last.items).toHaveLength(21);
      expect(last.items[0].name).toBe('Test 100');
    } finally { orgForRequest = org; }
  });
  it('excludes restricted projects from totals, tags and details for non-members', async () => {
    const restrictedOrg = await createTestOrganization();
    const restrictedUser = await createTestUser(restrictedOrg);
    usersByOrg.set(restrictedOrg, restrictedUser);
    const [restrictedProject] = await privilegedDb.insert(projects).values({ organizationId: restrictedOrg, userId: restrictedUser, name: 'Private', restricted: true }).returning();
    const inserted = await privilegedDb.insert(tests).values([
      { organizationId: restrictedOrg, userId: restrictedUser, name: 'Visible', url: '', sequence: [], elements: [] },
      { organizationId: restrictedOrg, userId: restrictedUser, name: 'Private', url: '', sequence: [], elements: [], projectId: restrictedProject.id },
    ]).returning();
    orgForRequest = restrictedOrg;
    try {
      expect((await request(app).get('/api/catalog/tests').expect(200)).body).toMatchObject({ total: 1, items: [expect.objectContaining({ name: 'Visible' })] });
      expect((await request(app).get(`/api/catalog/tests?projectId=${restrictedProject.id}`).expect(200)).body.total).toBe(0);
      await request(app).get(`/api/tests/${inserted[1].id}`).expect(404);
    } finally { orgForRequest = org; }
  });
  it('classifies legacy manual sequences and BDD modes without returning their definitions', async () => {
    const typeOrg = await createTestOrganization();
    const typeUser = await createTestUser(typeOrg);
    usersByOrg.set(typeOrg, typeUser);
    const source = 'Feature: Private\nScenario: Secret\nGiven private';
    await privilegedDb.insert(tests).values([
      { organizationId: typeOrg, userId: typeUser, name: 'A legacy', url: '', sequence: JSON.stringify(toSequence([{ action: 'Open', expected: 'Visible' }])), elements: [] },
      { organizationId: typeOrg, userId: typeUser, name: 'B invalid legacy', url: '', sequence: 'invalid JSON', elements: [] },
      { organizationId: typeOrg, userId: typeUser, name: 'C BDD', url: '', sequence: [], elements: [], bdd: { source, language: 'en', mode: 'manual' } as any },
      { organizationId: typeOrg, userId: typeUser, name: 'D Cucumber', url: '', sequence: [], elements: [], bdd: { source, language: 'en', mode: 'cucumber' } as any },
    ]);
    orgForRequest = typeOrg;
    try {
      const result = (await request(app).get('/api/catalog/tests').expect(200)).body;
      expect(result.items.map((row: any) => row.kind)).toEqual(['manual', 'browser', 'bdd', 'cucumber']);
      expect(JSON.stringify(result)).not.toContain('Private');
      expect(JSON.stringify(result)).not.toContain('legacySequence');
    } finally { orgForRequest = org; }
  });
});
