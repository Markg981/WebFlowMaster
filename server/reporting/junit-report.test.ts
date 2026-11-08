import { describe, it, expect, beforeAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from '../platform/db';
import { runWithTenant } from '../platform/middleware/tenancy';
import {
  projects,
  reportTestCaseResults,
  testPlanExecutions,
  testPlans,
  tests,
} from '@shared/schema';
import { createTestOrganization, createTestUser } from '../tests/factories';
import { junitReportFor } from './junit-report';

vi.mock('../platform/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), debug: vi.fn() },
  updateLogLevel: vi.fn(),
}));

/**
 * The JUnit export (also served to API keys, whose acting user is the principal) carries the
 * matrix evidence of a test only for a caller who may see its project (audit M-02).
 */

const EVIDENCE = JSON.stringify([
  {
    matrixEvidence: {
      version: 1,
      route: 'local',
      requested: {},
      effective: { browser: 'secret-evidence' },
      observedAt: '2026-01-01T00:00:00.000Z',
      source: 'runtime',
      verdict: 'matched',
      differences: [],
    },
  },
]);
let organizationId: number;
let creator: number;
let executionId: string;

beforeAll(async () => {
  organizationId = await createTestOrganization('Junit Scope Org');
  creator = await createTestUser(organizationId, 'junit-scope-creator');
  const planId = uuidv4();
  executionId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'J', userId: creator, organizationId });
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
  await privilegedDb.insert(reportTestCaseResults).values([
    {
      id: uuidv4(),
      organizationId,
      testPlanExecutionId: executionId,
      uiTestId: hidden.id,
      testName: 'Payroll login',
      testType: 'ui',
      status: 'Passed',
      startedAt: new Date(),
      detailedLog: EVIDENCE,
    },
  ] as any);
});

const asUser = (id: number, role: string) =>
  runWithTenant(organizationId, () => junitReportFor(executionId), { userId: id, role });

describe('junitReportFor and restricted projects (M-02)', () => {
  it('keeps the verdict but drops the evidence of a test the caller cannot see', async () => {
    const outsider = await createTestUser(organizationId);
    const xml = await asUser(outsider, 'viewer');
    expect(xml).toContain('Payroll login');
    expect(xml).not.toContain('secret-evidence');
  });

  it('keeps the evidence for the owner', async () => {
    const xml = await asUser(creator, 'owner');
    expect(xml).toContain('secret-evidence');
  });
});
