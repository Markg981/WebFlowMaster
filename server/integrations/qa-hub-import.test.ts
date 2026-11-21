import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { eq, sql } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import { projects, tests } from '@shared/schema';
import { externalCaseIdFromName } from '@shared/testcases-hub';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../platform/logger', () => ({
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
 * The QA hub import by QA case id: the duplicate guard, a re-run that creates nothing, the opt-in
 * sync that never touches recorded steps, fixtures, preconditions or cleanups, the audit and the
 * v1 routes. Runs on PGlite with a small fixture hub folder.
 */

type User = { id: number; username: string; organizationId: number; role: string };

const MOD = 'DMO Core';
let app: express.Express;
let v1: express.Express;
let organizationId: number;
let editor: User;
let current: User;
let rootDir: string;
let hubDir: string;
let projectId: number;
let settle: () => Promise<void>;

async function writeCase(id: string, extra: Record<string, unknown> = {}) {
  const dir = path.join(hubDir, 'TestCasesDefinitions', MOD, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'definition.json'),
    JSON.stringify({
      schema_version: '3.1',
      id,
      definition_module: MOD,
      execution_module: MOD,
      status: 'active',
      priority: 'High',
      version_from: '2.3',
      version_to: null,
      feature_highlight: 'Page A',
      execution_group: 'Smoke',
      devops_id: null,
      sme: 'Jane',
      functional_objective: `Objective of ${id}.`,
      input_data_precondition: 'An order exists.',
      ref_env_precondition: '',
      steps: '1) Open it\n2) Check it',
      ref_env_steps: '',
      expected_outcome: 'Step 2: It is fine',
      ref_env_expected_outcome: '',
      readiness_level: 3,
      depends_on: [],
      force_not_tested_in_waves: false,
      updated_at: '2025-03-04T11:22:33Z',
      ...extra,
    }),
  );
}

const rows = () =>
  privilegedDb.select().from(tests).where(eq(tests.organizationId, organizationId));

async function runImport(body: Record<string, unknown>) {
  const started = await request(app)
    .post('/api/testcase-hub/import/modules')
    .send({ projectId, modules: [MOD], ...body });
  expect(started.status, JSON.stringify(started.body)).toBe(202);
  await settle();
  const job = await request(app).get(`/api/testcase-hub/jobs/${started.body.id}`);
  expect(job.body.status, job.body.error).toBe('succeeded');
  return job.body;
}

beforeAll(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-qa-hub-'));
  hubDir = path.join(rootDir, 'hub');
  await fs.mkdir(path.join(hubDir, 'config'), { recursive: true });
  await fs.writeFile(
    path.join(hubDir, 'config', 'modules.json'),
    JSON.stringify([{ module_name: MOD }]),
  );
  for (const id of ['NCC_TC_00001', 'NCC_TC_00002', 'NCC_TC_00003']) await writeCase(id);
  await writeCase('NCC_TC_00004', { status: 'deprecated' });
  process.env.TESTCASE_HUB_ROOTS = rootDir;

  organizationId = await createTestOrganization('QA hub Org');
  editor = {
    id: await createTestUser(organizationId, 'qa-editor'),
    username: 'qa-editor',
    organizationId,
    role: 'editor',
  };
  projectId = (
    await privilegedDb
      .insert(projects)
      .values({ name: 'P', userId: editor.id, organizationId } as any)
      .returning()
  )[0].id;

  const { default: hubRoutes } = await import('../http/routes/testcase-hub.routes');
  const { default: waveRoutes } = await import('../http/routes/hub-waves.routes');
  const { default: testRoutes } = await import('../http/routes/tests.routes');
  const { registerQaHubRoutes } = await import('../http/api-v1/qa-hub');
  ({ settleHubJobs: settle } = await import('./hub-waves'));
  const { runWithTenant } = await import('../platform/middleware/tenancy');
  const mount = (a: express.Express) => {
    a.use(express.json());
    a.use((req, _res, next) => {
      (req as any).user = current;
      (req as any).isAuthenticated = () => true;
      runWithTenant(current.organizationId, () => next(), {
        userId: current.id,
        role: current.role,
      });
    });
  };
  app = express();
  mount(app);
  app.use(hubRoutes);
  app.use(waveRoutes);
  app.use(testRoutes);
  v1 = express();
  mount(v1);
  const router = express.Router();
  registerQaHubRoutes(router);
  v1.use(router);

  current = editor;
  await request(app)
    .put('/api/testcase-hub')
    .send({ kind: 'folder', name: 'QA hub', path: hubDir });
  expect((await request(app).post('/api/testcase-hub/refresh')).status).toBe(200);
});

afterAll(async () => {
  await settle?.();
  delete process.env.TESTCASE_HUB_ROOTS;
  await fs.rm(rootDir, { recursive: true, force: true });
});

describe('id normalisation', () => {
  it('reads the QA id from both historic name forms', () => {
    expect(externalCaseIdFromName('[NCC_TC_00301] Weigh a pallet')).toBe('NCC_TC_00301');
    expect(externalCaseIdFromName('NCC_TC_0134 — Weigh a pallet')).toBe('NCC_TC_00134');
    expect(externalCaseIdFromName('Weigh a pallet')).toBeNull();
  });
});

describe('module import by QA id', () => {
  it('creates the active cases with the id and the source', async () => {
    const job = await runImport({});
    expect(job.summary).toMatchObject({ created: 3, failed: 0, skippedDeprecated: 1 });
    const all = await rows();
    expect(all.map((t) => t.externalCaseId).sort()).toEqual([
      'NCC_TC_00001',
      'NCC_TC_00002',
      'NCC_TC_00003',
    ]);
    expect(all.every((t) => t.externalSource === 'qa-hub')).toBe(true);
  });

  it('a second run creates nothing', async () => {
    const job = await runImport({});
    expect(job.summary).toMatchObject({ created: 0, failed: 0 });
    expect(await rows()).toHaveLength(3);
  });

  it('never imports a case whose id a test already holds, and says which test', async () => {
    await writeCase('NCC_TC_00005');
    const made = await request(app).post('/api/tests').send({
      name: 'Hand written',
      url: '',
      sequence: [],
      elements: [],
      projectId,
      externalCaseId: 'ncc_tc_00005',
    });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    expect((await request(app).post('/api/testcase-hub/refresh')).status).toBe(200);
    const job = await runImport({});
    expect(job.summary).toMatchObject({ created: 0, failed: 0, alreadyImported: 1 });
    expect(await rows()).toHaveLength(4);
    await privilegedDb.delete(tests).where(eq(tests.id, made.body.id));
    await fs.rm(path.join(hubDir, 'TestCasesDefinitions', MOD, 'NCC_TC_00005'), {
      recursive: true,
    });
    expect((await request(app).post('/api/testcase-hub/refresh')).status).toBe(200);
  });

  it('refuses a second test with the same id in the project', async () => {
    const taken = (await rows())[0];
    const res = await request(app).post('/api/tests').send({
      name: 'Copy',
      url: '',
      sequence: [],
      elements: [],
      projectId,
      externalCaseId: taken.externalCaseId!.toLowerCase(),
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain(String(taken.id));
    expect(await rows()).toHaveLength(3);
  });
});

describe('sync', () => {
  it('refreshes taxonomy and text, never recorded steps, fixtures, preconditions or cleanups', async () => {
    const [manual, recorded] = (await rows()).sort((a, b) => a.id - b.id);
    const recordedSequence = [{ type: 'click', selector: '#go' }];
    const fixtures = [{ name: 'fx' }];
    const pre = [{ method: 'GET', url: '/x' }];
    const clean = [{ method: 'DELETE', url: '/y' }];
    await privilegedDb
      .update(tests)
      .set({
        sequence: recordedSequence,
        dataFixtures: fixtures,
        preconditions: pre,
        cleanups: clean,
      } as any)
      .where(eq(tests.id, recorded.id));
    await writeCase(recorded.externalCaseId!, { feature_highlight: 'Page B' });
    await writeCase(manual.externalCaseId!, { feature_highlight: 'Page B' });
    expect((await request(app).post('/api/testcase-hub/refresh')).status).toBe(200);

    const plain = await runImport({});
    expect(plain.summary.created).toBe(0);
    expect((await rows()).find((t) => t.id === recorded.id)!.featureArea).toBe('Page A');

    const job = await runImport({ sync: true });
    expect(job.summary.created).toBe(0);
    const after = await rows();
    const r = after.find((t) => t.id === recorded.id)!;
    expect(r.featureArea).toBe('Page B');
    expect(r.sequence).toEqual(recordedSequence);
    expect(r.dataFixtures).toEqual(fixtures);
    expect(r.preconditions).toEqual(pre);
    expect(r.cleanups).toEqual(clean);
    expect(after.find((t) => t.id === manual.id)!.featureArea).toBe('Page B');
    expect(after).toHaveLength(3);
  });
});

describe('audit and v1 routes', () => {
  it('counts defined, imported, missing and the orphans', async () => {
    const res = await request(v1).get('/api/v1/qa-hub/audit').query({ projectId, modules: MOD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = res.body.modules.find((m: any) => m.module === MOD);
    expect(row).toMatchObject({ defined: 4, imported: 3, duplicateCases: 0 });
    expect(res.body.totals.orphans).toBe(0);
  });

  it('starts an import through the v1 route, and a viewer cannot', async () => {
    const res = await request(v1)
      .post('/api/v1/qa-hub/import/modules')
      .send({ modules: [MOD], projectId });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    await settle();
    const job = await request(v1).get(`/api/v1/qa-hub/jobs/${res.body.id}`);
    expect(job.status).toBe(200);
    expect(job.body.status).toBe('succeeded');
    const before = current;
    current = { ...editor, role: 'viewer' };
    const denied = await request(v1)
      .post('/api/v1/qa-hub/import/modules')
      .send({ modules: [MOD], projectId });
    current = before;
    expect(denied.status).toBe(403);
  });
});

describe('migration 0120 backfill', () => {
  it('keeps the id on one test per project, the bracketed one first, and leaves the others null', async () => {
    const migration = await fs.readFile(
      path.join(__dirname, '../../migrations/0120_qa_case_id.sql'),
      'utf8',
    );
    const start = migration.indexOf('WITH parsed AS');
    const backfill = migration.slice(start, migration.indexOf('--> statement-breakpoint', start));
    const project = (
      await privilegedDb
        .insert(projects)
        .values({ name: 'Legacy', userId: editor.id, organizationId } as any)
        .returning()
    )[0].id;
    const make = async (name: string) =>
      (
        await privilegedDb
          .insert(tests)
          .values({
            organizationId,
            userId: editor.id,
            projectId: project,
            name,
            url: '',
            sequence: [],
            elements: [],
          } as any)
          .returning()
      )[0].id;
    const legacy = await make('NCC_TC_0301 — Weigh a pallet');
    const bracketed = await make('[NCC_TC_00301] Weigh a pallet');
    const bracketedLater = await make('[NCC_TC_00301] Weigh a pallet again');
    const plain = await make('No id here');

    await privilegedDb.execute(sql.raw(backfill));

    const held = new Map(
      (await rows())
        .filter((t) => t.projectId === project)
        .map((t) => [t.id, t.externalCaseId] as const),
    );
    expect(held.get(bracketed)).toBe('NCC_TC_00301');
    expect(held.get(legacy)).toBeNull();
    expect(held.get(bracketedLater)).toBeNull();
    expect(held.get(plain)).toBeNull();
  });
});

describe('batching', () => {
  it('imports a module larger than one chunk, and resumes with nothing left to do', async () => {
    const { HUB_WAVE_IMPORT_CHUNK } = await import('@shared/hub-waves');
    const big = 'DMO Big';
    const total = HUB_WAVE_IMPORT_CHUNK + 5;
    await fs.writeFile(
      path.join(hubDir, 'config', 'modules.json'),
      JSON.stringify([{ module_name: MOD }, { module_name: big }]),
    );
    const dir = path.join(hubDir, 'TestCasesDefinitions', big);
    await fs.mkdir(dir, { recursive: true });
    const template = JSON.parse(
      await fs.readFile(
        path.join(hubDir, 'TestCasesDefinitions', MOD, 'NCC_TC_00001', 'definition.json'),
        'utf8',
      ),
    );
    for (let i = 1; i <= total; i++) {
      const id = `BIG_TC_${String(i).padStart(5, '0')}`;
      await fs.mkdir(path.join(dir, id), { recursive: true });
      await fs.writeFile(
        path.join(dir, id, 'definition.json'),
        JSON.stringify({ ...template, id, definition_module: big, execution_module: big }),
      );
    }
    expect((await request(app).post('/api/testcase-hub/refresh')).status).toBe(200);
    const before = (await rows()).length;

    const first = await runImport({ modules: [big] });
    expect(first.summary).toMatchObject({ created: total, failed: 0 });
    expect((await rows()).length).toBe(before + total);

    const again = await runImport({ modules: [big] });
    expect(again.summary).toMatchObject({ created: 0, failed: 0 });
    expect((await rows()).length).toBe(before + total);
  });
});
