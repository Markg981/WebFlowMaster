import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { and, eq } from 'drizzle-orm';
import { privilegedDb } from '../../platform/db';
import {
  auditLog,
  hubTestCases,
  projects,
  testCaseSources,
  testSuiteItems,
  testSuites,
  testVersions,
  tests,
} from '@shared/schema';
import { MANUAL_STEP_ACTION_ID, manualStepsOf } from '@shared/manual-tests';
import { createTestOrganization, createTestUser } from '../../tests/factories';

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

/**
 * The QA test case hub as the settings page and the Test Manager use it: a source under an
 * allowed root, a catalog refreshed from it, and the cases a tester picks becoming manual tests.
 */

type User = { id: number; username: string; organizationId: number; role: string };

let app: express.Express;
let organizationId: number;
let editor: User;
let otherOrg: User;
let currentUser: User;
let rootDir: string;
let hubDir: string;
let projectId: number;

const definition = (id: string, overrides: Record<string, unknown> = {}) => ({
  schema_version: '3.1',
  id,
  definition_module: id.split('_')[0],
  execution_module: id.split('_')[0],
  status: 'active',
  priority: 'High',
  version_from: '2.3',
  version_to: null,
  feature_highlight: 'Archive search',
  execution_group: 'Smoke',
  devops_id: null,
  sme: 'Jane',
  functional_objective: `Objective of ${id}.`,
  input_data_precondition: 'An order exists.',
  ref_env_precondition: '',
  steps: '1) Open the archive\n2) Search the order',
  ref_env_steps: '',
  expected_outcome: 'Step 2: The order is listed',
  ref_env_expected_outcome: '',
  readiness_level: 3,
  depends_on: [],
  force_not_tested_in_waves: false,
  updated_at: '2025-03-04T11:22:33Z',
  ...overrides,
});

async function writeCase(id: string, overrides: Record<string, unknown> = {}) {
  const module = id.split('_')[0];
  const dir = path.join(hubDir, 'TestCasesDefinitions', module, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'definition.json'),
    JSON.stringify(definition(id, overrides), null, 2),
  );
}

async function removeCase(id: string) {
  await fs.rm(path.join(hubDir, 'TestCasesDefinitions', id.split('_')[0], id), {
    recursive: true,
    force: true,
  });
}

beforeAll(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-hub-routes-'));
  hubDir = path.join(rootDir, 'hub');
  await fs.mkdir(path.join(hubDir, 'config'), { recursive: true });
  await fs.writeFile(
    path.join(hubDir, 'config', 'modules.json'),
    JSON.stringify([{ module_name: 'ARC' }, { module_name: 'SAL' }]),
  );
  await writeCase('ARC_TC_00001');
  await writeCase('ARC_TC_00002', { status: 'deprecated', priority: 'Low', readiness_level: 0 });
  await writeCase('SAL_TC_00010', {
    priority: 'Highest',
    feature_highlight: 'Sales order entry',
    ref_env_steps: '1) Open the reference archive',
    ref_env_expected_outcome: 'Reference archive shown',
  });
  process.env.TESTCASE_HUB_ROOTS = rootDir;

  organizationId = await createTestOrganization('Hub Org');
  editor = {
    id: await createTestUser(organizationId, 'hub-editor'),
    username: 'hub-editor',
    organizationId,
    role: 'editor',
  };
  const otherOrganizationId = await createTestOrganization('Other Hub Org');
  otherOrg = {
    id: await createTestUser(otherOrganizationId, 'hub-other'),
    username: 'hub-other',
    organizationId: otherOrganizationId,
    role: 'owner',
  };
  projectId = (
    await privilegedDb
      .insert(projects)
      .values({ name: 'Archive', userId: editor.id, organizationId } as any)
      .returning()
  )[0].id;

  const { default: routes } = await import('./testcase-hub.routes');
  const { runWithTenant } = await import('../../platform/middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), {
      userId: currentUser.id,
      role: currentUser.role,
    });
  });
  app.use(routes);
});

afterAll(async () => {
  delete process.env.TESTCASE_HUB_ROOTS;
  await fs.rm(rootDir, { recursive: true, force: true });
});

beforeEach(() => {
  currentUser = editor;
});

const folderSource = (overrides: Record<string, unknown> = {}) => ({
  kind: 'folder',
  name: 'CoE QA hub',
  path: hubDir,
  ...overrides,
});

const auditRows = (action: string) =>
  privilegedDb
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.organizationId, organizationId), eq(auditLog.action, action)));

// ─── The source ──────────────────────────────────────────────────────────────

describe('the source', () => {
  it('starts with none', async () => {
    const res = await request(app).get('/api/testcase-hub');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('refuses a folder outside the allowed roots before saving anything', async () => {
    const res = await request(app)
      .put('/api/testcase-hub')
      .send(folderSource({ path: path.join(rootDir, '..') }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('path_not_allowed');
    expect(await privilegedDb.select().from(testCaseSources)).toEqual([]);
  });

  it('refuses an Azure DevOps source without a token, and what is not a source at all', async () => {
    const res = await request(app).put('/api/testcase-hub').send({
      kind: 'azure-devops',
      name: 'ADO hub',
      baseUrl: 'https://dev.azure.com/my-org',
      project: 'QA',
      repository: 'CoE-QA-TestCasesHub',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token/);
    const bad = await request(app).put('/api/testcase-hub').send({ kind: 'ftp', name: 'x' });
    expect(bad.status).toBe(400);
  });

  it('saves an Azure DevOps source with its token encrypted and never returns it', async () => {
    const res = await request(app).put('/api/testcase-hub').send({
      kind: 'azure-devops',
      name: 'ADO hub',
      baseUrl: 'https://dev.azure.com/my-org/',
      project: 'QA',
      repository: 'CoE-QA-TestCasesHub',
      token: 'pat-secret-value',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'azure-devops',
      name: 'ADO hub',
      baseUrl: 'https://dev.azure.com/my-org',
      branch: 'main',
      hasToken: true,
      caseCount: 0,
    });
    expect(JSON.stringify(res.body)).not.toContain('pat-secret-value');
    expect(res.body.encryptedToken).toBeUndefined();
    const [row] = await privilegedDb.select().from(testCaseSources);
    expect(row.encryptedToken).not.toBeNull();
    expect(row.encryptedToken).not.toContain('pat-secret-value');
    const [configured] = await auditRows('testcase_hub.configured');
    expect(configured.metadata).toEqual({ name: 'ADO hub', kind: 'azure-devops' });
  });

  it('keeps the token when the source is saved again without one', async () => {
    const res = await request(app).put('/api/testcase-hub').send({
      kind: 'azure-devops',
      name: 'ADO hub renamed',
      baseUrl: 'https://dev.azure.com/my-org',
      project: 'QA',
      repository: 'CoE-QA-TestCasesHub',
    });
    expect(res.status).toBe(200);
    expect(res.body.hasToken).toBe(true);
    const [updated] = await auditRows('testcase_hub.updated');
    expect(updated.metadata).toMatchObject({
      fields: ['baseUrl', 'kind', 'name', 'project', 'repository'],
    });
    expect(JSON.stringify(updated.metadata)).not.toContain('dev.azure.com');
  });

  it('switches to a folder, dropping the token, and the viewer only reads it', async () => {
    const res = await request(app).put('/api/testcase-hub').send(folderSource());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'folder', path: hubDir, hasToken: false });
    expect(res.body.baseUrl).toBeNull();
    currentUser = { ...editor, role: 'viewer' };
    const read = await request(app).get('/api/testcase-hub');
    expect(read.status).toBe(200);
    expect(read.body.name).toBe('CoE QA hub');
    const write = await request(app)
      .put('/api/testcase-hub')
      .send(folderSource({ name: 'nope' }));
    expect(write.status).toBe(403);
    const refresh = await request(app).post('/api/testcase-hub/refresh');
    expect(refresh.status).toBe(403);
  });

  it('is invisible to another organization', async () => {
    currentUser = otherOrg;
    const res = await request(app).get('/api/testcase-hub');
    expect(res.body).toBeNull();
    const refresh = await request(app).post('/api/testcase-hub/refresh');
    expect(refresh.status).toBe(404);
  });

  it('tests the connection', async () => {
    const res = await request(app).post('/api/testcase-hub/test');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(res.body.detail).toMatch(/2 module folders/);
  });
});

// ─── The catalog ─────────────────────────────────────────────────────────────

describe('the catalog', () => {
  it('fills from the hub on refresh', async () => {
    const res = await request(app).post('/api/testcase-hub/refresh');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cases: 3, added: 3, updated: 0, missing: 0, warnings: 0 });
    expect(res.body.source).toMatchObject({ lastRefreshStatus: 'ok', caseCount: 3 });
    const [refreshed] = await auditRows('testcase_hub.refreshed');
    expect(refreshed.metadata).toMatchObject({ cases: 3, added: 3 });
  });

  it('lists active cases by default, with filters and search', async () => {
    const all = await request(app).get('/api/testcase-hub/cases');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.rows.map((row: any) => row.caseId)).toEqual(['ARC_TC_00001', 'SAL_TC_00010']);
    expect(all.body.rows[0]).toMatchObject({
      module: 'ARC',
      priority: 'High',
      readinessLevel: 3,
      testId: null,
      changedSinceImport: false,
    });
    expect(all.body.rows[0].steps).toBeUndefined();

    const deprecated = await request(app).get('/api/testcase-hub/cases?status=deprecated');
    expect(deprecated.body.rows.map((row: any) => row.caseId)).toEqual(['ARC_TC_00002']);
    const everything = await request(app).get('/api/testcase-hub/cases?status=all&module=ARC');
    expect(everything.body.total).toBe(2);
    const search = await request(app).get('/api/testcase-hub/cases?q=sales%20order');
    expect(search.body.rows.map((row: any) => row.caseId)).toEqual(['SAL_TC_00010']);
    const escaped = await request(app).get('/api/testcase-hub/cases?q=%25');
    expect(escaped.body.total).toBe(0);
    const paged = await request(app).get('/api/testcase-hub/cases?page=2&pageSize=1');
    expect(paged.body).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(paged.body.rows.map((row: any) => row.caseId)).toEqual(['SAL_TC_00010']);
    const bad = await request(app).get('/api/testcase-hub/cases?readiness=9');
    expect(bad.status).toBe(400);
  });

  it('counts the facets the filters offer', async () => {
    const res = await request(app).get('/api/testcase-hub/facets');
    expect(res.status).toBe(200);
    expect(res.body.modules).toEqual([
      { value: 'ARC', count: 2 },
      { value: 'SAL', count: 1 },
    ]);
    expect(res.body.statuses).toEqual([
      { value: 'active', count: 2 },
      { value: 'deprecated', count: 1 },
    ]);
    expect(res.body).toMatchObject({ total: 3, imported: 0, changed: 0, missing: 0 });
  });

  it('shows one case with the steps it would become', async () => {
    const res = await request(app).get('/api/testcase-hub/cases/sal_tc_00010');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      caseId: 'SAL_TC_00010',
      testName: '[SAL_TC_00010] Objective of SAL_TC_00010.',
      test: null,
      changedSinceImport: false,
    });
    expect(res.body.contentHash).toBeUndefined();
    expect(res.body.preview.standard).toEqual([
      { action: 'Precondition: An order exists.', expected: '' },
      { action: 'Open the archive', expected: '' },
      { action: 'Search the order', expected: 'The order is listed' },
    ]);
    expect(res.body.preview.reference).toEqual([
      { action: 'Precondition: An order exists.', expected: '' },
      { action: 'Open the reference archive', expected: 'Reference archive shown' },
    ]);
    const missing = await request(app).get('/api/testcase-hub/cases/ARC_TC_99999');
    expect(missing.status).toBe(404);
  });
});

// ─── Importing ───────────────────────────────────────────────────────────────

describe('importing', () => {
  let importedTest: number;
  let suiteId: number;

  it('makes manual tests of the chosen cases, in a new suite, and only of those', async () => {
    const res = await request(app)
      .post('/api/testcase-hub/import')
      .send({ caseIds: ['ARC_TC_00001', 'sal_tc_00010'], projectId, newSuiteName: 'Hub smoke' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 2, updated: 0, unchanged: 0, skipped: 0 });
    expect(res.body.cases.map((c: any) => c.outcome)).toEqual(['created', 'created']);
    importedTest = res.body.cases[0].testId;
    suiteId = res.body.suiteId;

    const [test] = await privilegedDb.select().from(tests).where(eq(tests.id, importedTest));
    expect(test).toMatchObject({
      name: '[ARC_TC_00001] Objective of ARC_TC_00001.',
      projectId,
      module: 'ARC',
      featureArea: 'Archive search',
      scenario: 'Smoke',
      priority: 'High',
      organizationId,
    });
    expect(manualStepsOf(test.sequence)).toEqual([
      { action: 'Precondition: An order exists.', expected: '' },
      { action: 'Open the archive', expected: '' },
      { action: 'Search the order', expected: 'The order is listed' },
    ]);
    const versions = await privilegedDb
      .select()
      .from(testVersions)
      .where(eq(testVersions.testId, importedTest));
    expect(versions.map((v) => v.version)).toEqual([1]);

    const [suite] = await privilegedDb.select().from(testSuites).where(eq(testSuites.id, suiteId));
    expect(suite).toMatchObject({ name: 'Hub smoke', kind: 'static', projectId });
    const items = await privilegedDb
      .select()
      .from(testSuiteItems)
      .where(eq(testSuiteItems.suiteId, suiteId));
    expect(items.map((item) => [item.testType, item.testId, item.position])).toEqual([
      ['ui', importedTest, 0],
      ['ui', res.body.cases[1].testId, 1],
    ]);

    // The catalog remembers which test each case became; the untouched case stays unimported.
    const rows = await privilegedDb
      .select()
      .from(hubTestCases)
      .where(eq(hubTestCases.organizationId, organizationId));
    expect(rows.find((row) => row.caseId === 'ARC_TC_00001')).toMatchObject({
      testId: importedTest,
      importedBy: editor.id,
    });
    expect(rows.find((row) => row.caseId === 'ARC_TC_00002')?.testId).toBeNull();
    expect(
      (await privilegedDb.select().from(tests).where(eq(tests.organizationId, organizationId)))
        .length,
    ).toBe(2);

    const [imported] = await auditRows('testcase_hub.imported');
    expect(imported.metadata).toMatchObject({ requested: 2, created: 2, suiteId });
    const created = await auditRows('test.created');
    expect(created.map((row) => row.metadata)).toContainEqual({
      name: '[ARC_TC_00001] Objective of ARC_TC_00001.',
      importedFrom: 'ARC_TC_00001',
    });
  });

  it('shows the import in the catalog and the facets', async () => {
    const list = await request(app).get('/api/testcase-hub/cases?imported=yes');
    expect(list.body.rows.map((row: any) => row.caseId)).toEqual(['ARC_TC_00001', 'SAL_TC_00010']);
    const detail = await request(app).get('/api/testcase-hub/cases/ARC_TC_00001');
    expect(detail.body.test).toMatchObject({
      id: importedTest,
      name: '[ARC_TC_00001] Objective of ARC_TC_00001.',
    });
    const facets = await request(app).get('/api/testcase-hub/facets');
    expect(facets.body).toMatchObject({ imported: 2, changed: 0 });
  });

  it('leaves an unchanged case alone when imported again, into an existing suite', async () => {
    const res = await request(app)
      .post('/api/testcase-hub/import')
      .send({ caseIds: ['ARC_TC_00001'], projectId, suiteId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unchanged: 1, created: 0, updated: 0, suiteId });
    const items = await privilegedDb
      .select()
      .from(testSuiteItems)
      .where(eq(testSuiteItems.suiteId, suiteId));
    expect(items.length).toBe(2);
    const versions = await privilegedDb
      .select()
      .from(testVersions)
      .where(eq(testVersions.testId, importedTest));
    expect(versions.length).toBe(1);
  });

  it('updates the test, as a new version, when the hub changed the case', async () => {
    await writeCase('ARC_TC_00001', {
      steps: '1) Open the archive\n2) Search the order\n3) Open it',
      priority: 'Highest',
    });
    const refresh = await request(app).post('/api/testcase-hub/refresh');
    expect(refresh.body).toMatchObject({ cases: 3, added: 0, updated: 1, missing: 0 });
    const changed = await request(app).get('/api/testcase-hub/cases?imported=changed');
    expect(changed.body.rows.map((row: any) => row.caseId)).toEqual(['ARC_TC_00001']);
    expect(changed.body.rows[0].changedSinceImport).toBe(true);

    const res = await request(app)
      .post('/api/testcase-hub/import')
      .send({ caseIds: ['ARC_TC_00001'], projectId });
    expect(res.body).toMatchObject({ updated: 1 });
    const [test] = await privilegedDb.select().from(tests).where(eq(tests.id, importedTest));
    expect(test.priority).toBe('Critical');
    expect(manualStepsOf(test.sequence).map((step) => step.action)).toEqual([
      'Precondition: An order exists.',
      'Open the archive',
      'Search the order',
      'Open it',
    ]);
    const versions = await privilegedDb
      .select()
      .from(testVersions)
      .where(eq(testVersions.testId, importedTest));
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    const again = await request(app).get('/api/testcase-hub/cases?imported=changed');
    expect(again.body.total).toBe(0);
  });

  it('does not overwrite a test that has since been automated, nor one whose name is taken', async () => {
    await privilegedDb
      .update(tests)
      .set({
        sequence: [
          { id: 'step-1', action: { id: 'click', type: 'click', name: 'Click' }, value: '' },
        ],
      })
      .where(eq(tests.id, importedTest));
    await privilegedDb
      .update(hubTestCases)
      .set({ importedHash: 'stale' })
      .where(eq(hubTestCases.caseId, 'ARC_TC_00001'));
    await privilegedDb.insert(tests).values({
      name: '[ARC_TC_00002] Objective of ARC_TC_00002.',
      url: '',
      sequence: [],
      elements: [],
      userId: editor.id,
      organizationId,
    } as any);
    const res = await request(app)
      .post('/api/testcase-hub/import')
      .send({ caseIds: ['ARC_TC_00001', 'ARC_TC_00002'], projectId: null });
    expect(res.status).toBe(200);
    expect(res.body.cases).toEqual([
      { caseId: 'ARC_TC_00001', outcome: 'skipped', testId: importedTest, reason: 'not_manual' },
      {
        caseId: 'ARC_TC_00002',
        outcome: 'skipped',
        testId: expect.any(Number),
        reason: 'name_conflict',
      },
    ]);
    const [test] = await privilegedDb.select().from(tests).where(eq(tests.id, importedTest));
    expect((test.sequence as any[])[0].action.id).toBe('click');
    expect((test.sequence as any[])[0].action.id).not.toBe(MANUAL_STEP_ACTION_ID);
  });

  it('refuses unknown cases, a dynamic or foreign suite, and a viewer', async () => {
    const unknown = await request(app)
      .post('/api/testcase-hub/import')
      .send({ caseIds: ['ARC_TC_00099'] });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('case_not_in_catalog');
    const both = await request(app)
      .post('/api/testcase-hub/import')
      .send({ caseIds: ['ARC_TC_00002'], suiteId, newSuiteName: 'x' });
    expect(both.status).toBe(400);
    const noSuite = await request(app)
      .post('/api/testcase-hub/import')
      .send({ caseIds: ['ARC_TC_00002'], suiteId: 999999 });
    expect(noSuite.status).toBe(404);
    expect(noSuite.body.code).toBe('suite_not_found');
    currentUser = { ...editor, role: 'viewer' };
    const viewer = await request(app)
      .post('/api/testcase-hub/import')
      .send({ caseIds: ['ARC_TC_00002'] });
    expect(viewer.status).toBe(403);
  });

  it('marks a case that left the hub missing and will not import it', async () => {
    await removeCase('ARC_TC_00002');
    const refresh = await request(app).post('/api/testcase-hub/refresh');
    expect(refresh.body).toMatchObject({ cases: 2, missing: 1 });
    const hidden = await request(app).get('/api/testcase-hub/cases?status=all');
    expect(hidden.body.rows.map((row: any) => row.caseId)).toEqual([
      'ARC_TC_00001',
      'SAL_TC_00010',
    ]);
    const only = await request(app).get('/api/testcase-hub/cases?status=all&missing=only');
    expect(only.body.rows.map((row: any) => row.caseId)).toEqual(['ARC_TC_00002']);
    expect(only.body.rows[0].missingSince).not.toBeNull();
    const res = await request(app)
      .post('/api/testcase-hub/import')
      .send({ caseIds: ['ARC_TC_00002'] });
    expect(res.body.cases[0]).toMatchObject({ outcome: 'skipped', reason: 'missing_in_hub' });
    // Back in the hub, the row is current again.
    await writeCase('ARC_TC_00002', { status: 'deprecated' });
    const back = await request(app).post('/api/testcase-hub/refresh');
    expect(back.body).toMatchObject({ cases: 3, added: 0, missing: 0 });
  });

  it('records a failed refresh on the source', async () => {
    await fs.rename(path.join(hubDir, 'TestCasesDefinitions'), path.join(hubDir, 'Elsewhere'));
    try {
      const res = await request(app).post('/api/testcase-hub/refresh');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('not_a_hub');
      const source = await request(app).get('/api/testcase-hub');
      expect(source.body).toMatchObject({ lastRefreshStatus: 'failed', caseCount: 3 });
      expect(source.body.lastRefreshError).toMatch(/not a test case hub/);
    } finally {
      await fs.rename(path.join(hubDir, 'Elsewhere'), path.join(hubDir, 'TestCasesDefinitions'));
    }
  });

  it('forgets the source and the catalog, keeping the tests', async () => {
    const res = await request(app).delete('/api/testcase-hub');
    expect(res.status).toBe(204);
    expect(await privilegedDb.select().from(testCaseSources)).toEqual([]);
    expect(await privilegedDb.select().from(hubTestCases)).toEqual([]);
    const [test] = await privilegedDb.select().from(tests).where(eq(tests.id, importedTest));
    expect(test).toBeDefined();
    const again = await request(app).delete('/api/testcase-hub');
    expect(again.status).toBe(404);
    const list = await request(app).get('/api/testcase-hub/cases');
    expect(list.body.total).toBe(0);
    expect(await auditRows('testcase_hub.removed')).toHaveLength(1);
  });
});
