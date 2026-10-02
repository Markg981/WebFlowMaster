import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Application } from 'express';
import { eq } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { privilegedDb } from './db';
import { apiTests, auditLog, projects, testVersions, tests, users, type User } from '@shared/schema';
import { createTestOrganization } from './tests/factories';
import { tenancyMiddleware } from './middleware/tenancy';
import { envName, toPlaywright } from './playwright-export';
import { parseBundle, BundleError } from './test-bundle';

vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn() },
  updateLogLevel: vi.fn(),
}));

/** Tests as files: Playwright code, and a versionable bundle that imports back. */

const step = (id: string, value?: string, selector?: string, frameSelector?: string) => ({
  id: `s-${Math.random()}`,
  action: { id, type: id, name: id, icon: 'x', description: id },
  value,
  targetElement: selector ? { id: 'e', type: 'element', selector, text: '', tag: 'div', attributes: {}, ...(frameSelector ? { frameSelector } : {}) } : undefined,
});

describe('a web test as Playwright', () => {
  it('writes each step as the calls a run makes, variables from the environment', () => {
    const out = toPlaywright({
      name: 'Checkout',
      url: '{{baseUrl}}/cart',
      sequence: [
        step('click', undefined, 'button.pay', 'iframe#checkout >> iframe.card'),
        step('input', '{{cardNumber}}', '#number'),
        step('assertState', 'checked', '#terms'),
        step('if', '{{total}} > 100'),
        step('click', undefined, '#coupon'),
        step('else'),
        step('wait', '500'),
        step('endIf'),
        step('blockRequests', '**/analytics/**'),
      ],
      preconditions: [{ id: 'p', name: 'Create cart', method: 'POST', url: '{{api}}/carts', requestBody: { items: 1 } }],
      cleanups: [{ id: 'c', name: 'Delete cart', method: 'DELETE', url: '{{api}}/carts/{{cartId}}' }],
    });
    expect(out.fileName).toBe('checkout.spec.ts');
    expect(out.variables).toEqual(['api', 'baseUrl', 'cardNumber', 'cartId', 'total']);
    expect(out.code).toContain(`"baseUrl": process.env.${envName('baseUrl')} ?? ''`);
    expect(out.code).toContain(`p.frameLocator("iframe#checkout").frameLocator("iframe.card").locator("button.pay").first().click();`);
    expect(out.code).toContain(`.fill(v("{{cardNumber}}"));`);
    expect(out.code).toContain('toBeChecked()');
    expect(out.code).toMatch(/if \(holds\(v\("\{\{total\}\} > 100"\)\)\) \{\n\s+await p\.locator\("#coupon"\)[^\n]+\n\s+\} else \{\n\s+await p\.waitForTimeout\(500\);\n\s+\}/);
    expect(out.code).toContain(`route.abort('blockedbyclient')`);
    // Setup before, cleanup in a finally.
    expect(out.code.indexOf('precondition Create cart')).toBeLessThan(out.code.indexOf('try {'));
    expect(out.code).toMatch(/\} finally \{\n\s+\/\/ Cleanup, whatever happened\n\s+await request\.fetch\(v\("\{\{api\}\}\/carts\/\{\{cartId\}\}"\), \{ method: "DELETE" \}\)/);
    expect(out.notExported).toEqual([]);
  });

  it('says what it cannot export, in the file and in the result', () => {
    const out = toPlaywright({ name: 'Mail', url: '', sequence: [step('waitForEmail', 'a@example.com'), step('click')] });
    expect(out.notExported).toHaveLength(2);
    expect(out.code).toContain('// 2 step(s) could not be exported');
    expect(out.code).toContain('// Not exported — waitForEmail (a@example.com)');
  });

  it('runs once per dataset row', () => {
    const out = toPlaywright({ name: 'Login', url: 'https://app.example.com', sequence: [step('input', '{{user}}', '#u')], dataset: [{ user: 'ada' }, { user: 'bob' }] });
    expect(out.code).toContain('for (const [index, row] of rows.entries())');
    expect(out.code).toContain('"user": "bob"');
  });
});

describe('the test file', () => {
  let app: Application;
  let user: User;
  let projectId: number;

  beforeAll(async () => {
    app = express();
    app.use('/api/tests/import-bundle', express.json({ limit: '24mb' }));
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = user;
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      next();
    });
    app.use(tenancyMiddleware);
    app.use((await import('./routes/tests.routes')).default);
  });

  async function organization(name: string) {
    const organizationId = await createTestOrganization(name);
    [user] = await privilegedDb.insert(users).values({ username: `${name}-${Date.now()}-${Math.random()}`, password: 'x.y', organizationId, role: 'editor' }).returning();
    [{ id: projectId }] = await privilegedDb.insert(projects).values({ name: 'Shop', userId: user.id, organizationId }).returning();
    return organizationId;
  }

  beforeEach(async () => {
    await privilegedDb.delete(auditLog);
    await privilegedDb.delete(testVersions);
    await privilegedDb.delete(tests);
    await privilegedDb.delete(apiTests);
  });

  it('exports a project as YAML without ids or secrets, and imports it into another organization', async () => {
    const source = await organization('Source');
    await privilegedDb.insert(tests).values({ name: 'Login', url: '{{baseUrl}}', sequence: [step('click', undefined, '#go')], elements: [{ big: true }], userId: user.id, organizationId: source, projectId });
    await privilegedDb.insert(tests).values({ name: 'Elsewhere', url: 'https://x.example', sequence: [], elements: [], userId: user.id, organizationId: source });
    await privilegedDb.insert(apiTests).values({
      name: 'Health', method: 'GET', url: '{{baseUrl}}/health', userId: user.id, organizationId: source, projectId,
      authType: 'bearer', authParams: { type: 'bearer', params: { token: 'literal-token-123' } },
    });

    const exported = await request(app).get('/api/tests/export').query({ projectId }).expect(200);
    expect(exported.headers['content-disposition']).toContain('shop.wfm.yaml');
    expect(exported.headers['x-wfm-secrets-replaced']).toBe('1');
    const yamlText = exported.text;
    expect(yamlText).not.toContain('literal-token-123');
    expect(yamlText).not.toMatch(/organizationId|userId|createdAt|elements/);
    const doc = parseYaml(yamlText);
    expect(doc).toMatchObject({ kind: 'webflowmaster/tests', version: 1, project: 'Shop', tests: [{ name: 'Login' }], apiTests: [{ name: 'Health', authParams: { params: { token: '{{bearer_token}}' } } }] });

    const target = await organization('Target');
    const preview = await request(app).post('/api/tests/import-bundle').send({ content: yamlText, dryRun: true }).expect(200);
    expect(preview.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['created', 'created']);
    expect(await privilegedDb.select().from(tests).where(eq(tests.organizationId, target))).toEqual([]);

    const imported = await request(app).post('/api/tests/import-bundle').send({ content: yamlText, projectId }).expect(201);
    expect(imported.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['created', 'created']);
    const [login] = await privilegedDb.select().from(tests).where(eq(tests.organizationId, target));
    expect(login).toMatchObject({ name: 'Login', projectId, url: '{{baseUrl}}' });
    expect((await privilegedDb.select().from(testVersions).where(eq(testVersions.testId, login.id))).length).toBe(1);

    // Again, unchanged: nothing saved. Changed: an update, and a new version.
    const again = await request(app).post('/api/tests/import-bundle').send({ content: yamlText }).expect(201);
    expect(again.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['unchanged', 'unchanged']);
    const changed = yamlText.replace("url: \"{{baseUrl}}\"", 'url: "{{baseUrl}}/v2"').replace('url: "{{baseUrl}}"', 'url: "{{baseUrl}}/v2"');
    const updated = await request(app).post('/api/tests/import-bundle').send({ content: changed }).expect(201);
    expect(updated.body.results[0]).toMatchObject({ name: 'Login', outcome: 'updated' });
    expect((await privilegedDb.select().from(testVersions).where(eq(testVersions.testId, login.id))).length).toBe(2);
    expect((await privilegedDb.select().from(auditLog).where(eq(auditLog.action, 'test.imported'))).length).toBe(2);
  });

  it('reports a test it cannot take, and refuses what is not a test file', async () => {
    await organization('Strict');
    const content = 'kind: webflowmaster/tests\nversion: 1\ntests:\n  - name: Broken\n    url: https://x.example\n    sequence: "not steps"\n';
    const res = await request(app).post('/api/tests/import-bundle').send({ content }).expect(201);
    expect(res.body.results[0]).toMatchObject({ name: 'Broken', outcome: 'invalid' });
    await request(app).post('/api/tests/import-bundle').send({ content: 'kind: other' }).expect(400);
    expect(() => parseBundle('kind: webflowmaster/tests\nversion: 9\n')).toThrow(BundleError);
  });

  it('serves one test as a Playwright file', async () => {
    const organizationId = await organization('Pw');
    const [test] = await privilegedDb.insert(tests).values({ name: 'Search box', url: 'https://shop.example', sequence: [step('input', 'shoes', '#q'), step('pressKey', 'Enter')], elements: [], userId: user.id, organizationId }).returning();
    const res = await request(app).get(`/api/tests/${test.id}/playwright`).expect(200);
    expect(res.headers['content-disposition']).toContain('search-box.spec.ts');
    expect(res.text).toContain(`await p.locator("#q").first().fill("shoes");`);
    expect(res.text).toContain(`await p.keyboard.press("Enter");`);
    const json = await request(app).get(`/api/tests/${test.id}/playwright`).query({ format: 'json' }).expect(200);
    expect(json.body.notExported).toEqual([]);
    await request(app).get('/api/tests/999999/playwright').expect(404);
  });
});
