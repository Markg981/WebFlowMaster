import { beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));
const { privilegedDb } = await import('../db');
const { apiKeys, users, projects, projectMembers, tests, testVersions, auditLog } =
  await import('@shared/schema');
const { createTestOrganization, createTestUser } = await import('../tests/factories');
const { generateApiKey } = await import('../api-keys');
const { apiKeyAuth } = await import('../middleware/api-key-auth');
const { tenancyMiddleware, withTenantTransaction, runWithTenant } =
  await import('../middleware/tenancy');
const { registerAuthoringRoutes, testCreateSchema } = await import('./authoring');
const { API_SCOPE_NAMES } = await import('@shared/api-scopes');

let app: express.Express,
  org: number,
  user: number,
  key: string,
  otherKey: string,
  viewerKey: string;
const auth = (value = key) => ({ Authorization: `Bearer ${value}` });
async function makeKey(userId: number, organizationId: number, scopes: string[]) {
  const generated = generateApiKey();
  await privilegedDb.insert(apiKeys).values({
    id: randomUUID(),
    organizationId,
    userId,
    name: 'Authoring fixture',
    prefix: generated.prefix,
    hashedKey: generated.hashedKey,
    scopes,
  });
  return generated.key;
}
const definition = (name: string, projectId?: number) => ({
  name,
  url: 'https://example.test',
  sequence: [],
  elements: [],
  ...(projectId ? { projectId } : {}),
});
beforeAll(async () => {
  org = await createTestOrganization(`authoring-${randomUUID()}`);
  user = await createTestUser(org);
  key = await makeKey(user, org, API_SCOPE_NAMES);
  const other = await createTestOrganization(`other-${randomUUID()}`);
  otherKey = await makeKey(await createTestUser(other), other, API_SCOPE_NAMES);
  const viewer = await createTestUser(org);
  await privilegedDb.update(users).set({ role: 'viewer' }).where(eq(users.id, viewer));
  viewerKey = await makeKey(viewer, org, API_SCOPE_NAMES);
  app = express();
  app.use(express.json({ limit: '3mb' }));
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => false) as typeof req.isAuthenticated;
    next();
  });
  app.use(apiKeyAuth);
  app.use(tenancyMiddleware);
  const router = express.Router();
  registerAuthoringRoutes(router);
  app.use(router);
});

describe('public authoring through API keys and tenant transactions', () => {
  it('rejects authors, organizations, unknown fields and a viewer with write scopes', async () => {
    expect(testCreateSchema.safeParse({ ...definition('Forbidden'), userId: user }).success).toBe(
      false,
    );
    await request(app)
      .post('/api/v1/projects')
      .set(auth())
      .send({ name: 'Bad', organizationId: org })
      .expect(400);
    await request(app)
      .post('/api/v1/projects')
      .set(auth(viewerKey))
      .send({ name: 'Bad' })
      .expect(403);
    const readKey = await makeKey(user, org, ['projects:read']);
    await request(app)
      .post('/api/v1/projects')
      .set(auth(readKey))
      .send({ name: 'Bad' })
      .expect(403);
  });
  it('runs tenant work as the non-superuser database role', async () => {
    const result = await runWithTenant(org, () =>
      withTenantTransaction((tx) => tx.execute(sql`select current_user as role`)),
    );
    expect(result.rows[0]).toMatchObject({ role: 'app_user' });
  });
  it('creates, reads and renames projects without exposing tenancy or author fields', async () => {
    const created = await request(app)
      .post('/api/v1/projects')
      .set(auth())
      .send({ name: 'First' })
      .expect(201);
    expect(created.body).not.toHaveProperty('organizationId');
    expect(created.body).not.toHaveProperty('userId');
    const path = `/api/v1/projects/${created.body.id}`;
    await request(app).get(path).set(auth(otherKey)).expect(404);
    await request(app)
      .patch(path)
      .set(auth())
      .send({ name: 'Renamed' })
      .expect(200)
      .expect((res) => expect(res.body.name).toBe('Renamed'));
    await request(app)
      .get('/api/v1/projects?limit=100')
      .set(auth())
      .expect(200)
      .expect((res) =>
        expect(res.body.items.some((row: { id: number }) => row.id === created.body.id)).toBe(true),
      );
  });
  it('versions and audits test saves, and hides tests from other tenants', async () => {
    const created = await request(app)
      .post('/api/v1/tests')
      .set(auth())
      .send(definition(`Versioned-${randomUUID()}`))
      .expect(201);
    const path = `/api/v1/tests/${created.body.id}`;
    await request(app).get(path).set(auth(otherKey)).expect(404);
    await request(app)
      .patch(path)
      .set(auth())
      .send({ url: 'https://example.test/checkout' })
      .expect(200);
    await request(app).patch(path).set(auth()).send({ organizationId: org }).expect(400);
    const versions = await privilegedDb
      .select()
      .from(testVersions)
      .where(eq(testVersions.testId, created.body.id));
    expect(versions.map((row) => row.version).sort()).toEqual([1, 2]);
    const audits = await privilegedDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, String(created.body.id)));
    expect(audits.some((row) => row.action === 'test.created')).toBe(true);
    expect(audits.some((row) => row.action === 'test.updated')).toBe(true);
  });
  it('enforces restricted project edit rights before import preview and writes', async () => {
    const [project] = await privilegedDb
      .insert(projects)
      .values({ name: 'Restricted', userId: user, organizationId: org, restricted: true })
      .returning();
    await privilegedDb
      .insert(projectMembers)
      .values({ projectId: project.id, userId: user, organizationId: org, role: 'viewer' });
    await request(app)
      .post('/api/v1/tests')
      .set(auth())
      .send(definition(`Restricted-${randomUUID()}`, project.id))
      .expect(403);
    const content = JSON.stringify({
      kind: 'webflowmaster/tests',
      version: 2,
      tests: [definition('Restricted import')],
      apiTests: [],
    });
    await request(app)
      .post('/api/v1/suites/import')
      .set(auth())
      .send({ projectId: project.id, content, dryRun: true })
      .expect(403);
  });
  it('normalizes dataset rows and refuses deletion while tests use a shared dataset', async () => {
    const input = {
      name: `data_${randomUUID().replace(/-/g, '')}`,
      columns: ['customer', 'region'],
      rows: [{ customer: 'Example' }],
    };
    const created = await request(app).post('/api/v1/datasets').set(auth()).send(input).expect(201);
    expect(created.body.rows).toEqual([{ customer: 'Example', region: '' }]);
    const path = `/api/v1/datasets/${created.body.id}`;
    await request(app).get(path).set(auth(otherKey)).expect(404);
    await request(app)
      .put(path)
      .set(auth())
      .send({ ...input, rows: [{ customer: 'Changed' }] })
      .expect(200);
    const test = await request(app)
      .post('/api/v1/tests')
      .set(auth())
      .send({
        ...definition(`Dataset-${randomUUID()}`),
        dataset: [{ $sharedSet: String(created.body.id) }],
      })
      .expect(201);
    await request(app).delete(path).set(auth()).expect(409);
    await request(app)
      .patch(`/api/v1/tests/${test.body.id}`)
      .set(auth())
      .send({ dataset: null })
      .expect(200);
    await request(app).delete(path).set(auth()).expect(204);
  });
  it('provisions typed plan membership atomically and refuses foreign test ids', async () => {
    const test = await request(app)
      .post('/api/v1/tests')
      .set(auth())
      .send(definition(`Plan-${randomUUID()}`))
      .expect(201);
    const plan = await request(app)
      .post('/api/v1/plans')
      .set(auth())
      .send({ name: 'Pipeline', selectedTests: [{ type: 'ui', id: test.body.id }] })
      .expect(201);
    expect(plan.body.selectedTests).toEqual([{ type: 'ui', id: test.body.id }]);
    const path = `/api/v1/plans/${plan.body.id}`;
    await request(app).get(path).set(auth(otherKey)).expect(404);
    const foreign = await request(app)
      .post('/api/v1/tests')
      .set(auth(otherKey))
      .send(definition(`Other-${randomUUID()}`))
      .expect(201);
    await request(app)
      .patch(path)
      .set(auth())
      .send({ selectedTests: [{ type: 'ui', id: foreign.body.id }] })
      .expect(400);
    await request(app)
      .get(path)
      .set(auth())
      .expect(200)
      .expect((res) => expect(res.body.selectedTests).toEqual([{ type: 'ui', id: test.body.id }]));
    await request(app)
      .patch(path)
      .set(auth())
      .send({ selectedTests: [] })
      .expect(200)
      .expect((res) => expect(res.body.selectedTests).toEqual([]));
  });
  it('imports atomically, previews without saves, and exports portable explicit fields', async () => {
    const project = await request(app)
      .post('/api/v1/projects')
      .set(auth())
      .send({ name: 'Portable' })
      .expect(201);
    const name = `Portable-${randomUUID()}`;
    const content = JSON.stringify({
      kind: 'webflowmaster/tests',
      version: 2,
      tests: [definition(name)],
      apiTests: [],
    });
    const input = { projectId: project.body.id, content };
    await request(app)
      .post('/api/v1/suites/import')
      .set(auth())
      .send({ ...input, dryRun: true })
      .expect(200);
    expect((await privilegedDb.select().from(tests).where(eq(tests.name, name))).length).toBe(0);
    await request(app).post('/api/v1/suites/import').set(auth()).send(input).expect(201);
    const exported = await request(app)
      .post('/api/v1/suites/export')
      .set(auth())
      .send({ projectId: project.body.id })
      .expect(200);
    const bundle = JSON.parse(exported.body.content);
    expect(bundle.tests[0]).not.toHaveProperty('userId');
    expect(bundle.tests[0]).not.toHaveProperty('organizationId');
    const rollbackName = `Rollback-${randomUUID()}`;
    const invalid = JSON.stringify({
      kind: 'webflowmaster/tests',
      version: 2,
      tests: [
        definition(rollbackName),
        {
          ...definition('Invalid manual'),
          sequence: [{ id: 'step', action: { id: 'manualStep' }, value: '' }],
        },
      ],
      apiTests: [],
    });
    await request(app)
      .post('/api/v1/suites/import')
      .set(auth())
      .send({ ...input, content: invalid })
      .expect(400);
    expect(
      (await privilegedDb.select().from(tests).where(eq(tests.name, rollbackName))).length,
    ).toBe(0);
  });
  it('imports Gherkin as BDD and validates its source on later edits', async () => {
    const project = await request(app)
      .post('/api/v1/projects')
      .set(auth())
      .send({ name: 'BDD authoring' })
      .expect(201);
    const source = `Feature: Public\n  Scenario: BDD-${randomUUID()}\n    Given a greeting`;
    const imported = await request(app)
      .post('/api/v1/suites/import')
      .set(auth())
      .send({ projectId: project.body.id, format: 'gherkin', content: source })
      .expect(201);
    const id = imported.body.results[0].id;
    const saved = await request(app).get(`/api/v1/tests/${id}`).set(auth()).expect(200);
    expect(saved.body.bdd).toMatchObject({ mode: 'manual', source });
    await request(app).patch(`/api/v1/tests/${id}`).set(auth()).send({ sequence: [] }).expect(400);
    await request(app)
      .post('/api/v1/suites/import')
      .set(auth())
      .send({
        projectId: project.body.id,
        format: 'gherkin',
        content: 'Feature: Invalid\nScenario: Broken\nGiven',
      })
      .expect(400);
  });
  it('rejects shared datasets from another tenant in saves and import previews', async () => {
    const dataset = await request(app)
      .post('/api/v1/datasets')
      .set(auth(otherKey))
      .send({
        name: `foreign_${randomUUID().replace(/-/g, '')}`,
        columns: ['value'],
        rows: [{ value: 'hidden' }],
      })
      .expect(201);
    const test = {
      ...definition(`Foreign dataset-${randomUUID()}`),
      dataset: [{ $sharedSet: String(dataset.body.id) }],
    };
    await request(app).post('/api/v1/tests').set(auth()).send(test).expect(400);
    const project = await request(app)
      .post('/api/v1/projects')
      .set(auth())
      .send({ name: 'Dataset validation' })
      .expect(201);
    const content = JSON.stringify({
      kind: 'webflowmaster/tests',
      version: 2,
      tests: [test],
      apiTests: [],
    });
    await request(app)
      .post('/api/v1/suites/import')
      .set(auth())
      .send({ projectId: project.body.id, content, dryRun: true })
      .expect(400);
  });
  it('returns public request errors for invalid filters, ids and pagination', async () => {
    for (const path of [
      '/api/v1/tests?projectId=bad',
      '/api/v1/projects?limit=-1',
      '/api/v1/projects?offset=abc',
      '/api/v1/projects/0',
      '/api/v1/datasets/2abc',
    ]) {
      await request(app)
        .get(path)
        .set(auth())
        .expect(400)
        .expect((res) => expect(res.body.error.code).toBe('invalid_request'));
    }
  });
  it('uses execution limits and canonical locales consistently when creating and updating plans', async () => {
    for (const invalid of [
      { locales: ['english'] },
      { maxParallelTests: 17 },
      { shards: 9 },
      { pageLoadTimeout: 999 },
      { elementTimeout: 600001 },
    ]) {
      await request(app)
        .post('/api/v1/plans')
        .set(auth())
        .send({ name: 'Invalid settings', ...invalid })
        .expect(400);
    }
    const created = await request(app)
      .post('/api/v1/plans')
      .set(auth())
      .send({
        name: 'Canonical locales',
        locales: [' IT_it ', 'it-IT', 'EN_us'],
        maxParallelTests: 16,
        shards: 8,
        pageLoadTimeout: 600000,
      })
      .expect(201);
    expect(created.body.locales).toEqual(['it-IT', 'en-US']);
    const path = `/api/v1/plans/${created.body.id}`;
    await request(app)
      .patch(path)
      .set(auth())
      .send({ locales: ['english'] })
      .expect(400);
    const changed = await request(app)
      .patch(path)
      .set(auth())
      .send({ locales: ['ZH_hant_tw'] })
      .expect(200);
    expect(changed.body.locales).toEqual(['zh-Hant-TW']);
    await request(app)
      .patch(path)
      .set(auth())
      .send({ name: 'Keep settings' })
      .expect(200)
      .expect((res) => {
        expect(res.body.locales).toEqual(['zh-Hant-TW']);
        expect(res.body.maxParallelTests).toBe(16);
        expect(res.body.shards).toBe(8);
      });
  });
  it('protects shared dataset dependencies in restricted projects without revealing test names', async () => {
    const dataset = await request(app)
      .post('/api/v1/datasets')
      .set(auth())
      .send({
        name: `private_${randomUUID().replace(/-/g, '')}`,
        columns: ['value'],
        rows: [{ value: 'shared' }],
      })
      .expect(201);
    const owner = await createTestUser(org);
    const [project] = await privilegedDb
      .insert(projects)
      .values({ name: 'Hidden project', organizationId: org, userId: owner, restricted: true })
      .returning();
    await privilegedDb.insert(tests).values({
      ...definition('Hidden dependency'),
      projectId: project.id,
      userId: owner,
      organizationId: org,
      dataset: [{ $sharedSet: String(dataset.body.id) }],
    });
    const result = await request(app)
      .delete(`/api/v1/datasets/${dataset.body.id}`)
      .set(auth())
      .expect(409);
    expect(result.body.error.code).toBe('dataset_in_use');
    expect(JSON.stringify(result.body)).not.toContain('Hidden dependency');
  });
});
