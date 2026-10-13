import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * "Start with a sample project", through the route and the real tenancy middleware: what it
 * creates, that it creates it once, who may, and what happens to its first run.
 */

vi.mock('../../platform/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  },
  updateLogLevel: vi.fn(),
}));
const runTestPlan = vi.fn();
vi.mock('../../execution/test-execution-service', () => ({ runTestPlan }));

const { privilegedDb } = await import('../../platform/db');
const {
  apiTests,
  auditLog,
  organizations,
  projects,
  testPlans,
  testPlanSelectedTests,
  testVersions,
  tests,
  users,
} = await import('@shared/schema');
const { createTestOrganization } = await import('../../tests/factories');
const { tenancyMiddleware } = await import('../../platform/middleware/tenancy');
const { default: sampleProjectRoutes, demoShopUrl } = await import('./sample-project.routes');
const { FAILING_TEST, FIRST_RUN_PLAN, SAMPLE_PROJECT_NAME } =
  await import('../../authoring/sample-project');

type Person = { id: number; username: string; organizationId: number; role: string };
let app: express.Express;
let current: Person;
let org: number;
let editor: Person;

async function person(role: string, organizationId = org): Promise<Person> {
  const [row] = await privilegedDb
    .insert(users)
    .values({ username: `sample-${role}-${Math.random()}`, password: 'x', organizationId, role })
    .returning();
  return { id: row.id, username: row.username, organizationId, role };
}

const as = (who: Person) => {
  current = who;
  return request(app);
};

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = current;
    (req as any).isAuthenticated = () => true;
    next();
  });
  app.use(tenancyMiddleware);
  app.use(sampleProjectRoutes);
});

beforeEach(async () => {
  org = await createTestOrganization('Sample Org');
  editor = await person('editor');
  runTestPlan.mockReset();
  runTestPlan.mockResolvedValue({ id: 'run-1', status: 'queued' });
  vi.stubEnv('WEBFLOW_PUBLIC_URL', 'https://wfm.example.test/');
  vi.stubEnv('DEMO_SHOP_URL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/sample-project', () => {
  it('offers the sample to an organization with no tests, and only then', async () => {
    expect((await as(editor).get('/api/sample-project')).body).toEqual({ offered: true });
    await as(editor).post('/api/sample-project').send({ run: false });
    expect((await as(editor).get('/api/sample-project')).body).toEqual({ offered: false });

    const busy = await createTestOrganization('Busy Org');
    const someone = await person('editor', busy);
    await privilegedDb.insert(tests).values({
      name: 'Their own test',
      url: 'https://example.test',
      sequence: [],
      elements: [],
      userId: someone.id,
      organizationId: busy,
    });
    expect((await as(someone).get('/api/sample-project')).body).toEqual({ offered: false });
  });

  it('is not offered to viewers, who could not create it', async () => {
    expect((await as(await person('viewer')).get('/api/sample-project')).status).toBe(403);
  });
});

describe('POST /api/sample-project', () => {
  it('creates the project, its tests and plans, and starts the first plan', async () => {
    const res = await as(editor).post('/api/sample-project').send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tests: 5, apiTests: 3, run: { id: 'run-1' } });
    expect(res.body.plans).toHaveLength(4);

    const [project] = await privilegedDb
      .select()
      .from(projects)
      .where(and(eq(projects.organizationId, org), eq(projects.name, SAMPLE_PROJECT_NAME)));
    expect(project.id).toBe(res.body.projectId);

    const web = await privilegedDb.select().from(tests).where(eq(tests.organizationId, org));
    expect(web).toHaveLength(5);
    expect(web.every((t) => t.projectId === project.id)).toBe(true);
    // At this server's public address, which the runners reach.
    expect(web.every((t) => t.url.startsWith('https://wfm.example.test/demo-shop/'))).toBe(true);

    const api = await privilegedDb.select().from(apiTests).where(eq(apiTests.organizationId, org));
    expect(api.map((t) => t.url).sort()).toEqual([
      'https://wfm.example.test/demo-shop/api/health',
      'https://wfm.example.test/demo-shop/api/orders',
      'https://wfm.example.test/demo-shop/api/orders/{{orderId}}',
    ]);

    // Version 1 of every test, as when a person saves one.
    const versions = await privilegedDb
      .select()
      .from(testVersions)
      .where(eq(testVersions.organizationId, org));
    expect(versions).toHaveLength(8);

    const plans = await privilegedDb
      .select()
      .from(testPlans)
      .where(eq(testPlans.organizationId, org));
    const first = plans.find((p) => p.name === FIRST_RUN_PLAN)!;
    expect(runTestPlan).toHaveBeenCalledWith(first.id, editor.id, {});
    const selected = await privilegedDb
      .select()
      .from(testPlanSelectedTests)
      .where(
        inArray(
          testPlanSelectedTests.testPlanId,
          plans.map((p) => p.id),
        ),
      );
    expect(selected).toHaveLength(3 + 4 + 3 + 2);
    // The failing test is only in the plan that says it fails on purpose.
    const failing = web.find((t) => t.name === FAILING_TEST)!;
    const withFailing = selected.filter((s) => s.testId === failing.id).map((s) => s.testPlanId);
    expect(plans.filter((p) => withFailing.includes(p.id)).map((p) => p.name)).toEqual([
      'Sample · Catalog checks (fails on purpose)',
    ]);

    const audited = await privilegedDb
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.organizationId, org));
    expect(audited).toHaveLength(1 + 5 + 3 + 4);
  });

  it('is created once per organization', async () => {
    expect((await as(editor).post('/api/sample-project').send({ run: false })).status).toBe(201);
    const again = await as(editor).post('/api/sample-project').send({ run: false });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('sample_exists');

    // Another organization gets its own.
    const other = await person('editor', await createTestOrganization('Other Sample Org'));
    expect((await as(other).post('/api/sample-project').send({ run: false })).status).toBe(201);
  });

  it('refuses while tests of a deleted sample are still there', async () => {
    await as(editor).post('/api/sample-project').send({ run: false });
    await privilegedDb
      .delete(projects)
      .where(and(eq(projects.organizationId, org), eq(projects.name, SAMPLE_PROJECT_NAME)));
    const again = await as(editor).post('/api/sample-project').send({ run: false });
    expect(again.status).toBe(409);
    expect(again.body.projectId).toBeNull();
  });

  it('does not start a run when asked not to', async () => {
    const res = await as(editor).post('/api/sample-project').send({ run: false });
    expect(res.status).toBe(201);
    expect(res.body.run).toBeNull();
    expect(runTestPlan).not.toHaveBeenCalled();
  });

  it('keeps the project and says why when the first run cannot start', async () => {
    runTestPlan.mockResolvedValue({ error: 'No runner is available', status: 503 });
    const res = await as(editor).post('/api/sample-project').send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ run: null, runError: 'No runner is available' });
  });

  it('does not start a run that would fail every test as unpublished', async () => {
    await privilegedDb
      .update(organizations)
      .set({ testReviewRequired: true })
      .where(eq(organizations.id, org));
    const res = await as(editor).post('/api/sample-project').send({});
    expect(res.status).toBe(201);
    expect(res.body.run).toBeNull();
    expect(res.body.runError).toMatch(/requires review/);
    expect(runTestPlan).not.toHaveBeenCalled();
  });

  it('is for editors and owners', async () => {
    const viewer = await person('viewer');
    expect((await as(viewer).post('/api/sample-project').send({})).status).toBe(403);
  });

  it('rejects unknown fields', async () => {
    const res = await as(editor).post('/api/sample-project').send({ shopUrl: 'http://evil' });
    expect(res.status).toBe(400);
  });
});

describe('demoShopUrl', () => {
  const req = { protocol: 'http', get: () => 'localhost:5000' } as any;

  it('prefers DEMO_SHOP_URL, then the public address, then the request', () => {
    expect(demoShopUrl(req, { DEMO_SHOP_URL: 'http://wfm-api:5000/demo-shop/' })).toBe(
      'http://wfm-api:5000/demo-shop',
    );
    expect(demoShopUrl(req, { WEBFLOW_PUBLIC_URL: 'https://wfm.example.test' })).toBe(
      'https://wfm.example.test/demo-shop',
    );
    expect(demoShopUrl(req, {})).toBe('http://localhost:5000/demo-shop');
  });
});

describe('the sample tests and the shop pages', () => {
  const shopDir = path.resolve(__dirname, '../../../client/public/demo-shop');

  it('every #id a sample web test uses is on the page it opens', async () => {
    const created = await as(editor).post('/api/sample-project').send({ run: false });
    expect(created.status).toBe(201);
    const web = await privilegedDb.select().from(tests).where(eq(tests.organizationId, org));
    for (const test of web) {
      const page = new URL(test.url).pathname.replace(/^\/demo-shop\//, '');
      const html = fs.readFileSync(path.join(shopDir, page, 'index.html'), 'utf8');
      for (const s of test.sequence as { targetElement?: { selector: string } }[]) {
        const id = s.targetElement?.selector.match(/^#([\w-]+)$/)?.[1];
        if (id) expect(html, `${test.name}: #${id}`).toContain(`id="${id}"`);
      }
    }
  });
});
