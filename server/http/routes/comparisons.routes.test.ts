import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { and, eq } from 'drizzle-orm';
import {
  auditLog,
  comparisonKnownDifferences,
  comparisonResults,
  comparisonRuns,
  environments,
  projects,
  reportTestCaseResults,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  tests,
} from '@shared/schema';
import { emptyVerdictCounts } from '@shared/comparison';
import { privilegedDb } from '../../platform/db';
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

// The real comparison orchestrator over a queue that accepts every job and runs none.
vi.mock('../../integrations/comparisons', async () => {
  const { createComparisonOrchestrator } = await import('../../execution/comparison-orchestrator');
  const { createExecutionOrchestrator } = await import('../../execution/execution-orchestrator');
  const queue = {
    add: async (_name: string, _data: unknown, options: { jobId: string }) => ({
      id: options.jobId,
    }),
  };
  return {
    comparisonOrchestrator: createComparisonOrchestrator({
      executions: createExecutionOrchestrator(queue as any),
      engine: async () => {
        throw new Error('not computed in these tests');
      },
    }),
  };
});

/**
 * Comparisons over HTTP: who may start and cancel one, what another organization sees, and how
 * results come back — the list without differences, one result with its steps and links.
 */

let app: express.Express;
let organizationId: number;
let otherOrganizationId: number;
let editorId: number;
let viewerId: number;
let otherUserId: number;
let planId: string;
let otherPlanId: string;
let prodId: number;
let stagingId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };

const asEditor = () => {
  currentUser = { id: editorId, username: 'cmp-editor', organizationId, role: 'editor' };
};
const asViewer = () => {
  currentUser = { id: viewerId, username: 'cmp-viewer', organizationId, role: 'viewer' };
};
const asOutsider = () => {
  currentUser = {
    id: otherUserId,
    username: 'cmp-outsider',
    organizationId: otherOrganizationId,
    role: 'editor',
  };
};

async function plan(orgId: number, userId: number) {
  const id = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id, name: 'Parity plan', userId, organizationId: orgId } as any);
  const [test] = await privilegedDb
    .insert(tests)
    .values({
      userId,
      organizationId: orgId,
      name: 'checkout',
      url: 'https://example.test/checkout',
      sequence: [],
      elements: [],
    })
    .returning();
  await privilegedDb
    .insert(testPlanSelectedTests)
    .values({ testPlanId: id, testType: 'ui', testId: test.id, organizationId: orgId } as any);
  return id;
}

beforeAll(async () => {
  organizationId = await createTestOrganization('Comparison Routes Org');
  otherOrganizationId = await createTestOrganization('Other Comparison Routes Org');
  editorId = await createTestUser(organizationId, `cmp-editor-${uuidv4().slice(0, 6)}`);
  viewerId = await createTestUser(organizationId, `cmp-viewer-${uuidv4().slice(0, 6)}`);
  otherUserId = await createTestUser(otherOrganizationId, `cmp-other-${uuidv4().slice(0, 6)}`);
  planId = await plan(organizationId, editorId);
  otherPlanId = await plan(otherOrganizationId, otherUserId);
  const [prod, staging] = await privilegedDb
    .insert(environments)
    .values([
      { name: 'prod', userId: editorId, organizationId },
      { name: 'staging', userId: editorId, organizationId },
    ])
    .returning();
  prodId = prod.id;
  stagingId = staging.id;

  const { default: routes } = await import('./comparisons.routes');
  const { runWithTenant } = await import('../../platform/middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: typeof currentUser }).user = currentUser;
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next(), {
      userId: currentUser.id,
      role: currentUser.role,
    });
  });
  app.use(routes);
});

beforeEach(asEditor);

const start = (body: Record<string, unknown> = {}, key?: string) => {
  const call = request(app).post(`/api/test-plans/${planId}/comparisons`);
  if (key) call.set('Idempotency-Key', key);
  return call.send({ baselineEnvironmentId: prodId, candidateEnvironmentId: stagingId, ...body });
};

const audits = (action: string, targetId: string) =>
  privilegedDb
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));

describe('starting a comparison', () => {
  it('starts it for an editor, once per key, and records who did', async () => {
    const key = `key-${uuidv4()}`;
    const first = await start({ name: 'Angular 22' }, key).expect(202);
    expect(first.body).toMatchObject({ status: 'running', created: true });
    const again = await start({ name: 'Angular 22' }, key).expect(202);
    expect(again.body).toMatchObject({ id: first.body.id, created: false });

    const entries = await audits('comparison.created', first.body.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata).toMatchObject({ planId, mode: 'sequential' });
  });

  it('refuses a viewer, an invalid body, and a plan of another organization', async () => {
    asViewer();
    await start().expect(403);
    asEditor();
    const same = await start({ candidateEnvironmentId: prodId }).expect(400);
    expect(JSON.stringify(same.body.details)).toContain('candidateEnvironmentId');
    await request(app)
      .post(`/api/test-plans/${otherPlanId}/comparisons`)
      .send({ baselineEnvironmentId: prodId, candidateEnvironmentId: stagingId })
      .expect(404);
  });
});

describe('reading comparisons', () => {
  it('lists and shows one with its runs to a viewer, and nothing to another organization', async () => {
    const { body } = await start().expect(202);
    asViewer();
    const list = await request(app).get(`/api/comparisons?planId=${planId}`).expect(200);
    expect(list.body.rows.map((r: { id: string }) => r.id)).toContain(body.id);
    expect(list.body).toMatchObject({ page: 1, pageSize: 25 });
    expect(list.body.rows[0]).not.toHaveProperty('idempotencyKey');

    const one = await request(app).get(`/api/comparisons/${body.id}`).expect(200);
    expect(one.body).toMatchObject({
      id: body.id,
      planName: 'Parity plan',
      baseline: { environmentName: 'prod' },
      candidate: { environmentName: 'staging', executionId: null },
      baselineRun: { comparison: { id: body.id, role: 'baseline' } },
      candidateRun: null,
    });
    expect(one.body.baselineRun).not.toHaveProperty('configurationSnapshot');

    asOutsider();
    await request(app).get(`/api/comparisons/${body.id}`).expect(404);
    const theirs = await request(app).get('/api/comparisons').expect(200);
    expect(theirs.body.rows.map((r: { id: string }) => r.id)).not.toContain(body.id);
  });

  it('pages results without differences, and gives one with its steps and screenshot links', async () => {
    const baselineId = uuidv4();
    const candidateId = uuidv4();
    for (const id of [baselineId, candidateId])
      await privilegedDb.insert(testPlanExecutions).values({
        id,
        organizationId,
        testPlanId: planId,
        status: 'completed',
        triggeredBy: 'manual',
        startedAt: new Date(),
      } as any);
    const shot = (executionId: string) => `/results/${planId}/${executionId}/step-1.png`;
    const resultOf = async (executionId: string) => {
      const id = uuidv4();
      await privilegedDb.insert(reportTestCaseResults).values({
        id,
        organizationId,
        testPlanExecutionId: executionId,
        testType: 'ui',
        testName: 'checkout',
        browser: 'chromium',
        status: 'Passed',
        startedAt: new Date(),
        detailedLog: JSON.stringify([
          { stepId: 'open', name: 'Open', status: 'passed', screenshot: shot(executionId) },
        ]),
      });
      return id;
    };
    const [comparison] = await privilegedDb
      .insert(comparisonRuns)
      .values({
        id: uuidv4(),
        organizationId,
        testPlanId: planId,
        baselineEnvironmentName: 'prod',
        candidateEnvironmentName: 'staging',
        baselineExecutionId: baselineId,
        candidateExecutionId: candidateId,
        status: 'completed',
        verdict: 'regressions',
        summary: { total: 2, byVerdict: emptyVerdictCounts(), byModule: [], droppedDifferences: 0 },
      })
      .returning();
    const visualId = uuidv4();
    await privilegedDb.insert(comparisonResults).values([
      {
        id: visualId,
        organizationId,
        comparisonRunId: comparison.id,
        pairKey: 'unit:a',
        testType: 'ui',
        testName: 'checkout',
        module: 'Cart',
        baselineResultId: await resultOf(baselineId),
        candidateResultId: await resultOf(candidateId),
        verdict: 'different',
        differences: [
          {
            stepId: 'open',
            stepIndex: 0,
            checkpoint: null,
            kind: 'visual',
            path: 'pixels',
            baseline: { screenshot: shot(baselineId), width: 10, height: 10 },
            candidate: { screenshot: shot(candidateId), width: 10, height: 10, diffRatio: 0.3 },
            severity: 'blocking',
          },
        ],
      },
      {
        id: uuidv4(),
        organizationId,
        comparisonRunId: comparison.id,
        pairKey: 'unit:b',
        testType: 'ui',
        testName: 'login',
        verdict: 'identical',
      },
    ]);

    asViewer();
    const list = await request(app).get(`/api/comparisons/${comparison.id}/results`).expect(200);
    expect(list.body.total).toBe(2);
    const different = list.body.rows.find((r: { id: string }) => r.id === visualId);
    expect(different).toMatchObject({ verdict: 'different', differenceCount: 1 });
    expect(different).not.toHaveProperty('differences');
    const noModule = await request(app)
      .get(`/api/comparisons/${comparison.id}/results?module=`)
      .expect(200);
    expect(noModule.body.rows.map((r: { testName: string }) => r.testName)).toEqual(['login']);

    const detail = await request(app)
      .get(`/api/comparisons/${comparison.id}/results/${visualId}`)
      .expect(200);
    const link = (executionId: string) =>
      `/api/test-plan-executions/${executionId}/artifacts/step-1.png`;
    expect(detail.body.hidden).toBe(false);
    expect(detail.body.differences[0].baseline.screenshot).toBe(link(baselineId));
    expect(detail.body.differences[0].candidate.screenshot).toBe(link(candidateId));
    expect(detail.body.steps.candidate[0]).toMatchObject({
      stepId: 'open',
      screenshot: link(candidateId),
    });

    await request(app).get(`/api/comparisons/${comparison.id}/results/${uuidv4()}`).expect(404);
    asOutsider();
    await request(app).get(`/api/comparisons/${comparison.id}/results/${visualId}`).expect(404);
  });

  it('exports the parity report as HTML with reviews and tolerances, and no stored paths', async () => {
    const byVerdict = { ...emptyVerdictCounts(), different: 1, identical: 1 };
    const [comparison] = await privilegedDb
      .insert(comparisonRuns)
      .values({
        id: uuidv4(),
        organizationId,
        testPlanId: planId,
        name: 'Angular <22>',
        baselineEnvironmentName: 'prod',
        candidateEnvironmentName: 'staging',
        status: 'completed',
        verdict: 'parity_with_accepted',
        policy: { numeric: { absTolerance: 0.5 } },
        summary: {
          total: 2,
          byVerdict,
          byModule: [{ module: 'Cart', total: 2, byVerdict }],
          droppedDifferences: 0,
        },
      })
      .returning();
    await privilegedDb.insert(comparisonResults).values([
      {
        id: uuidv4(),
        organizationId,
        comparisonRunId: comparison.id,
        pairKey: 'unit:a',
        testType: 'ui',
        testName: 'checkout <total>',
        module: 'Cart',
        verdict: 'different',
        reviewStatus: 'accepted',
        reviewedByUserId: editorId,
        reviewedAt: new Date(),
        reviewNote: 'Rounding changed on purpose',
        differences: [
          {
            stepId: 'total',
            stepIndex: 2,
            checkpoint: 'cart total',
            kind: 'text',
            path: 'texts[0]',
            baseline: '10.01',
            candidate: '10.02',
            severity: 'blocking',
          },
          {
            stepId: 'open',
            stepIndex: 0,
            checkpoint: null,
            kind: 'visual',
            path: 'pixels',
            baseline: { screenshot: '/results/secret/step-1.png', width: 10, height: 10 },
            candidate: { screenshot: '/results/secret/step-2.png', diffRatio: 0.3 },
            severity: 'informative',
          },
        ],
      },
      {
        id: uuidv4(),
        organizationId,
        comparisonRunId: comparison.id,
        pairKey: 'unit:b',
        testType: 'ui',
        testName: 'login',
        module: 'Cart',
        verdict: 'identical',
      },
    ]);

    asViewer();
    const html = await request(app)
      .get(`/api/comparisons/${comparison.id}/export/html`)
      .buffer(true)
      .parse((res, done) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => done(null, body));
      })
      .expect(200);
    expect(html.headers['content-type']).toMatch(/text\/html/);
    expect(html.headers['content-disposition']).toMatch(/attachment; filename="parity-angular-22-/);
    const body = html.body as string;
    expect(body).toContain('Parity with accepted differences');
    expect(body).toContain('Angular &lt;22&gt;');
    expect(body).toContain('checkout &lt;total&gt;');
    expect(body).toContain('Rounding changed on purpose');
    expect(body).toContain('by cmp-editor');
    expect(body).toContain('absolute tolerance 0.5');
    expect(body).toContain('diffRatio');
    expect(body).not.toContain('/results/secret');
    expect(body).not.toContain('<script');

    await request(app).get(`/api/comparisons/${comparison.id}/export/allure`).expect(400);
    await request(app).get(`/api/comparisons/${uuidv4()}/export/html`).expect(404);
    asOutsider();
    await request(app).get(`/api/comparisons/${comparison.id}/export/html`).expect(404);
  });
});

describe('cancelling a comparison', () => {
  it('cancels it for an editor once, records it, and refuses a viewer', async () => {
    const { body } = await start().expect(202);
    asViewer();
    await request(app).post(`/api/comparisons/${body.id}/cancel`).expect(403);
    asEditor();
    const cancelled = await request(app).post(`/api/comparisons/${body.id}/cancel`).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', comparison: { id: body.id } });
    await request(app).post(`/api/comparisons/${body.id}/cancel`).expect(409);
    await request(app).post(`/api/comparisons/${uuidv4()}/cancel`).expect(404);
    expect(await audits('comparison.cancelled', body.id)).toHaveLength(1);
  });
});

async function uiTest(projectId: number | null = null) {
  const [test] = await privilegedDb
    .insert(tests)
    .values({
      userId: editorId,
      organizationId,
      projectId,
      name: 'orders',
      url: 'https://example.test/orders',
      sequence: [],
      elements: [],
    })
    .returning();
  return test.id;
}

/** A completed comparison with one different result of the given test. */
async function comparedResult(uiTestId: number) {
  const [comparison] = await privilegedDb
    .insert(comparisonRuns)
    .values({
      id: uuidv4(),
      organizationId,
      testPlanId: planId,
      baselineEnvironmentName: 'prod',
      candidateEnvironmentName: 'staging',
      status: 'completed',
      verdict: 'regressions',
      summary: { total: 1, byVerdict: emptyVerdictCounts(), byModule: [], droppedDifferences: 0 },
    })
    .returning();
  const cell = (path: string) => ({
    stepId: 's1',
    stepIndex: 0,
    checkpoint: 'orders',
    kind: 'table' as const,
    path,
    baseline: '1',
    candidate: '2',
    severity: 'blocking' as const,
  });
  const resultId = uuidv4();
  await privilegedDb.insert(comparisonResults).values({
    id: resultId,
    organizationId,
    comparisonRunId: comparison.id,
    pairKey: `unit:${resultId}`,
    testType: 'ui',
    uiTestId,
    testName: 'orders',
    verdict: 'different',
    differences: [
      cell('rows[1][2]'),
      cell('rows[2][2]'),
      { ...cell('duration'), kind: 'performance', severity: 'informative' },
    ],
  });
  return { comparisonId: comparison.id, resultId };
}

describe('reviewing a result', () => {
  it('records the review for an editor, refuses a viewer, and an acceptance without a reason', async () => {
    const { comparisonId, resultId } = await comparedResult(await uiTest());
    const review = (body: Record<string, unknown>) =>
      request(app).post(`/api/comparisons/${comparisonId}/results/${resultId}/review`).send(body);
    asViewer();
    await review({ status: 'defect' }).expect(403);
    asEditor();
    await review({ status: 'accepted' }).expect(400);
    await review({ status: 'defect', saveAsKnownDifference: {} }).expect(400);
    const { body } = await review({ status: 'defect', note: 'BUG-12' }).expect(200);
    expect(body.result).toMatchObject({
      reviewStatus: 'defect',
      reviewNote: 'BUG-12',
      reviewedByUserId: editorId,
    });
    expect(body.knownDifferences).toEqual([]);
    const [entry] = await audits('comparison.difference_reviewed', resultId);
    expect(entry.metadata).toMatchObject({ from: 'open', to: 'defect', knownDifferences: 0 });
    const reopened = await review({ status: 'open' }).expect(200);
    expect(reopened.body.result).toMatchObject({ reviewStatus: 'open', reviewedByUserId: null });
    await request(app)
      .post(`/api/comparisons/${comparisonId}/results/${uuidv4()}/review`)
      .send({ status: 'defect' })
      .expect(404);
    asOutsider();
    await review({ status: 'defect' }).expect(404);
  });

  it('saves the open blocking differences as known, scoped to the test by default', async () => {
    const testId = await uiTest();
    const { comparisonId, resultId } = await comparedResult(testId);
    const review = (body: Record<string, unknown>) =>
      request(app).post(`/api/comparisons/${comparisonId}/results/${resultId}/review`).send(body);
    await review({
      status: 'accepted',
      note: 'rounding',
      saveAsKnownDifference: { differences: [7] },
    }).expect(400);
    const { body } = await review({
      status: 'accepted',
      note: 'New rounding of totals',
      saveAsKnownDifference: { reference: 'CHG-1' },
    }).expect(200);
    expect(body.knownDifferences.map((k: { pathPattern: string }) => k.pathPattern).sort()).toEqual(
      ['rows[1][2]', 'rows[2][2]'],
    );
    expect(body.knownDifferences[0]).toMatchObject({
      uiTestId: testId,
      kind: 'table',
      checkpointName: 'orders',
      reason: 'New rounding of totals',
      reference: 'CHG-1',
      approvedByUserId: editorId,
    });
    for (const k of body.knownDifferences)
      expect(await audits('comparison.known_difference_created', k.id)).toHaveLength(1);

    const organizationWide = await review({
      status: 'accepted',
      note: 'everywhere',
      saveAsKnownDifference: { scope: 'organization', differences: [0] },
    }).expect(200);
    expect(organizationWide.body.knownDifferences).toMatchObject([
      { projectId: null, uiTestId: null, pathPattern: 'rows[1][2]' },
    ]);
    await review({
      status: 'accepted',
      note: 'no project',
      saveAsKnownDifference: { scope: 'project' },
    }).expect(422);
  });
});

describe('known differences', () => {
  it('lists, creates and deletes them, with audit, and refuses a viewer', async () => {
    const testId = await uiTest();
    const create = (body: Record<string, unknown>) =>
      request(app).post('/api/comparison-known-differences').send(body);
    asViewer();
    await create({ kind: 'text', reason: 'x' }).expect(403);
    asEditor();
    await create({ kind: 'nope', reason: 'x' }).expect(400);
    await create({ kind: 'text', reason: 'x', expiresAt: '2020-01-01T00:00:00Z' }).expect(400);
    await create({ kind: 'text', reason: 'x', uiTestId: 999_999_999 }).expect(422);
    const { body: created } = await create({
      kind: 'text',
      uiTestId: testId,
      checkpointName: 'banner',
      pathPattern: 'texts[*]',
      reason: 'Release banner',
    }).expect(201);
    expect(created).toMatchObject({ uiTestId: testId, projectId: null, kind: 'text' });
    expect(await audits('comparison.known_difference_created', created.id)).toHaveLength(1);

    asViewer();
    const list = await request(app)
      .get(`/api/comparison-known-differences?uiTestId=${testId}`)
      .expect(200);
    expect(list.body).toMatchObject({ total: 1, rows: [{ id: created.id, testName: 'orders' }] });
    await request(app).delete(`/api/comparison-known-differences/${created.id}`).expect(403);
    asOutsider();
    const outside = await request(app)
      .get(`/api/comparison-known-differences?uiTestId=${testId}`)
      .expect(200);
    expect(outside.body.total).toBe(0);
    await request(app).delete(`/api/comparison-known-differences/${created.id}`).expect(404);

    asEditor();
    await request(app).delete(`/api/comparison-known-differences/${created.id}`).expect(204);
    await request(app).delete(`/api/comparison-known-differences/${created.id}`).expect(404);
    const [deleted] = await audits('comparison.known_difference_deleted', created.id);
    expect(deleted.metadata).toMatchObject({ reason: 'Release banner' });
  });

  it('keeps a restricted project entries to the people on the project', async () => {
    const [restricted] = await privilegedDb
      .insert(projects)
      .values({ name: 'Payroll', userId: editorId, organizationId, restricted: true })
      .returning();
    const id = uuidv4();
    await privilegedDb.insert(comparisonKnownDifferences).values({
      id,
      organizationId,
      projectId: restricted.id,
      kind: 'text',
      reason: 'Restricted',
    });
    asViewer();
    const seen = await request(app)
      .get(`/api/comparison-known-differences?projectId=${restricted.id}`)
      .expect(200);
    expect(seen.body.total).toBe(0);
    asEditor();
    await request(app)
      .post('/api/comparison-known-differences')
      .send({ kind: 'text', reason: 'x', projectId: restricted.id })
      .expect(422);
    await request(app).delete(`/api/comparison-known-differences/${id}`).expect(404);
    const [kept] = await privilegedDb
      .select()
      .from(comparisonKnownDifferences)
      .where(eq(comparisonKnownDifferences.id, id));
    expect(kept).toBeDefined();
  });
});
