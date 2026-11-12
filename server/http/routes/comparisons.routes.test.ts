import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { and, eq } from 'drizzle-orm';
import {
  auditLog,
  comparisonResults,
  comparisonRuns,
  environments,
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
vi.mock('../../execution/comparisons', async () => {
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
