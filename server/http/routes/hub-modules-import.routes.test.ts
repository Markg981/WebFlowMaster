import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { and, eq } from 'drizzle-orm';
import { privilegedDb } from '../../platform/db';
import { auditLog, projects, testSuites, tests } from '@shared/schema';
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
 * Importing whole modules of the QA hub catalog: every case of the chosen modules that is not a
 * test yet becomes a manual test in the module's suite, as a background job with no cap on the
 * number of cases; deprecated cases and changed ones only when asked.
 */

type User = { id: number; username: string; organizationId: number; role: string };

let app: express.Express;
let organizationId: number;
let editor: User;
let viewer: User;
let currentUser: User;
let rootDir: string;
let hubDir: string;
let projectId: number;
let settleHubJobs: () => Promise<void>;

const ARCHIVING = 'DMO Archiving';
const SALES = 'DMO Sales';

async function writeCase(
  id: string,
  module: string,
  extra: { status?: string; objective?: string } = {},
) {
  const dir = path.join(hubDir, 'TestCasesDefinitions', module, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'definition.json'),
    JSON.stringify({
      schema_version: '3.1',
      id,
      definition_module: module,
      execution_module: module,
      status: extra.status ?? 'active',
      priority: 'High',
      version_from: '2.3',
      version_to: null,
      feature_highlight: `Feature of ${id}`,
      execution_group: 'Smoke',
      devops_id: null,
      sme: 'Jane',
      functional_objective: extra.objective ?? `Objective of ${id}.`,
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
    }),
  );
}

beforeAll(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-hub-modules-'));
  hubDir = path.join(rootDir, 'hub');
  await fs.mkdir(path.join(hubDir, 'config'), { recursive: true });
  await fs.writeFile(
    path.join(hubDir, 'config', 'modules.json'),
    JSON.stringify([{ module_name: ARCHIVING }, { module_name: SALES }]),
  );
  for (const id of ['ARC_TC_00001', 'ARC_TC_00002', 'ARC_TC_00003']) await writeCase(id, ARCHIVING);
  await writeCase('ARC_TC_00004', ARCHIVING, { status: 'deprecated' });
  for (const id of ['SAL_TC_00010', 'SAL_TC_00011']) await writeCase(id, SALES);
  process.env.TESTCASE_HUB_ROOTS = rootDir;

  organizationId = await createTestOrganization('Modules Org');
  editor = {
    id: await createTestUser(organizationId, 'modules-editor'),
    username: 'modules-editor',
    organizationId,
    role: 'editor',
  };
  viewer = {
    id: await createTestUser(organizationId, 'modules-viewer'),
    username: 'modules-viewer',
    organizationId,
    role: 'viewer',
  };
  projectId = (
    await privilegedDb
      .insert(projects)
      .values({ name: 'DMO', userId: editor.id, organizationId } as any)
      .returning()
  )[0].id;

  const { default: hubRoutes } = await import('./testcase-hub.routes');
  const { default: waveRoutes } = await import('./hub-waves.routes');
  const { default: testRoutes } = await import('./tests.routes');
  ({ settleHubJobs } = await import('../../integrations/hub-waves'));
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
  app.use(hubRoutes);
  app.use(waveRoutes);
  app.use(testRoutes);

  currentUser = editor;
  expect(
    (
      await request(app)
        .put('/api/testcase-hub')
        .send({ kind: 'folder', name: 'QA hub', path: hubDir })
    ).status,
  ).toBe(201);
  expect((await request(app).post('/api/testcase-hub/refresh')).status).toBe(200);
});

afterAll(async () => {
  await settleHubJobs?.();
  delete process.env.TESTCASE_HUB_ROOTS;
  await fs.rm(rootDir, { recursive: true, force: true });
});

beforeEach(() => {
  currentUser = editor;
});

/** Starts a module import and waits for it to end; returns the ended job. */
async function importModules(body: Record<string, unknown>) {
  const started = await request(app)
    .post('/api/testcase-hub/import/modules')
    .send({ projectId, ...body });
  expect(started.status, JSON.stringify(started.body)).toBe(202);
  expect(started.body.kind).toBe('modules_import');
  await settleHubJobs();
  const job = await request(app).get(`/api/testcase-hub/jobs/${started.body.id}`);
  expect(job.status).toBe(200);
  expect(job.body.status, job.body.error).toBe('succeeded');
  return job.body;
}

const libraryTests = () =>
  privilegedDb
    .select({ name: tests.name })
    .from(tests)
    .where(eq(tests.organizationId, organizationId));

const coverageOf = async (module: string) => {
  const facets = await request(app).get('/api/testcase-hub/facets');
  expect(facets.status).toBe(200);
  return facets.body.moduleCoverage.find((row: any) => row.module === module);
};

describe('importing whole modules', () => {
  it('gives each module its cases and how many the library has', async () => {
    expect(await coverageOf(ARCHIVING)).toEqual({
      module: ARCHIVING,
      total: 4,
      active: 3,
      imported: 0,
      importedActive: 0,
      changed: 0,
    });
    expect(await coverageOf(SALES)).toMatchObject({ total: 2, active: 2, imported: 0 });
  });

  it('imports every active case of a module into its suite, and only that module', async () => {
    const job = await importModules({ modules: [ARCHIVING] });
    expect(job.summary).toMatchObject({ created: 3, updated: 0, skipped: 0 });
    expect(job.summary.modules).toMatchObject([
      { module: ARCHIVING, requested: 3, created: 3, updated: 0, unchanged: 0, skipped: 0 },
    ]);

    const names = (await libraryTests()).map((t) => t.name).sort();
    expect(names).toHaveLength(3);
    expect(names.every((name) => name.startsWith('[ARC_TC_0000'))).toBe(true);
    const suites = await privilegedDb
      .select({ name: testSuites.name, projectId: testSuites.projectId })
      .from(testSuites)
      .where(eq(testSuites.organizationId, organizationId));
    expect(suites).toEqual([{ name: `QA hub · ${ARCHIVING}`, projectId }]);
    expect(await coverageOf(ARCHIVING)).toMatchObject({ imported: 3, importedActive: 3 });

    const audit = await privilegedDb
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, organizationId),
          eq(auditLog.action, 'testcase_hub.modules_imported'),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it('takes up only what is missing on the next import, deprecated cases when asked', async () => {
    const job = await importModules({ modules: [SALES, ARCHIVING], includeDeprecated: true });
    // In the order asked for.
    expect(job.summary.modules).toMatchObject([
      { module: SALES, requested: 2, created: 2, updated: 0, unchanged: 0, skipped: 0 },
      { module: ARCHIVING, requested: 1, created: 1, updated: 0, unchanged: 0, skipped: 0 },
    ]);
    expect(await libraryTests()).toHaveLength(6);

    const again = await importModules({ modules: [ARCHIVING, SALES] });
    expect(again.summary).toMatchObject({ created: 0, updated: 0 });
    expect(again.summary.modules.map((m: any) => m.requested)).toEqual([0, 0]);
  });

  it('rewrites the tests whose case changed in the hub only when asked', async () => {
    await writeCase('ARC_TC_00002', ARCHIVING, { objective: 'A new objective.' });
    expect((await request(app).post('/api/testcase-hub/refresh')).status).toBe(200);
    expect(await coverageOf(ARCHIVING)).toMatchObject({ changed: 1 });

    const plain = await importModules({ modules: [ARCHIVING] });
    expect(plain.summary.modules[0]).toMatchObject({ requested: 0, updated: 0 });

    const job = await importModules({ modules: [ARCHIVING], updateChanged: true });
    expect(job.summary.modules[0]).toMatchObject({ requested: 1, updated: 1, created: 0 });
    expect(await libraryTests()).toHaveLength(6);
    expect(await coverageOf(ARCHIVING)).toMatchObject({ changed: 0 });
  });

  it('refuses an unknown module, an empty list and a viewer', async () => {
    const unknown = await request(app)
      .post('/api/testcase-hub/import/modules')
      .send({ modules: [ARCHIVING, 'DMO Nowhere'] });
    expect(unknown.status).toBe(404);
    expect(JSON.stringify(unknown.body)).toContain('module_not_found');

    const empty = await request(app).post('/api/testcase-hub/import/modules').send({ modules: [] });
    expect(empty.status).toBe(400);

    currentUser = viewer;
    const denied = await request(app)
      .post('/api/testcase-hub/import/modules')
      .send({ modules: [ARCHIVING] });
    expect(denied.status).toBe(403);
  });
});

describe('the QA case id', () => {
  const MOD = ARCHIVING;
  const idsOf = async () =>
    (
      await privilegedDb
        .select({ id: tests.id, caseId: tests.externalCaseId, source: tests.externalSource })
        .from(tests)
        .where(eq(tests.organizationId, organizationId))
    ).filter((row) => row.caseId);

  it('stores the id and the source, and a second run creates nothing', async () => {
    const first = await importModules({ modules: [MOD] });
    expect(first.summary.created).toBeGreaterThanOrEqual(0);
    const rows = await idsOf();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.source === 'qa-hub')).toBe(true);
    const before = (await libraryTests()).length;

    const again = await importModules({ modules: [MOD] });
    expect(again.summary).toMatchObject({ created: 0, updated: 0, failed: 0 });
    expect((await libraryTests()).length).toBe(before);
  });

  it('finds a test by its id on the REST list, any spelling', async () => {
    const [row] = await idsOf();
    const res = await request(app)
      .get('/api/tests')
      .query({ externalCaseId: row.caseId!.toLowerCase() });
    expect(res.status).toBe(200);
    expect(res.body.map((t: any) => t.id)).toEqual([row.id]);
  });
});
