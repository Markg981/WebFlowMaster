import { describe, it, expect, beforeAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../../platform/db';
import {
  projects,
  reportTestCaseResults,
  testPlanExecutions,
  testPlans,
  tests,
} from '@shared/schema';
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
 * The plan report must hand out the detail of a test (steps, log, network capture, AI analysis)
 * only to a caller who may see that test's project (audit A-01): every list in it, not just the
 * failure list.
 */

let app: express.Express;
let organizationId: number;
let creator: number;
let executionId: string;
let currentUser: { id: number; organizationId: number; role: string };

const logOf = (name: string) =>
  JSON.stringify([{ stepName: `type password for ${name}`, status: 'passed' }]);
const LOG = logOf('Open page');
const NETWORK = { totalRequests: 7 };

beforeAll(async () => {
  organizationId = await createTestOrganization('Plan Report Org');
  creator = await createTestUser(organizationId, 'plan-report-creator');
  const { default: routes } = await import('./test-plans.routes');
  const { runWithTenant } = await import('../../platform/middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(organizationId, () => next(), { userId: currentUser.id, role: currentUser.role });
  });
  app.use(routes);

  const planId = uuidv4();
  executionId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'Report', userId: creator, organizationId });
  await privilegedDb
    .insert(testPlanExecutions)
    .values({ id: executionId, testPlanId: planId, organizationId, status: 'Completed' } as any);
  const [secret] = await privilegedDb
    .insert(projects)
    .values({ name: 'Secret', userId: creator, organizationId, restricted: true })
    .returning();
  const [hidden] = await privilegedDb
    .insert(tests)
    .values({
      name: 'Payroll login',
      url: 'https://x.test',
      sequence: [],
      elements: [],
      userId: creator,
      organizationId,
      projectId: secret.id,
    } as any)
    .returning();
  const row = (name: string, uiTestId: number | null, status: string) => ({
    id: uuidv4(),
    organizationId,
    testPlanExecutionId: executionId,
    uiTestId,
    testName: name,
    testType: 'ui',
    status,
    startedAt: new Date(),
    detailedLog: logOf(name),
    networkSummary: NETWORK,
    aiAnalysis: `analysis of ${name}`,
  });
  await privilegedDb
    .insert(reportTestCaseResults)
    .values([row('Payroll login', hidden.id, 'Passed'), row('Open page', null, 'Passed')] as any);
});

describe('GET /api/test-plan-executions/:executionId/report and restricted projects (A-01)', () => {
  it('blanks the detail of a restricted-project test in every list for a member not on it', async () => {
    currentUser = { id: await createTestUser(organizationId), organizationId, role: 'viewer' };
    const res = await request(app)
      .get(`/api/test-plan-executions/${executionId}/report`)
      .expect(200);
    const all = res.body.allTests as any[];
    const secret = all.find((t) => t.testName === 'Payroll login');
    const open = all.find((t) => t.testName === 'Open page');
    expect(secret).toMatchObject({ status: 'Passed', detailedLog: null, networkSummary: null });
    expect(secret.aiAnalysis).toBeNull();
    // The grouped table is the other list that spread the raw row.
    const grouped = Object.values(res.body.testGroupings as Record<string, any>)
      .flatMap((m: any) => Object.values(m.components))
      .flatMap((c: any) => c.tests) as any[];
    const groupedSecret = grouped.find((t) => t.testName === 'Payroll login');
    expect(groupedSecret.steps).toEqual([]);
    expect(groupedSecret.detailedLog).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('password for Payroll login');
    expect(JSON.stringify(res.body)).not.toContain('analysis of Payroll login');
    // The rest of the run keeps its detail.
    expect(open.detailedLog).toBe(LOG);
    expect(open.aiAnalysis).toBe('analysis of Open page');
  });

  it('keeps the detail for the organization owner', async () => {
    currentUser = { id: creator, organizationId, role: 'owner' };
    const res = await request(app)
      .get(`/api/test-plan-executions/${executionId}/report`)
      .expect(200);
    const secret = (res.body.allTests as any[]).find((t) => t.testName === 'Payroll login');
    expect(secret.detailedLog).toBe(logOf('Payroll login'));
    expect(secret.aiAnalysis).toBe('analysis of Payroll login');
  });
});
