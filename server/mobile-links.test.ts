import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import {
  mobileTests,
  reportTestCaseResults,
  requirementTests,
  requirements,
  testCaseLinks,
  testManagementConnections,
  testPlanExecutions,
  testPlans,
  testSuiteItems,
  testSuites,
  tests,
} from '@shared/schema';
import { encryptSecret } from './crypto';
import { createTestOrganization, createTestUser } from './tests/factories';
import { casesOf } from './test-management';
import { testsOfSuite } from './test-suites';

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * Mobile app tests where web and API tests already go (migration 0054): in a static suite, as a
 * requirement's coverage, and linked to a case of a test management tool — with the same checks
 * on what the requester may name.
 */

type User = { id: number; username: string; organizationId: number; role: string };

let app: express.Express;
let organizationId: number;
let editor: User;
let otherOrg: User;
let currentUser: User;
let webTest: number;
let mobileTest: number;
let foreignMobileTest: number;

beforeAll(async () => {
  organizationId = await createTestOrganization('Mobile Links Org');
  editor = { id: await createTestUser(organizationId, 'links-editor'), username: 'links-editor', organizationId, role: 'editor' };
  const otherOrganizationId = await createTestOrganization('Other Mobile Links Org');
  otherOrg = { id: await createTestUser(otherOrganizationId, 'links-other'), username: 'links-other', organizationId: otherOrganizationId, role: 'owner' };

  webTest = (await privilegedDb.insert(tests).values({ name: 'Login on the web', url: 'https://shop.test', sequence: [], elements: [], userId: editor.id, organizationId } as any).returning())[0].id;
  const mobile = (values: Record<string, unknown>) =>
    privilegedDb.insert(mobileTests).values({ platform: 'android', app: 'bs://app', deviceName: 'Google Pixel 8', steps: [], ...values } as any).returning();
  mobileTest = (await mobile({ name: 'Login on Android [C21]', organizationId }))[0].id;
  foreignMobileTest = (await mobile({ name: 'Theirs', organizationId: otherOrganizationId }))[0].id;

  const { default: suites } = await import('./routes/suites.routes');
  const { default: requirementRoutes } = await import('./routes/requirements.routes');
  const { default: testManagement } = await import('./routes/test-management.routes');
  const { runWithTenant } = await import('./middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), { userId: currentUser.id, role: currentUser.role });
  });
  app.use(suites, requirementRoutes, testManagement);
});

beforeEach(() => {
  currentUser = editor;
});

describe('a static suite', () => {
  it('holds a mobile test beside a web test, names it, and runs it in a plan', async () => {
    const created = await request(app)
      .post('/api/suites')
      .send({ name: `Mobile smoke ${uuidv4().slice(0, 6)}`, kind: 'static', items: [{ type: 'ui', id: webTest }, { type: 'mobile', id: mobileTest }] });
    expect(created.status).toBe(201);

    const suite = await request(app).get(`/api/suites/${created.body.id}`);
    expect(suite.body.tests).toEqual([
      { type: 'ui', id: webTest, name: 'Login on the web' },
      { type: 'mobile', id: mobileTest, name: 'Login on Android [C21]' },
    ]);
    const [row] = await privilegedDb.select().from(testSuites).where(eq(testSuites.id, created.body.id));
    expect(await testsOfSuite(privilegedDb as any, row)).toContainEqual({ testType: 'mobile', testId: null, apiTestId: null, mobileTestId: mobileTest });
  });

  it('refuses a mobile test of another organization, and the database refuses a row naming two tests', async () => {
    const foreign = await request(app).post('/api/suites').send({ name: 'Foreign', kind: 'static', items: [{ type: 'mobile', id: foreignMobileTest }] });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toBe('One or more mobile tests do not exist.');

    const [suite] = await privilegedDb.insert(testSuites).values({ organizationId, name: `Raw ${uuidv4().slice(0, 6)}`, kind: 'static' } as any).returning();
    await expect(
      privilegedDb.insert(testSuiteItems).values({ organizationId, suiteId: suite.id, testType: 'mobile', testId: webTest, mobileTestId: mobileTest, position: 0 }),
    ).rejects.toThrow();
  });
});

describe('a requirement', () => {
  it('is covered by a mobile test, whose latest result counts', async () => {
    const key = `MOB-${uuidv4().slice(0, 6)}`;
    const created = await request(app).post('/api/requirements').send({ key, title: 'Sign in on the phone', kind: 'story' });
    expect(created.status).toBe(201);
    const linked = await request(app).put(`/api/requirements/${created.body.id}/tests`).send({ items: [{ type: 'mobile', id: mobileTest }] });
    expect(linked.status).toBe(200);
    expect(linked.body).toEqual([{ type: 'mobile', id: mobileTest, name: 'Login on Android [C21]' }]);

    const planId = uuidv4();
    await privilegedDb.insert(testPlans).values({ id: planId, name: 'Phones', userId: editor.id, organizationId } as any);
    const executionId = uuidv4();
    await privilegedDb.insert(testPlanExecutions).values({ id: executionId, organizationId, testPlanId: planId, status: 'completed', triggeredBy: 'manual', completedAt: new Date() } as any);
    await privilegedDb.insert(reportTestCaseResults).values({
      id: uuidv4(), organizationId, testPlanExecutionId: executionId, testType: 'mobile', mobileTestId: mobileTest,
      testName: 'Login on Android [C21]', browser: 'Google Pixel 8', status: 'Failed', startedAt: new Date(),
    } as any);

    const list = await request(app).get('/api/requirements');
    const mine = list.body.requirements.find((r: any) => r.key === key);
    expect(mine.coverage).toMatchObject({ state: 'failing', failed: 1 });
    expect(mine.coverage.tests[0]).toMatchObject({ type: 'mobile', id: mobileTest, outcome: 'failed', lastRun: { executionId } });

    const csv = await request(app).get('/api/requirements/matrix.csv');
    expect(csv.text).toContain('Login on Android [C21],mobile,failed');

    // Unlinked again: the link row goes, the test stays.
    await request(app).put(`/api/requirements/${created.body.id}/tests`).send({ items: [] });
    expect(await privilegedDb.select().from(requirementTests).where(eq(requirementTests.requirementId, created.body.id))).toEqual([]);
  });

  it('refuses a mobile test of another organization', async () => {
    const created = await request(app).post('/api/requirements').send({ key: `MOB-${uuidv4().slice(0, 6)}`, title: 'Theirs', kind: 'story' });
    const res = await request(app).put(`/api/requirements/${created.body.id}/tests`).send({ items: [{ type: 'mobile', id: foreignMobileTest }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('One or more mobile tests do not exist.');
  });
});

describe('a test management case', () => {
  it('is linked to a mobile test, and its results are published to that case', async () => {
    const id = uuidv4();
    const token = encryptSecret('tr-key');
    await privilegedDb.insert(testManagementConnections).values({
      id, organizationId, name: `TestRail ${id.slice(0, 6)}`, provider: 'testrail', baseUrl: 'https://tr.test', projectKey: '3',
      encryptedToken: token.encryptedValue, tokenIv: token.iv, tokenAuthTag: token.authTag,
    } as any);

    const listed = await request(app).get(`/api/test-management/${id}/cases`);
    expect(listed.body.tests).toContainEqual({ type: 'mobile', id: mobileTest, name: 'Login on Android [C21]', caseKey: null, fromName: 'C21' });
    expect(listed.body.tests.some((t: any) => t.id === foreignMobileTest && t.type === 'mobile')).toBe(false);

    const saved = await request(app).put(`/api/test-management/${id}/cases`).send({ links: [{ type: 'mobile', id: mobileTest, caseKey: 'c30' }] });
    expect(saved.status).toBe(200);
    const [link] = await privilegedDb.select().from(testCaseLinks).where(eq(testCaseLinks.connectionId, id));
    expect(link).toMatchObject({ testType: 'mobile', mobileTestId: mobileTest, testId: null, apiTestId: null, caseKey: 'C30' });
    expect((await request(app).get(`/api/test-management/${id}/cases`)).body.tests).toContainEqual(expect.objectContaining({ type: 'mobile', id: mobileTest, caseKey: 'C30' }));

    const foreign = await request(app).put(`/api/test-management/${id}/cases`).send({ links: [{ type: 'mobile', id: foreignMobileTest, caseKey: 'C31' }] });
    expect(foreign.status).toBe(400);
  });

  it('publishes a mobile result to its linked case, the link winning over the name', () => {
    const at = new Date('2026-09-30T02:00:00Z');
    const { cases, unmapped } = casesOf(
      'testrail',
      [
        { uiTestId: null, apiTestId: null, mobileTestId: mobileTest, testName: 'Login on Android [C21]', browser: 'Google Pixel 8 · 14.0', status: 'Failed', reasonForFailure: 'No visible element ~login within 15s.', startedAt: at, completedAt: at, durationMs: 1000 },
      ],
      (type, id) => (type === 'mobile' && id === mobileTest ? 'C30' : undefined),
      'Report: …',
    );
    expect(unmapped).toEqual([]);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ caseKey: 'C30', outcome: 'failed' });
    expect(cases[0].comment).toContain('Login on Android [C21] (Google Pixel 8 · 14.0): Failed');
  });
});

describe('another organization', () => {
  it('sees none of it', async () => {
    currentUser = otherOrg;
    const suites = await request(app).get('/api/suites');
    expect(suites.body.every((s: any) => s.organizationId !== organizationId)).toBe(true);
  });
});
