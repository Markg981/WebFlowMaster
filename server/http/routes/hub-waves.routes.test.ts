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
  hubJobs,
  hubWaveResults,
  hubWaves,
  projects,
  reportTestCaseResults,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  testSuites,
  tests,
} from '@shared/schema';
import { readManualLog, type ManualResultLog } from '@shared/manual-tests';
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
 * QA hub waves end to end: the QA team's sessions synced from a hub folder, imported as a plan
 * and an ended run with the team's verdicts, the verdicts given in WFM since kept across imports,
 * a new session made of a wave, and the results exported back in the hub's format.
 */

type User = { id: number; username: string; organizationId: number; role: string };

let app: express.Express;
let organizationId: number;
let editor: User;
let viewer: User;
let otherOrg: User;
let currentUser: User;
let rootDir: string;
let hubDir: string;
let projectId: number;
let settleHubJobs: () => Promise<void>;

const definition = (id: string) => ({
  schema_version: '3.1',
  id,
  definition_module: id.split('_')[0],
  execution_module: id.split('_')[0],
  status: 'active',
  priority: 'High',
  version_from: '2.3',
  version_to: null,
  feature_highlight: `Feature of ${id}`,
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
});

async function writeCase(id: string) {
  const dir = path.join(hubDir, 'TestCasesDefinitions', id.split('_')[0], id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'definition.json'), JSON.stringify(definition(id)));
}

const entry = (tcId: string, module: string, stage = 'A') => ({
  tc_id: tcId,
  module,
  definition_module: tcId.split('_')[0],
  tester: 'Pat',
  stage,
  stage_metric_new_feature: false,
  stage_metric_code_changes: true,
  stage_metric_failed_in_last: false,
  stage_metric_failed_in_previous: false,
});

const result = (tcId: string, status: string, extra: Record<string, unknown> = {}) => {
  const base = {
    tc_id: tcId,
    execution_status: status,
    tester: 'Pat',
    execution_date: '2026-04-22',
    build_number: '3.0.4-RC.1',
    bug_reference: status === 'failed' ? '312345' : null,
    bug_priority: status === 'failed' ? 'High' : null,
    notes: status === 'failed' ? 'Search returns nothing' : null,
    ...extra,
  };
  return { ...base, executions: [{ execution_number: 1, ...base }] };
};

async function writeWave(
  waveId: string,
  wave: Record<string, unknown>,
  results: Record<string, unknown[]>,
) {
  const dir = path.join(hubDir, 'Waves', waveId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'wave.json'),
    // As the desktop app writes it, byte order mark included.
    `\uFEFF${JSON.stringify({ schema_version: '2.0', wave_id: waveId, ...wave })}`,
  );
  for (const [module, rows] of Object.entries(results))
    await fs.writeFile(
      path.join(dir, `results_${module.replace(/\s+/g, '_')}.json`),
      JSON.stringify({
        schema_version: 'qa_wave_results_v1',
        wave_id: waveId,
        module,
        results: rows,
      }),
    );
}

const SMOKE = 'DMO_3.0.4_SmokeMaster';
const REGRESSION = 'DMO_3.0.5_Regression';

async function writeSmoke(overrides: { arc2?: string } = {}) {
  await writeWave(
    SMOKE,
    {
      name: 'DMO 3.0.4 - Smoke Master',
      release: '3.0.4',
      major_release: '3.0',
      wave_type: 'Smoke',
      status: 'completed',
      start_date: '2026-04-22',
      target_date: '2026-04-24',
      modules: ['DMO Archiving', 'DMO Sales'],
      tc_entries: [
        entry('ARC_TC_00001', 'DMO Archiving'),
        entry('ARC_TC_00002', 'DMO Archiving', 'B'),
        entry('ARC_TC_00003', 'DMO Archiving'),
        entry('SAL_TC_00010', 'DMO Sales'),
        // Not in the catalog: kept in the wave and the run by its id.
        entry('SAL_TC_09999', 'DMO Sales'),
        // Planned, never executed.
        entry('SAL_TC_00011', 'DMO Sales'),
      ],
    },
    {
      'DMO Archiving': [
        result('ARC_TC_00001', 'passed'),
        result('ARC_TC_00002', overrides.arc2 ?? 'failed'),
        result('ARC_TC_00003', 'on_hold', { notes: 'Environment down' }),
      ],
      'DMO Sales': [result('SAL_TC_00010', 'Not Tested'), result('SAL_TC_09999', 'passed')],
    },
  );
}

beforeAll(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-hub-waves-'));
  hubDir = path.join(rootDir, 'hub');
  await fs.mkdir(path.join(hubDir, 'config'), { recursive: true });
  await fs.writeFile(
    path.join(hubDir, 'config', 'modules.json'),
    JSON.stringify([{ module_name: 'ARC' }, { module_name: 'SAL' }]),
  );
  for (const id of ['ARC_TC_00001', 'ARC_TC_00002', 'ARC_TC_00003', 'SAL_TC_00010', 'SAL_TC_00011'])
    await writeCase(id);
  await writeSmoke();
  await writeWave(
    REGRESSION,
    {
      name: 'DMO 3.0.5 - Regression',
      release: '3.0.5',
      wave_type: 'Regression',
      status: 'in_progress',
      start_date: '2026-05-10',
      modules: ['DMO Archiving'],
      tc_entries: [entry('ARC_TC_00001', 'DMO Archiving')],
    },
    { 'DMO Archiving': [result('ARC_TC_00001', 'failed', { execution_date: '2026-05-11' })] },
  );
  process.env.TESTCASE_HUB_ROOTS = rootDir;

  organizationId = await createTestOrganization('Waves Org');
  editor = {
    id: await createTestUser(organizationId, 'waves-editor'),
    username: 'waves-editor',
    organizationId,
    role: 'editor',
  };
  viewer = {
    id: await createTestUser(organizationId, 'waves-viewer'),
    username: 'waves-viewer',
    organizationId,
    role: 'viewer',
  };
  const otherOrganizationId = await createTestOrganization('Other Waves Org');
  otherOrg = {
    id: await createTestUser(otherOrganizationId, 'waves-other'),
    username: 'waves-other',
    organizationId: otherOrganizationId,
    role: 'owner',
  };
  projectId = (
    await privilegedDb
      .insert(projects)
      .values({ name: 'DMO', userId: editor.id, organizationId } as any)
      .returning()
  )[0].id;

  const { default: hubRoutes } = await import('./testcase-hub.routes');
  const { default: waveRoutes } = await import('./hub-waves.routes');
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

/** Starts a job and waits for it to end; returns the ended job. */
async function runJob(url: string, body: unknown = {}) {
  const started = await request(app).post(url).send(body);
  expect(started.status, JSON.stringify(started.body)).toBe(202);
  await settleHubJobs();
  const job = await request(app).get(`/api/testcase-hub/jobs/${started.body.id}`);
  expect(job.status).toBe(200);
  return job.body;
}

const waveRow = async (waveId: string) =>
  (
    await privilegedDb
      .select()
      .from(hubWaves)
      .where(and(eq(hubWaves.organizationId, organizationId), eq(hubWaves.waveId, waveId)))
  )[0];

const auditRows = (action: string) =>
  privilegedDb
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.organizationId, organizationId), eq(auditLog.action, action)));

// ─── Sync ────────────────────────────────────────────────────────────────────

describe('syncing the waves', () => {
  it('reads every wave and its results, merged across the module files', async () => {
    const job = await runJob('/api/testcase-hub/waves/sync');
    expect(job.status, job.error).toBe('succeeded');
    expect(job.summary).toMatchObject({ waves: 2, added: 2, updated: 0, unchanged: 0, missing: 0 });

    const smoke = await waveRow(SMOKE);
    expect(smoke).toMatchObject({
      name: 'DMO 3.0.4 - Smoke Master',
      release: '3.0.4',
      waveType: 'Smoke',
      startDate: '2026-04-22',
      entryCount: 6,
    });
    const rows = await privilegedDb
      .select()
      .from(hubWaveResults)
      .where(eq(hubWaveResults.waveRowId, smoke.id));
    const byCase = Object.fromEntries(rows.map((row) => [row.caseId, row]));
    expect(byCase.ARC_TC_00001.status).toBe('passed');
    expect(byCase.ARC_TC_00002).toMatchObject({
      status: 'failed',
      bugReference: '312345',
      stage: 'B',
      attemptCount: 1,
    });
    expect(byCase.ARC_TC_00003.status).toBe('on_hold');
    expect(byCase.SAL_TC_00010.status).toBe('not_tested');
    expect(byCase.SAL_TC_00011.status).toBe('pending');
    expect(byCase.SAL_TC_09999.module).toBe('DMO Sales');
    expect(await auditRows('testcase_hub.waves_synced')).toHaveLength(1);
  });

  it('skips the waves that did not change', async () => {
    const job = await runJob('/api/testcase-hub/waves/sync');
    expect(job.summary).toMatchObject({ waves: 2, added: 0, updated: 0, unchanged: 2 });
  });

  it('lists the waves with their numbers, newest first', async () => {
    currentUser = viewer;
    const res = await request(app).get('/api/testcase-hub/waves');
    expect(res.status).toBe(200);
    expect(res.body.map((w: any) => w.waveId)).toEqual([REGRESSION, SMOKE]);
    const smoke = res.body[1];
    expect(smoke.counts).toEqual({ passed: 2, failed: 1, on_hold: 1, not_tested: 1, pending: 1 });
    expect(smoke.rates).toMatchObject({ total: 6, executed: 4, passRatePct: 50 });
    expect(smoke.imported).toBe(false);
    expect(smoke).not.toHaveProperty('fileHashes');
  });

  it('shows one wave by module and its cases, filtered', async () => {
    const smoke = await waveRow(SMOKE);
    const detail = await request(app).get(`/api/testcase-hub/waves/${smoke.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.byModule.map((m: any) => [m.module, m.rates.total])).toEqual([
      ['DMO Archiving', 3],
      ['DMO Sales', 3],
    ]);
    const failed = await request(app).get(
      `/api/testcase-hub/waves/${smoke.id}/results?status=failed`,
    );
    expect(failed.body.total).toBe(1);
    expect(failed.body.results[0]).toMatchObject({
      caseId: 'ARC_TC_00002',
      inCatalog: true,
      featureHighlight: 'Feature of ARC_TC_00002',
    });
    const search = await request(app).get(`/api/testcase-hub/waves/${smoke.id}/results?q=nothing`);
    expect(search.body.results.map((r: any) => r.caseId)).toEqual(['ARC_TC_00002']);
  });

  it('gives the overview and the history of a case across waves', async () => {
    const overview = await request(app).get('/api/testcase-hub/waves/overview');
    expect(overview.status).toBe(200);
    expect(overview.body).toMatchObject({ waves: 2, imported: 0, cases: 6 });
    expect(overview.body.trend.map((t: any) => t.waveId)).toEqual([SMOKE, REGRESSION]);
    const history = await request(app).get('/api/testcase-hub/waves/cases/arc_tc_00001/history');
    expect(history.body.map((h: any) => [h.waveId, h.result.status])).toEqual([
      [REGRESSION, 'failed'],
      [SMOKE, 'passed'],
    ]);
  });

  it('marks a wave gone from the hub and keeps its rows', async () => {
    const dir = path.join(hubDir, 'Waves', REGRESSION);
    const keep = path.join(rootDir, 'kept-regression');
    await fs.rename(dir, keep);
    try {
      const job = await runJob('/api/testcase-hub/waves/sync');
      expect(job.summary).toMatchObject({ waves: 1, unchanged: 1, missing: 1 });
      expect((await waveRow(REGRESSION)).missingSince).not.toBeNull();
    } finally {
      await fs.rename(keep, dir);
    }
    const back = await runJob('/api/testcase-hub/waves/sync');
    expect(back.summary).toMatchObject({ waves: 2, updated: 1, missing: 0 });
    expect((await waveRow(REGRESSION)).missingSince).toBeNull();
  });

  it('refuses a second job while one is live on the source', async () => {
    const smoke = await waveRow(SMOKE);
    const [live] = await privilegedDb
      .insert(hubJobs)
      .values({
        id: 'live-job',
        organizationId,
        sourceId: smoke.sourceId,
        kind: 'waves_sync',
        status: 'running',
        heartbeatAt: new Date(),
      })
      .returning();
    try {
      const res = await request(app).post('/api/testcase-hub/waves/sync');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('job_running');
      const cancel = await request(app).post(`/api/testcase-hub/jobs/${live.id}/cancel`);
      expect(cancel.body.cancelRequested).toBe(true);
    } finally {
      await privilegedDb.delete(hubJobs).where(eq(hubJobs.id, live.id));
    }
  });

  it('keeps the waves of another organization out of sight', async () => {
    currentUser = otherOrg;
    expect((await request(app).get('/api/testcase-hub/waves')).body).toEqual([]);
    const smoke = await waveRow(SMOKE);
    expect((await request(app).get(`/api/testcase-hub/waves/${smoke.id}`)).status).toBe(404);
  });

  it('lets a viewer look but not sync', async () => {
    currentUser = viewer;
    expect((await request(app).post('/api/testcase-hub/waves/sync')).status).toBe(403);
  });
});

// ─── Import ──────────────────────────────────────────────────────────────────

describe('importing a wave', () => {
  let executionId: string;

  it('imports the cases it needs, then makes a plan and an ended run of the verdicts', async () => {
    const smoke = await waveRow(SMOKE);
    const job = await runJob('/api/testcase-hub/waves/import', {
      waveIds: [smoke.id],
      projectId,
    });
    expect(job.status, job.error).toBe('succeeded');
    const [outcome] = job.summary.waves;
    expect(outcome).toMatchObject({
      waveId: SMOKE,
      results: 6,
      imported: 5,
      linked: 5,
      notInCatalog: 1,
      keptWfmVerdicts: 0,
      status: 'failed',
    });
    executionId = outcome.executionId;

    const suites = await privilegedDb
      .select({ name: testSuites.name })
      .from(testSuites)
      .where(eq(testSuites.organizationId, organizationId));
    expect(suites.map((s) => s.name).sort()).toEqual([
      'QA hub · DMO Archiving',
      'QA hub · DMO Sales',
    ]);

    const [plan] = await privilegedDb
      .select()
      .from(testPlans)
      .where(eq(testPlans.id, outcome.testPlanId));
    expect(plan.name).toBe('QA wave · DMO 3.0.4 - Smoke Master');
    const selected = await privilegedDb
      .select()
      .from(testPlanSelectedTests)
      .where(eq(testPlanSelectedTests.testPlanId, plan.id));
    expect(selected).toHaveLength(5);

    const [run] = await privilegedDb
      .select()
      .from(testPlanExecutions)
      .where(eq(testPlanExecutions.id, executionId));
    expect(run).toMatchObject({
      status: 'failed',
      triggeredBy: 'hub-import',
      totalTests: 6,
      passedTests: 2,
      failedTests: 1,
      skippedTests: 2,
    });
    expect(run.startedAt.toISOString().slice(0, 10)).toBe('2026-04-22');

    const results = await privilegedDb
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
    const byName = Object.fromEntries(results.map((r) => [r.testName, r]));
    expect(byName.SAL_TC_09999).toMatchObject({ status: 'Passed', uiTestId: null });
    const failed = results.find((r) => r.status === 'Failed')!;
    expect(failed.reasonForFailure).toBe('Search returns nothing — Bug 312345');
    const log = readManualLog(failed.detailedLog)!;
    expect(log.steps.length).toBeGreaterThan(0);
    expect(log.verdict).toMatchObject({
      outcome: 'failed',
      imported: { source: 'qa-hub', waveId: SMOKE, tester: 'Pat', bugReference: '312345' },
    });
    const onHold = results.find((r) => r.reasonForFailure === 'Environment down')!;
    expect(onHold.status).toBe('Skipped');
    expect(readManualLog(onHold.detailedLog)!.verdict!.outcome).toBe('blocked');
    const pending = results.filter((r) => r.status === 'Pending');
    expect(pending).toHaveLength(1);
    expect(readManualLog(pending[0].detailedLog)!.verdict).toBeUndefined();

    const wave = await waveRow(SMOKE);
    expect(wave).toMatchObject({ executionId, testPlanId: plan.id, materializedBy: editor.id });
    expect(await auditRows('testcase_hub.waves_imported')).toHaveLength(1);
  });

  it('imports again into the same run, keeping the verdicts given in WFM since', async () => {
    // A tester finishes the pending case in WFM.
    const [pending] = await privilegedDb
      .select()
      .from(reportTestCaseResults)
      .where(
        and(
          eq(reportTestCaseResults.testPlanExecutionId, executionId),
          eq(reportTestCaseResults.status, 'Pending'),
        ),
      );
    const log = readManualLog(pending.detailedLog)!;
    const given: ManualResultLog = {
      ...log,
      verdict: {
        outcome: 'passed',
        notes: 'Done in WFM',
        stepOutcomes: [],
        byUserId: editor.id,
        byUsername: editor.username,
        at: '2026-04-25T10:00:00.000Z',
      },
    };
    await privilegedDb
      .update(reportTestCaseResults)
      .set({ status: 'Passed', detailedLog: JSON.stringify(given) })
      .where(eq(reportTestCaseResults.id, pending.id));

    // And the QA team re-tests the failed one in the hub.
    await writeSmoke({ arc2: 'passed' });
    expect((await runJob('/api/testcase-hub/waves/sync')).summary).toMatchObject({ updated: 1 });
    const wave = await waveRow(SMOKE);
    const listed = await request(app).get('/api/testcase-hub/waves');
    expect(listed.body.find((w: any) => w.waveId === SMOKE).changedSinceImport).toBe(true);

    const job = await runJob('/api/testcase-hub/waves/import', { waveIds: [wave.id], projectId });
    const [outcome] = job.summary.waves;
    expect(outcome).toMatchObject({
      executionId,
      testPlanId: wave.testPlanId,
      imported: 0,
      keptWfmVerdicts: 1,
      status: 'completed',
    });
    const results = await privilegedDb
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
    expect(results).toHaveLength(6);
    expect(results.filter((r) => r.status === 'Pending')).toHaveLength(0);
    expect(
      results.some((r) => readManualLog(r.detailedLog)?.verdict?.notes === 'Done in WFM'),
    ).toBe(true);
    expect(
      await privilegedDb
        .select()
        .from(testPlanExecutions)
        .where(eq(testPlanExecutions.organizationId, organizationId)),
    ).toHaveLength(1);
    expect((await waveRow(SMOKE)).materializedHash).toBe(wave.contentHash);
  });

  it('refuses a wave that does not exist, and a project the user cannot edit', async () => {
    const missing = await request(app)
      .post('/api/testcase-hub/waves/import')
      .send({ waveIds: [999999], projectId });
    expect(missing.status).toBe(404);
    const smoke = await waveRow(SMOKE);
    const foreign = await request(app)
      .post('/api/testcase-hub/waves/import')
      .send({ waveIds: [smoke.id], projectId: 999999 });
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    expect(foreign.status).toBeLessThan(500);
  });

  it('exports the results in the hub format, with the WFM verdicts as one more execution', async () => {
    const smoke = await waveRow(SMOKE);
    const noModule = await request(app).get(`/api/testcase-hub/waves/${smoke.id}/export`);
    expect(noModule.status).toBe(400);
    const res = await request(app).get(
      `/api/testcase-hub/waves/${smoke.id}/export?module=${encodeURIComponent('DMO Sales')}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('results_DMO_Sales.json');
    const file = JSON.parse(res.text);
    expect(file).toMatchObject({
      schema_version: 'qa_wave_results_v1',
      wave_id: SMOKE,
      module: 'DMO Sales',
    });
    const done = file.results.find((r: any) => r.tc_id === 'SAL_TC_00011');
    expect(done).toMatchObject({
      execution_status: 'passed',
      tester: 'waves-editor',
      notes: 'Done in WFM',
    });
    expect(done.executions).toEqual([
      expect.objectContaining({ execution_number: 1, execution_status: 'passed' }),
    ]);

    const csvRes = await request(app).get(`/api/testcase-hub/waves/${smoke.id}/export?format=csv`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    const lines = csvRes.text.trim().split('\r\n');
    expect(lines).toHaveLength(7);
    expect(lines.find((l) => l.includes('SAL_TC_00011'))).toContain('"yes"');
  });

  it('makes a new session of the failed and blocked cases of a wave', async () => {
    const smoke = await waveRow(SMOKE);
    const res = await request(app)
      .post(`/api/testcase-hub/waves/${smoke.id}/session`)
      .send({ statuses: ['on_hold', 'not_tested'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.tests).toBe(2);
    const selected = await privilegedDb
      .select({ testId: testPlanSelectedTests.testId })
      .from(testPlanSelectedTests)
      .where(eq(testPlanSelectedTests.testPlanId, res.body.testPlanId));
    const names = await privilegedDb
      .select({ id: tests.id, name: tests.name })
      .from(tests)
      .where(eq(tests.organizationId, organizationId));
    const nameOf = new Map(names.map((t) => [t.id, t.name]));
    expect(selected.map((s) => nameOf.get(s.testId!)).every(Boolean)).toBe(true);
    expect(await auditRows('testcase_hub.wave_session_created')).toHaveLength(1);

    const none = await request(app)
      .post(`/api/testcase-hub/waves/${smoke.id}/session`)
      .send({ modules: ['Nowhere'] });
    expect(none.status).toBe(409);
  });
});
