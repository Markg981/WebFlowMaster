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
  reportTestCaseResults,
  testCaseLinks,
  testManagementConnections,
  testManagementPublications,
  testPlanExecutions,
  testPlans,
  tests,
} from '@shared/schema';
import { caseKeyFromName, normaliseCaseKey } from '@shared/test-management';
import { decryptSecret } from '../crypto';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { testRailElapsed, zephyrStatusName } from '../test-management-providers';

vi.mock('../logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * Publishing runs to TestRail, Xray and Zephyr Scale: the connections, which case each test is,
 * and what each tool receives — checked against local servers that answer as the tools do.
 */

type User = { id: number; username: string; organizationId: number; role: string };

let app: express.Express;
let organizationId: number;
let editor: User;
let otherOrg: User;
let currentUser: User;
let loginTest: number;
let checkoutTest: number;
let unmappedTest: number;
let ordersApi: number;
let planId: string;

// ─── The tools ────────────────────────────────────────────────────────────────

interface Seen {
  method: string;
  path: string;
  authorization?: string;
  body: any;
}
let seen: Seen[] = [];
let xray2Missing = false;

const tools = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    const path = req.url!;
    seen.push({ method: req.method!, path, authorization: req.headers.authorization, body });
    const reply = (status: number, answer: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer));

    // TestRail: everything under index.php?/api/v2/.
    if (path === '/index.php?/api/v2/get_project/3') return reply(200, { id: 3, name: 'Shop' });
    if (path.startsWith('/index.php?/api/v2/get_project/')) return reply(400, { error: 'Field :project_id is not a valid or accessible project.' });
    if (path === '/index.php?/api/v2/add_run/3') {
      if (body.case_ids.includes(999)) return reply(400, { error: 'Field :case_ids contains one or more invalid case IDs.' });
      return reply(200, { id: 77, url: `${base}/index.php?/runs/view/77` });
    }
    if (path === '/index.php?/api/v2/add_results_for_cases/77') return reply(200, []);

    // Xray Cloud.
    if (path === '/api/v2/authenticate') return body.client_secret === 'xray-secret' ? reply(200, 'xray-token-1') : reply(401, { error: 'Authentication failed' });
    if (path === '/api/v2/import/execution') return reply(200, { id: '10900', key: 'SHOP-900', self: 'https://acme.atlassian.net/rest/api/2/issue/10900' });

    // Xray Server / Data Center, under /jira.
    if (path === '/jira/rest/raven/2.0/import/execution' && xray2Missing) return reply(404, {});
    if (path.startsWith('/jira/rest/raven/')) return reply(200, { testExecIssue: { id: '20901', key: 'SHOP-901' } });
    if (path === '/jira/rest/api/2/project/SHOP') return reply(200, { key: 'SHOP', name: 'Shop' });

    // Zephyr Scale, under /v2.
    if (path.startsWith('/v2/statuses')) return reply(200, { values: [{ name: 'Pass' }, { name: 'Fail' }, { name: 'Blocked' }, { name: 'Not Executed' }, { name: 'Old', archived: true }] });
    if (path === '/v2/testcycles') return reply(201, { id: 5, key: 'SHOP-R5' });
    if (path === '/v2/testexecutions') return body.testCaseKey === 'SHOP-T404' ? reply(400, { message: 'Test case not found' }) : reply(201, { id: 1 });
    reply(404, {});
  });
});
let base: string;

// ─── The run ──────────────────────────────────────────────────────────────────

async function seedRun(status = 'completed') {
  const executionId = uuidv4();
  const at = new Date('2026-09-30T02:00:00Z');
  await privilegedDb.insert(testPlanExecutions).values({ id: executionId, organizationId, testPlanId: planId, status, triggeredBy: 'manual', startedAt: at, completedAt: at } as any);
  const row = (values: Record<string, unknown>) =>
    privilegedDb.insert(reportTestCaseResults).values({
      id: uuidv4(), testPlanExecutionId: executionId, organizationId, testType: values.apiTestId ? 'api' : 'ui', startedAt: at, completedAt: new Date(at.getTime() + 65_000), durationMs: 65_000, ...values,
    } as any);
  await row({ uiTestId: loginTest, testName: 'Login [C11]', status: 'Passed', browser: 'chromium' });
  await row({ uiTestId: loginTest, testName: 'Login [C11]', status: 'Passed', browser: 'firefox' });
  await row({ uiTestId: checkoutTest, testName: 'Checkout', status: 'Passed', browser: 'chromium' });
  await row({ uiTestId: checkoutTest, testName: 'Checkout', status: 'Failed', browser: 'firefox', reasonForFailure: 'Timeout 5000ms waiting for #pay' });
  await row({ apiTestId: ordersApi, testName: 'Orders API', status: 'Pending' });
  await row({ uiTestId: unmappedTest, testName: 'Search', status: 'Failed', browser: 'chromium' });
  return executionId;
}

beforeAll(async () => {
  organizationId = await createTestOrganization('Test Management Org');
  const ownerId = await createTestUser(organizationId, 'tm-owner');
  editor = { id: await createTestUser(organizationId, 'tm-editor'), username: 'tm-editor', organizationId, role: 'editor' };
  const otherOrganizationId = await createTestOrganization('Other Test Management Org');
  otherOrg = { id: await createTestUser(otherOrganizationId, 'tm-other'), username: 'tm-other', organizationId: otherOrganizationId, role: 'owner' };

  const makeTest = async (name: string) =>
    (await privilegedDb.insert(tests).values({ name, url: 'https://shop.test', sequence: [], elements: [], userId: ownerId, organizationId } as any).returning())[0].id;
  loginTest = await makeTest('Login [C11]');
  checkoutTest = await makeTest('Checkout');
  unmappedTest = await makeTest('Search');
  ordersApi = (await privilegedDb.insert(apiTests).values({ name: 'Orders API', method: 'GET', url: 'https://shop.test/api', userId: ownerId, organizationId } as any).returning())[0].id;
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Nightly', userId: ownerId, organizationId } as any);

  await new Promise<void>((resolve) => tools.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(tools.address() as AddressInfo).port}`;

  const { default: routes } = await import('./test-management.routes');
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
  await new Promise<void>((resolve) => tools.close(() => resolve()));
});

beforeEach(async () => {
  await privilegedDb.update(testPlans).set({ testManagementId: null });
  await privilegedDb.delete(testManagementPublications);
  await privilegedDb.delete(reportTestCaseResults);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testCaseLinks);
  await privilegedDb.delete(testManagementConnections);
  currentUser = editor;
  seen = [];
  xray2Missing = false;
});

const connect = (body: Record<string, unknown>) => request(app).post('/api/test-management').send(body);
const testRailOf = () => ({ name: 'TestRail', provider: 'testrail', baseUrl: base, username: 'qa@acme.test', projectKey: '3', token: 'tr-key-123' });
const link = (id: string, links: Array<{ type: 'ui' | 'api'; id: number; caseKey: string | null }>) => request(app).put(`/api/test-management/${id}/cases`).send({ links });
const calls = (fragment: string) => seen.filter((s) => s.path.includes(fragment));

describe('case keys', () => {
  it('are read the way each tool writes them, and from a test name', () => {
    expect(normaliseCaseKey('testrail', 'c12')).toBe('C12');
    expect(normaliseCaseKey('testrail', '12')).toBe('C12');
    expect(normaliseCaseKey('testrail', 'SHOP-12')).toBeNull();
    expect(normaliseCaseKey('xray_cloud', 'shop-45')).toBe('SHOP-45');
    expect(normaliseCaseKey('zephyr_scale', 'SHOP-45')).toBeNull();
    expect(normaliseCaseKey('zephyr_scale', 'shop-t12')).toBe('SHOP-T12');
    expect(caseKeyFromName('testrail', 'Login [smoke] [C11]')).toBe('C11');
    expect(caseKeyFromName('zephyr_scale', '[SHOP-T12] Checkout')).toBe('SHOP-T12');
    expect(caseKeyFromName('xray_cloud', 'Checkout')).toBeNull();
    expect(testRailElapsed(65_000)).toBe('1m 5s');
    expect(testRailElapsed(200)).toBe('1s');
    expect(zephyrStatusName('passed', ['Passed', 'Failed'])).toBe('Passed');
    expect(zephyrStatusName('skipped', ['Pass', 'Fail'])).toBeNull();
  });
});

describe('connections', () => {
  it('keep the token encrypted and never send it back, and say what each tool needs', async () => {
    const created = await connect(testRailOf()).expect(201);
    expect(created.body).toMatchObject({ provider: 'testrail', projectKey: '3', hasToken: true, baseUrl: base });
    expect(JSON.stringify(created.body)).not.toContain('tr-key-123');
    const [row] = await privilegedDb.select().from(testManagementConnections).where(eq(testManagementConnections.id, created.body.id));
    expect(decryptSecret(row.encryptedToken, row.tokenIv, row.tokenAuthTag)).toBe('tr-key-123');

    expect((await connect({ ...testRailOf(), name: 'x', projectKey: 'SHOP' })).body.error).toMatch(/project is its number/);
    expect((await connect({ ...testRailOf(), name: 'x', username: '' })).body.error).toMatch(/user is required/);
    expect((await connect({ name: 'x', provider: 'xray_cloud', username: 'id', projectKey: 'SHOP' })).body.error).toMatch(/client secret is required/);
    expect((await connect({ ...testRailOf(), name: 'testrail' })).status).toBe(409);

    // Xray Cloud and Zephyr need no address: they have their own.
    const zephyr = await connect({ name: 'Zephyr', provider: 'zephyr_scale', projectKey: 'shop', token: 'z', username: 'ignored' }).expect(201);
    expect(zephyr.body).toMatchObject({ baseUrl: 'https://api.zephyrscale.smartbear.com/v2', projectKey: 'SHOP', username: null });

    // An edit without a token keeps the saved one.
    await request(app).put(`/api/test-management/${created.body.id}`).send({ ...testRailOf(), token: undefined, suiteId: '8' }).expect(200);
    const [kept] = await privilegedDb.select().from(testManagementConnections).where(eq(testManagementConnections.id, created.body.id));
    expect(kept.suiteId).toBe('8');
    expect(decryptSecret(kept.encryptedToken, kept.tokenIv, kept.tokenAuthTag)).toBe('tr-key-123');
  });

  it('are checked by reading the project', async () => {
    const { body: good } = await connect(testRailOf());
    expect((await request(app).post(`/api/test-management/${good.id}/test`)).body).toEqual({ ok: true, detail: 'Connected to Shop.' });
    expect(calls('get_project/3')[0].authorization).toBe(`Basic ${Buffer.from('qa@acme.test:tr-key-123').toString('base64')}`);
    const { body: wrong } = await connect({ ...testRailOf(), name: 'Wrong', projectKey: '4' });
    expect((await request(app).post(`/api/test-management/${wrong.id}/test`)).body).toMatchObject({ ok: false, detail: expect.stringMatching(/no project "4"/) });
    const { body: xray } = await connect({ name: 'Xray', provider: 'xray_cloud', baseUrl: base, username: 'client-1', projectKey: 'SHOP', token: 'nope' });
    expect((await request(app).post(`/api/test-management/${xray.id}/test`)).body).toMatchObject({ ok: false, detail: expect.stringMatching(/refused the client id/) });
  });

  it("are not another organization's, and are changed by editors only", async () => {
    const { body } = await connect(testRailOf());
    currentUser = otherOrg;
    expect((await request(app).get('/api/test-management')).body).toEqual([]);
    expect((await request(app).get(`/api/test-management/${body.id}/cases`)).status).toBe(404);
    expect((await request(app).delete(`/api/test-management/${body.id}`)).status).toBe(404);
    currentUser = { ...editor, role: 'viewer' };
    expect((await request(app).get('/api/test-management')).body).toHaveLength(1);
    expect((await connect({ ...testRailOf(), name: 'x' })).status).toBe(403);
    expect((await link(body.id, [])).status).toBe(403);
  });
});

describe('which case each test is', () => {
  it('lists every test with its link and the key its name carries, and changes only the tests named', async () => {
    const { body: conn } = await connect(testRailOf());
    expect((await link(conn.id, [{ type: 'ui', id: checkoutTest, caseKey: 'c12' }, { type: 'api', id: ordersApi, caseKey: '13' }])).body).toEqual({ changed: 2 });
    expect((await link(conn.id, [{ type: 'ui', id: checkoutTest, caseKey: 'SHOP-1' }])).body.error).toMatch(/Not a case key of this tool \(like C123\): SHOP-1/);

    const { body } = await request(app).get(`/api/test-management/${conn.id}/cases`).expect(200);
    const of = (type: string, id: number) => body.tests.find((t: any) => t.type === type && t.id === id);
    expect(of('ui', loginTest)).toMatchObject({ caseKey: null, fromName: 'C11' });
    expect(of('ui', checkoutTest)).toMatchObject({ caseKey: 'C12', fromName: null });
    expect(of('api', ordersApi)).toMatchObject({ caseKey: 'C13' });

    await link(conn.id, [{ type: 'api', id: ordersApi, caseKey: null }]);
    expect((await request(app).get(`/api/test-management/${conn.id}/cases`)).body.tests.find((t: any) => t.type === 'ui' && t.id === checkoutTest).caseKey).toBe('C12');
    expect(await privilegedDb.select().from(testCaseLinks)).toHaveLength(1);
  });
});

describe('publishing a run', () => {
  it('to TestRail: a run of the mapped cases, one result each, every browser in the comment', async () => {
    const { body: conn } = await connect({ ...testRailOf(), suiteId: '8' });
    await link(conn.id, [{ type: 'ui', id: checkoutTest, caseKey: 'C12' }, { type: 'api', id: ordersApi, caseKey: 'C13' }]);
    const executionId = await seedRun();

    const published = await request(app).post(`/api/test-plan-executions/${executionId}/publish`).send({ connectionId: conn.id }).expect(200);
    expect(published.body).toMatchObject({
      status: 'published', externalKey: 'R77', externalUrl: `${base}/index.php?/runs/view/77`, publishedCount: 2, unmappedCount: 1, connectionName: 'TestRail', requestedBy: editor.id,
    });

    const run = calls('add_run/3')[0].body;
    expect(run).toMatchObject({ include_all: false, suite_id: 8, name: 'Nightly — 2026-09-30 02:00 UTC' });
    expect(run.case_ids.sort()).toEqual([11, 12, 13]);
    expect(run.description).toContain('Not published, no case linked: Search');

    const results = calls('add_results_for_cases/77')[0].body.results;
    // The manual API test waiting for its verdict stays untested: TestRail takes no such result.
    expect(results.map((r: any) => [r.case_id, r.status_id]).sort()).toEqual([[11, 1], [12, 5]]);
    const checkout = results.find((r: any) => r.case_id === 12);
    expect(checkout.comment).toContain('Checkout (chromium): Passed');
    expect(checkout.comment).toContain('Checkout (firefox): Failed');
    expect(checkout.comment).toContain('Timeout 5000ms waiting for #pay');
    expect(checkout.comment).toMatch(/Report: .*\/executions\/.*\/report/);
    expect(checkout.elapsed).toBe('1m 5s');

    const listed = await request(app).get(`/api/test-plan-executions/${executionId}/publications`).expect(200);
    expect(listed.body).toHaveLength(1);
    const [audit] = await privilegedDb.select().from(auditLog).where(eq(auditLog.targetId, executionId));
    expect(audit.action).toBe('test_management.run_published');
  });

  it('to Xray Cloud at the end of a run, as the plan says, with a token for the client id', async () => {
    const { body: conn } = await connect({ name: 'Xray', provider: 'xray_cloud', baseUrl: base, username: 'client-1', projectKey: 'SHOP', testPlanKey: 'shop-100', token: 'xray-secret' });
    await link(conn.id, [{ type: 'ui', id: loginTest, caseKey: 'SHOP-45' }, { type: 'ui', id: checkoutTest, caseKey: 'SHOP-46' }]);
    const executionId = await seedRun();
    // As the run was queued: the plan publishes to Xray, and the snapshot says so.
    await privilegedDb.update(testPlans).set({ testManagementId: conn.id }).where(eq(testPlans.id, planId));
    const [plan] = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, planId));
    const { buildExecutionSnapshot } = await import('../execution-snapshot');
    await privilegedDb.update(testPlanExecutions).set({ configurationSnapshot: buildExecutionSnapshot(plan, []) as any }).where(eq(testPlanExecutions.id, executionId));
    // Changing the plan afterwards does not move a run already made.
    await privilegedDb.update(testPlans).set({ testManagementId: null }).where(eq(testPlans.id, planId));

    const { publishExecution } = await import('../test-management');
    const { runWithTenant } = await import('../middleware/tenancy');
    const publication = await runWithTenant(organizationId, () => publishExecution(executionId));
    expect(publication).toMatchObject({ status: 'published', externalKey: 'SHOP-900', externalUrl: 'https://acme.atlassian.net/browse/SHOP-900', requestedBy: null, unmappedCount: 2 });

    expect(calls('/api/v2/authenticate')[0].body).toEqual({ client_id: 'client-1', client_secret: 'xray-secret' });
    const imported = calls('/api/v2/import/execution')[0];
    expect(imported.authorization).toBe('Bearer xray-token-1');
    expect(imported.body.info).toMatchObject({ project: 'SHOP', testPlanKey: 'SHOP-100', summary: 'Nightly — 2026-09-30 02:00 UTC' });
    expect(imported.body.tests.map((t: any) => [t.testKey, t.status])).toEqual([['SHOP-45', 'PASSED'], ['SHOP-46', 'FAILED']]);
  });

  it('to Xray Server with a personal access token, on the older endpoint when the newer is missing', async () => {
    xray2Missing = true;
    const { body: conn } = await connect({ name: 'Xray DC', provider: 'xray_server', baseUrl: `${base}/jira`, projectKey: 'SHOP', token: 'pat-1' });
    await link(conn.id, [{ type: 'ui', id: checkoutTest, caseKey: 'SHOP-46' }, { type: 'api', id: ordersApi, caseKey: 'SHOP-47' }]);
    const executionId = await seedRun();
    const { body } = await request(app).post(`/api/test-plan-executions/${executionId}/publish`).send({ connectionId: conn.id }).expect(200);
    expect(body).toMatchObject({ externalKey: 'SHOP-901', externalUrl: `${base}/jira/browse/SHOP-901` });
    const imported = calls('/jira/rest/raven/1.0/import/execution')[0];
    expect(imported.authorization).toBe('Bearer pat-1');
    expect(imported.body.tests.map((t: any) => [t.testKey, t.status])).toEqual([['SHOP-46', 'FAIL'], ['SHOP-47', 'TODO']]);
  });

  it("to Zephyr Scale: a cycle and an execution per case, saying which ones it refused", async () => {
    const { body: conn } = await connect({ name: 'Zephyr', provider: 'zephyr_scale', baseUrl: `${base}/v2`, projectKey: 'SHOP', token: 'z-token' });
    await link(conn.id, [
      { type: 'ui', id: loginTest, caseKey: 'SHOP-T11' },
      { type: 'ui', id: checkoutTest, caseKey: 'SHOP-T12' },
      { type: 'ui', id: unmappedTest, caseKey: 'SHOP-T404' },
    ]);
    const executionId = await seedRun();
    const { body } = await request(app).post(`/api/test-plan-executions/${executionId}/publish`).send({ connectionId: conn.id }).expect(200);
    expect(body).toMatchObject({ status: 'published', externalKey: 'SHOP-R5', publishedCount: 2, message: expect.stringContaining('SHOP-T404') });
    expect(calls('/v2/testcycles')[0]).toMatchObject({ authorization: 'Bearer z-token', body: { projectKey: 'SHOP', name: 'Nightly — 2026-09-30 02:00 UTC' } });
    const executions = calls('/v2/testexecutions').map((c) => [c.body.testCaseKey, c.body.statusName, c.body.testCycleKey]);
    expect(executions).toEqual([['SHOP-T11', 'Pass', 'SHOP-R5'], ['SHOP-T12', 'Fail', 'SHOP-R5'], ['SHOP-T404', 'Fail', 'SHOP-R5']]);
    expect(calls('/v2/testexecutions')[1].body.executionTime).toBe(65_000);
  });

  it('records what went wrong, and refuses a run still going or with nowhere to go', async () => {
    const { body: conn } = await connect(testRailOf());
    await link(conn.id, [{ type: 'ui', id: checkoutTest, caseKey: 'C999' }]);
    const executionId = await seedRun();

    const failed = await request(app).post(`/api/test-plan-executions/${executionId}/publish`).send({ connectionId: conn.id });
    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({ status: 'failed', message: 'Creating the TestRail run failed (400): Field :case_ids contains one or more invalid case IDs.' });

    // Nothing linked for Xray: nothing is sent, and the record says why.
    const { body: xray } = await connect({ name: 'Xray', provider: 'xray_cloud', baseUrl: base, username: 'client-1', projectKey: 'SHOP', token: 'xray-secret' });
    seen = [];
    const nothing = await request(app).post(`/api/test-plan-executions/${executionId}/publish`).send({ connectionId: xray.id }).expect(200);
    expect(nothing.body).toMatchObject({ status: 'nothing_to_publish', unmappedCount: 4, message: expect.stringMatching(/No test of this run is linked to a case/) });
    expect(seen).toEqual([]);

    expect((await request(app).post(`/api/test-plan-executions/${executionId}/publish`).send({})).body.error).toMatch(/publishes nowhere/);
    const running = await seedRun('running');
    expect((await request(app).post(`/api/test-plan-executions/${running}/publish`).send({ connectionId: conn.id })).status).toBe(409);
    currentUser = { ...editor, role: 'viewer' };
    expect((await request(app).post(`/api/test-plan-executions/${executionId}/publish`).send({ connectionId: conn.id })).status).toBe(403);
    expect((await request(app).get(`/api/test-plan-executions/${executionId}/publications`)).body).toHaveLength(2);
  });

  it('stops the plans that used a deleted connection, and keeps what was published', async () => {
    const { body: conn } = await connect(testRailOf());
    await privilegedDb.update(testPlans).set({ testManagementId: conn.id }).where(eq(testPlans.id, planId));
    const executionId = await seedRun();
    await request(app).post(`/api/test-plan-executions/${executionId}/publish`).send({}).expect(200);

    expect((await request(app).delete(`/api/test-management/${conn.id}`)).body).toEqual({ deleted: true, plansStoppedPublishing: 1 });
    const [plan] = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, planId));
    expect(plan.testManagementId).toBeNull();
    const [publication] = (await request(app).get(`/api/test-plan-executions/${executionId}/publications`)).body;
    expect(publication).toMatchObject({ connectionId: null, connectionName: 'TestRail', externalKey: 'R77' });
  });
});
