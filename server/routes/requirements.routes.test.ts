import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import type { AddressInfo } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import {
  apiTests,
  auditLog,
  issueTrackers,
  projectMembers,
  projects,
  reportTestCaseResults,
  requirementTests,
  requirements,
  testPlanExecutions,
  testPlans,
  tests,
} from '@shared/schema';
import { encryptSecret } from '../crypto';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * Requirements traceability through the API: requirements typed in or imported from Jira and
 * Azure DevOps, the tests linked to them, and their coverage from the tests' latest results —
 * within what the requester is allowed to see.
 */

type User = { id: number; username: string; organizationId: number; role: string };

let app: express.Express;
let organizationId: number;
let editor: User;
let outsider: User;
let otherOrg: User;
let currentUser: User;
let loginTest: number;
let checkoutTest: number;
let secretTest: number;
let ordersApi: number;
let nightly: string;
let release: string;

// ─── A Jira and an Azure DevOps ───────────────────────────────────────────────

const jiraIssues: Record<string, { summary: string; type: string; status: string; parent?: string }> = {
  'SHOP-1': { summary: 'Checkout', type: 'Epic', status: 'In Progress' },
  'SHOP-2': { summary: 'Pay by card', type: 'Story', status: 'Done', parent: 'SHOP-1' },
  'SHOP-3': { summary: 'Pay by invoice', type: 'Story', status: 'To Do', parent: 'SHOP-1' },
};
const azureItems: Record<number, { title: string; type: string; state: string; parent?: number }> = {
  100: { title: 'Returns', type: 'Epic', state: 'Active' },
  101: { title: 'Return a parcel', type: 'User Story', state: 'New', parent: 100 },
};
let trackerRequests: string[] = [];
let jiraRefuses = false;

const trackerServer = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://x');
  trackerRequests.push(`${req.method} ${url.pathname}${url.search}`);
  const json = (status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  if (url.pathname === '/rest/api/3/search/jql') {
    if (jiraRefuses) return json(401, { errorMessages: ['Client must be authenticated to access this resource.'] });
    const jql = url.searchParams.get('jql') ?? '';
    // Jira matches keys whatever their case, as the real one does.
    const keys = /key in \((.*)\)/.exec(jql)?.[1].split(',').map((k) => k.trim().replace(/"/g, '').toUpperCase()) ?? Object.keys(jiraIssues);
    const issues = keys
      .filter((k) => jiraIssues[k])
      .map((k) => ({ key: k, fields: { summary: jiraIssues[k].summary, issuetype: { name: jiraIssues[k].type }, status: { name: jiraIssues[k].status }, parent: jiraIssues[k].parent ? { key: jiraIssues[k].parent } : undefined } }));
    return json(200, { issues, isLast: true });
  }
  if (url.pathname.endsWith('/_apis/wit/wiql')) return json(200, { workItems: Object.keys(azureItems).map((id) => ({ id: Number(id) })) });
  if (url.pathname.endsWith('/_apis/wit/workitems')) {
    const ids = (url.searchParams.get('ids') ?? '').split(',').map(Number);
    return json(200, {
      value: ids.map((id) =>
        azureItems[id]
          ? { id, fields: { 'System.Title': azureItems[id].title, 'System.WorkItemType': azureItems[id].type, 'System.State': azureItems[id].state, ...(azureItems[id].parent ? { 'System.Parent': azureItems[id].parent } : {}) } }
          : null,
      ),
    });
  }
  json(404, {});
});
let trackerBase: string;

async function addTracker(provider: 'jira' | 'azure_devops') {
  const encrypted = encryptSecret('token-1');
  const id = uuidv4();
  await privilegedDb.insert(issueTrackers).values({
    id, organizationId, name: provider === 'jira' ? 'Jira' : 'Azure', provider, baseUrl: provider === 'jira' ? trackerBase : `${trackerBase}/acme`,
    projectKey: provider === 'jira' ? 'SHOP' : 'Shop', issueType: 'Bug', userEmail: 'qa@acme.test',
    encryptedToken: encrypted.encryptedValue, tokenIv: encrypted.iv, tokenAuthTag: encrypted.authTag,
  });
  return id;
}

// ─── Runs ──────────────────────────────────────────────────────────────────────

async function seedRun(planId: string, at: string, rows: Array<{ ui?: number; api?: number; status: string; browser?: string }>, status = 'completed') {
  const executionId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({ id: executionId, organizationId, testPlanId: planId, status, triggeredBy: 'manual', startedAt: new Date(at), completedAt: new Date(at) } as any);
  for (const row of rows) {
    await privilegedDb.insert(reportTestCaseResults).values({
      id: uuidv4(), testPlanExecutionId: executionId, organizationId, uiTestId: row.ui ?? null, apiTestId: row.api ?? null,
      testType: row.ui ? 'ui' : 'api', testName: 'x', status: row.status, browser: row.browser ?? 'chromium', startedAt: new Date(at),
    } as any);
  }
  return executionId;
}

beforeAll(async () => {
  organizationId = await createTestOrganization('Traceability Org');
  const ownerId = await createTestUser(organizationId, 'trace-owner');
  editor = { id: await createTestUser(organizationId, 'trace-editor'), username: 'trace-editor', organizationId, role: 'editor' };
  outsider = { id: await createTestUser(organizationId, 'trace-outsider'), username: 'trace-outsider', organizationId, role: 'editor' };
  const otherOrganizationId = await createTestOrganization('Other Traceability Org');
  otherOrg = { id: await createTestUser(otherOrganizationId, 'trace-other'), username: 'trace-other', organizationId: otherOrganizationId, role: 'owner' };

  // A restricted project the editor is on and the outsider is not.
  const [secret] = await privilegedDb.insert(projects).values({ name: 'Payments', userId: ownerId, organizationId, restricted: true }).returning();
  await privilegedDb.insert(projectMembers).values({ projectId: secret.id, userId: editor.id, organizationId, role: 'editor' });

  const makeTest = async (name: string, projectId: number | null = null) =>
    (await privilegedDb.insert(tests).values({ name, url: 'https://shop.test', sequence: [], elements: [], userId: ownerId, organizationId, projectId } as any).returning())[0].id;
  loginTest = await makeTest('Login');
  checkoutTest = await makeTest('Checkout by card');
  secretTest = await makeTest('Card vault', secret.id);
  ordersApi = (await privilegedDb.insert(apiTests).values({ name: 'Orders API', method: 'GET', url: 'https://shop.test/api/orders', userId: ownerId, organizationId } as any).returning())[0].id;

  nightly = uuidv4();
  release = uuidv4();
  await privilegedDb.insert(testPlans).values([
    { id: nightly, name: 'Nightly', userId: ownerId, organizationId },
    { id: release, name: 'Release', userId: ownerId, organizationId },
  ] as any);

  await new Promise<void>((resolve) => trackerServer.listen(0, '127.0.0.1', resolve));
  trackerBase = `http://127.0.0.1:${(trackerServer.address() as AddressInfo).port}`;

  const { default: routes } = await import('./requirements.routes');
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

afterAll(async () => {
  await new Promise<void>((resolve) => trackerServer.close(() => resolve()));
});

beforeEach(async () => {
  await privilegedDb.delete(requirementTests);
  await privilegedDb.update(requirements).set({ parentId: null });
  await privilegedDb.delete(requirements);
  await privilegedDb.delete(reportTestCaseResults);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(issueTrackers);
  currentUser = editor;
  trackerRequests = [];
  jiraRefuses = false;
});

const create = (body: Record<string, unknown>) => request(app).post('/api/requirements').send({ kind: 'story', ...body });
const link = (id: number, items: Array<{ type: 'ui' | 'api'; id: number }>) => request(app).put(`/api/requirements/${id}/tests`).send({ items });
const byKey = (body: any, key: string) => body.requirements.find((r: any) => r.key === key);

describe('requirements and their coverage', () => {
  it('works out each one from the latest run of its tests, an epic from its stories', async () => {
    const { body: epic } = await create({ key: 'SHOP-1', title: 'Checkout', kind: 'epic' });
    const { body: card } = await create({ key: 'SHOP-2', title: 'Pay by card', parentId: epic.id });
    const { body: login } = await create({ key: 'SHOP-3', title: 'Sign in', parentId: epic.id });
    const { body: refunds } = await create({ key: 'SHOP-4', title: 'Refunds', kind: 'requirement' });
    await create({ key: 'SHOP-5', title: 'Invoices' });
    expect((await link(card.id, [{ type: 'ui', id: checkoutTest }, { type: 'api', id: ordersApi }])).body).toHaveLength(2);
    await link(login.id, [{ type: 'ui', id: loginTest }]);
    await link(refunds.id, [{ type: 'ui', id: loginTest }]);

    // Checkout failed on Safari yesterday and passed today: today counts. Orders API failed today.
    await seedRun(nightly, '2026-09-29T02:00:00Z', [{ ui: checkoutTest, status: 'Failed', browser: 'webkit' }, { ui: loginTest, status: 'Passed' }]);
    await seedRun(nightly, '2026-09-30T02:00:00Z', [
      { ui: checkoutTest, status: 'Passed', browser: 'chromium' },
      { ui: checkoutTest, status: 'Passed', browser: 'webkit' },
      { api: ordersApi, status: 'Failed' },
    ]);
    // A run still going does not count.
    await seedRun(nightly, '2026-09-30T05:00:00Z', [{ ui: loginTest, status: 'Failed' }], 'running');

    const { body } = await request(app).get('/api/requirements').expect(200);
    expect(byKey(body, 'SHOP-2').coverage).toMatchObject({ state: 'failing', passed: 1, failed: 1 });
    expect(byKey(body, 'SHOP-2').coverage.tests.find((t: any) => t.name === 'Checkout by card')).toMatchObject({
      outcome: 'passed',
      lastRun: { planName: 'Nightly', at: '2026-09-30T02:00:00.000Z' },
    });
    expect(byKey(body, 'SHOP-3').coverage).toMatchObject({ state: 'passing', passed: 1 });
    expect(byKey(body, 'SHOP-1').coverage).toMatchObject({ state: 'failing', passed: 2, failed: 1 });
    expect(byKey(body, 'SHOP-1').directTests).toBe(0);
    expect(byKey(body, 'SHOP-4').coverage.state).toBe('passing');
    expect(byKey(body, 'SHOP-5').coverage.state).toBe('uncovered');
    expect(body.summary).toEqual({ total: 5, passing: 2, failing: 2, notRun: 0, uncovered: 1, coveredPercent: 80 });
    expect(body.scope).toBeNull();
  });

  it("narrows to one plan's latest run, or to exactly one run", async () => {
    const { body: story } = await create({ key: 'SHOP-2', title: 'Pay by card' });
    await link(story.id, [{ type: 'ui', id: checkoutTest }, { type: 'ui', id: loginTest }]);
    const releaseRun = await seedRun(release, '2026-09-28T10:00:00Z', [{ ui: checkoutTest, status: 'Passed' }, { ui: loginTest, status: 'Pending' }]);
    await seedRun(nightly, '2026-09-30T02:00:00Z', [{ ui: checkoutTest, status: 'Failed' }]);

    expect(byKey((await request(app).get('/api/requirements')).body, 'SHOP-2').coverage.state).toBe('failing');

    const inRelease = (await request(app).get(`/api/requirements?planId=${release}`)).body;
    expect(inRelease.scope).toMatchObject({ kind: 'plan', planName: 'Release' });
    // The manual test is waiting for its verdict: not run yet, not passed.
    expect(byKey(inRelease, 'SHOP-2').coverage).toMatchObject({ state: 'notRun', passed: 1, notRun: 1 });

    const inRun = (await request(app).get(`/api/requirements?executionId=${releaseRun}`)).body;
    expect(inRun.scope).toMatchObject({ kind: 'execution', id: releaseRun, planName: 'Release' });
    expect(byKey(inRun, 'SHOP-2').coverage.state).toBe('notRun');

    expect((await request(app).get(`/api/requirements?planId=${uuidv4()}`)).status).toBe(404);
  });

  it('counts a test in a project the requester cannot see without naming it, and keeps its link', async () => {
    const { body: story } = await create({ key: 'PAY-1', title: 'Store a card' });
    await link(story.id, [{ type: 'ui', id: secretTest }, { type: 'ui', id: loginTest }]);
    await seedRun(nightly, '2026-09-30T02:00:00Z', [{ ui: secretTest, status: 'Failed' }, { ui: loginTest, status: 'Passed' }]);

    expect(byKey((await request(app).get('/api/requirements')).body, 'PAY-1').coverage).toMatchObject({ state: 'failing', hidden: 0 });

    currentUser = outsider;
    const seen = byKey((await request(app).get('/api/requirements')).body, 'PAY-1').coverage;
    expect(seen).toMatchObject({ state: 'passing', hidden: 1 });
    expect(JSON.stringify(seen)).not.toContain('Card vault');
    expect((await request(app).get(`/api/requirements/${story.id}`)).body.tests).toEqual(
      expect.arrayContaining([{ type: 'ui', id: secretTest, name: null }, { type: 'ui', id: loginTest, name: 'Login' }]),
    );
    // Linking the tests they can see leaves the one they cannot where it is.
    await link(story.id, [{ type: 'api', id: ordersApi }]).expect(200);
    expect(await privilegedDb.select().from(requirementTests).where(eq(requirementTests.requirementId, story.id))).toHaveLength(2);
    expect((await link(story.id, [{ type: 'ui', id: secretTest }])).status).toBe(400);
  });

  it('refuses a duplicate key, a loop and a missing parent', async () => {
    const { body: epic } = await create({ key: 'SHOP-1', title: 'Checkout', kind: 'epic' });
    const { body: story } = await create({ key: 'SHOP-2', title: 'Pay', parentId: epic.id });
    expect((await create({ key: 'shop-1', title: 'Again' })).status).toBe(409);
    expect((await create({ key: 'has space', title: 'x' })).body.error).toMatch(/letters, digits/);
    expect((await request(app).put(`/api/requirements/${epic.id}`).send({ key: 'SHOP-1', title: 'Checkout', kind: 'epic', parentId: story.id })).body.error).toMatch(/under itself/);
    expect((await create({ key: 'SHOP-9', title: 'x', parentId: 999999 })).body.error).toMatch(/parent requirement does not exist/);

    // Deleting the epic leaves its story without one.
    await request(app).delete(`/api/requirements/${epic.id}`).expect(204);
    expect((await request(app).get(`/api/requirements/${story.id}`)).body.parentId).toBeNull();
  });

  it("exports the matrix, and keeps each organization's to itself, and viewers to reading", async () => {
    const { body: story } = await create({ key: 'SHOP-2', title: 'Pay by card' });
    await link(story.id, [{ type: 'ui', id: checkoutTest }]);
    await create({ key: 'SHOP-3', title: 'Pay by invoice' });
    const csv = await request(app).get('/api/requirements/matrix.csv').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('SHOP-2,Pay by card,story,,,notRun,Checkout by card,web,notRun');
    expect(csv.text).toContain('SHOP-3,Pay by invoice,story,,,uncovered');

    const audits = await privilegedDb.select().from(auditLog).where(eq(auditLog.targetId, String(story.id)));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['requirement.created', 'requirement.tests_changed']));

    currentUser = otherOrg;
    expect((await request(app).get('/api/requirements')).body.requirements).toEqual([]);
    expect((await request(app).get(`/api/requirements/${story.id}`)).status).toBe(404);
    expect((await request(app).delete(`/api/requirements/${story.id}`)).status).toBe(404);

    currentUser = { ...editor, role: 'viewer' };
    expect((await request(app).get('/api/requirements')).body.requirements).toHaveLength(2);
    expect((await create({ key: 'X-1', title: 'x' })).status).toBe(403);
    expect((await link(story.id, [])).status).toBe(403);
  });
});

describe('importing from a tracker', () => {
  it('reads Jira issues by key, brings their epic, and says which keys it did not find', async () => {
    const trackerId = await addTracker('jira');
    const { body } = await request(app).post('/api/requirements/import').send({ trackerId, keys: ['SHOP-2', 'SHOP-404'] }).expect(200);
    expect(body).toMatchObject({ created: ['SHOP-2', 'SHOP-1'], updated: [], missing: ['SHOP-404'], found: 2 });

    const listed = (await request(app).get('/api/requirements')).body;
    expect(byKey(listed, 'SHOP-1')).toMatchObject({ kind: 'epic', title: 'Checkout', externalStatus: 'In Progress', url: `${trackerBase}/browse/SHOP-1`, trackerId });
    expect(byKey(listed, 'SHOP-2')).toMatchObject({ kind: 'story', externalType: 'Story', parentId: byKey(listed, 'SHOP-1').id });
    expect(listed.trackers).toEqual([{ id: trackerId, name: 'Jira', provider: 'jira' }]);
    expect(trackerRequests[0]).toContain('/rest/api/3/search/jql?jql=key+in');
  });

  it('imports the project\'s epics and stories with no keys, and updates on a second import or a sync', async () => {
    const trackerId = await addTracker('jira');
    const { body: story } = await create({ key: 'shop-3', title: 'Typed by hand' });
    await link(story.id, [{ type: 'ui', id: loginTest }]);
    const first = (await request(app).post('/api/requirements/import').send({ trackerId })).body;
    expect(first).toMatchObject({ created: ['SHOP-1', 'SHOP-2'], updated: ['SHOP-3'] });
    expect(decodeURIComponent(trackerRequests[0].replace(/\+/g, ' '))).toContain('project = "SHOP" AND issuetype in (Epic, Story)');

    jiraIssues['SHOP-3'].summary = 'Pay by invoice, renamed';
    const synced = (await request(app).post('/api/requirements/sync').send({ trackerId })).body;
    expect(synced).toMatchObject({ created: [], updated: expect.arrayContaining(['SHOP-1', 'SHOP-2', 'SHOP-3']) });
    const after = await request(app).get(`/api/requirements/${story.id}`);
    // Its links survive: an import changes what a requirement says, not what covers it.
    expect(after.body).toMatchObject({ key: 'shop-3', title: 'Pay by invoice, renamed', trackerId, tests: [{ type: 'ui', id: loginTest, name: 'Login' }] });
    jiraIssues['SHOP-3'].summary = 'Pay by invoice';
  });

  it('reads Azure DevOps work items with a WIQL query', async () => {
    const trackerId = await addTracker('azure_devops');
    const { body } = await request(app).post('/api/requirements/import').send({ trackerId }).expect(200);
    expect(body.created).toEqual(['100', '101']);
    const listed = (await request(app).get('/api/requirements')).body;
    expect(byKey(listed, '101')).toMatchObject({ kind: 'story', title: 'Return a parcel', externalStatus: 'New', url: `${trackerBase}/acme/Shop/_workitems/edit/101`, parentId: byKey(listed, '100').id });
    expect(trackerRequests.some((r) => r.startsWith('POST /acme/Shop/_apis/wit/wiql'))).toBe(true);
  });

  it("says what the tracker said when it refuses, and does not read another organization's tracker", async () => {
    const trackerId = await addTracker('jira');
    jiraRefuses = true;
    const refused = await request(app).post('/api/requirements/import').send({ trackerId });
    expect(refused.status).toBe(502);
    expect(refused.body.error).toMatch(/^Jira: Searching Jira failed \(401\): Client must be authenticated/);

    currentUser = otherOrg;
    expect((await request(app).post('/api/requirements/import').send({ trackerId })).status).toBe(404);
  });
});
