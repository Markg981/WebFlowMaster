import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { auditLog, reportTestCaseResults, testPlanExecutions, testPlans } from '@shared/schema';
import { isManualSequence, manualStepsOf, readManualLog, toSequence, type ManualResultLog } from '@shared/manual-tests';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * A person's verdict on a manual test, and what it does to the run it belongs to: the run's
 * counts and passed/failed status are the results', so a manual failure fails the run and a
 * manual pass can complete one that was only waiting for it.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };
let planId: string;

const steps = [
  { action: 'Open the order', expected: 'The order is shown' },
  { action: 'Press Refund', expected: 'The status is Refunded' },
];

beforeAll(async () => {
  organizationId = await createTestOrganization('Manual Org');
  userId = await createTestUser(organizationId, 'manual-user');
  otherOrganizationId = await createTestOrganization('Other Manual Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-manual-user');

  const { default: routes } = await import('./manual-results.routes');
  const { runWithTenant } = await import('../middleware/tenancy');
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = currentUser;
    (req as any).isAuthenticated = () => true;
    runWithTenant(currentUser.organizationId, () => next());
  });
  app.use(routes);
});

beforeEach(async () => {
  await privilegedDb.delete(reportTestCaseResults);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  currentUser = { id: userId, username: 'manual-user', organizationId, role: 'editor' };
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Mixed', userId, organizationId } as any);
});

async function seedRun(status: string, results: Array<{ status: string; manual?: boolean; quarantined?: boolean }>) {
  const executionId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId, organizationId, testPlanId: planId, status, triggeredBy: 'manual',
    totalTests: results.length,
  } as any);
  const ids: string[] = [];
  for (const [index, result] of results.entries()) {
    const id = uuidv4();
    ids.push(id);
    const log: ManualResultLog = { manual: true, steps };
    await privilegedDb.insert(reportTestCaseResults).values({
      id, organizationId, testPlanExecutionId: executionId, testType: 'ui', testName: `Test ${index + 1}`,
      status: result.status, quarantined: result.quarantined ?? false,
      detailedLog: result.manual ? JSON.stringify(log) : JSON.stringify([{ name: 'click', status: 'passed' }]),
      startedAt: new Date(),
    } as any);
  }
  return { executionId, ids };
}

const verdict = (executionId: string, resultId: string, body: unknown) =>
  request(app).put(`/api/test-plan-executions/${executionId}/results/${resultId}/manual-verdict`).send(body);

const runRow = async (id: string) =>
  (await privilegedDb.select().from(testPlanExecutions).where(eq(testPlanExecutions.id, id)))[0];

describe('manual steps in a sequence', () => {
  it('round-trip, and make a test manual only when every step is one', () => {
    const sequence = toSequence(steps);
    expect(isManualSequence(sequence)).toBe(true);
    expect(isManualSequence(JSON.stringify(sequence))).toBe(true);
    expect(manualStepsOf(sequence)).toEqual(steps);
    expect(isManualSequence([...sequence, { action: { id: 'click' } }])).toBe(false);
    expect(isManualSequence([])).toBe(false);
    expect(readManualLog('[{"name":"x"}]')).toBeNull();
    expect(readManualLog(JSON.stringify({ manual: true, steps }))?.steps).toEqual(steps);
  });
});

describe('recording a manual verdict', () => {
  it('passes a waiting manual test, and completes the run', async () => {
    const { executionId, ids } = await seedRun('completed', [{ status: 'Passed' }, { status: 'Pending', manual: true }]);

    const res = await verdict(executionId, ids[1], {
      outcome: 'passed',
      stepOutcomes: [{ outcome: 'passed' }, { outcome: 'passed' }],
    });

    expect(res.status).toBe(200);
    expect(res.body.run).toMatchObject({ status: 'completed', passedTests: 2, failedTests: 0, totalTests: 2 });
    const [row] = await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.id, ids[1]));
    expect(row.status).toBe('Passed');
    expect(readManualLog(row.detailedLog)?.verdict).toMatchObject({ outcome: 'passed', byUsername: 'manual-user' });
    const audit = await privilegedDb.select().from(auditLog).where(eq(auditLog.targetId, executionId));
    expect(audit.map((entry) => entry.action)).toContain('run.manual_result_recorded');
  });

  it('fails the run on a manual failure, with the notes as the reason', async () => {
    const { executionId, ids } = await seedRun('completed', [{ status: 'Passed' }, { status: 'Pending', manual: true }]);

    await verdict(executionId, ids[1], { outcome: 'failed', notes: 'Refund button missing' });

    expect(await runRow(executionId)).toMatchObject({ status: 'failed', failedTests: 1 });
    const [row] = await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.id, ids[1]));
    expect(row.reasonForFailure).toBe('Refund button missing');
  });

  it('counts a blocked test with the skipped, and a later pass brings the run back to completed', async () => {
    const { executionId, ids } = await seedRun('completed', [{ status: 'Pending', manual: true }]);

    await verdict(executionId, ids[0], { outcome: 'failed' });
    expect((await runRow(executionId)).status).toBe('failed');
    await verdict(executionId, ids[0], { outcome: 'blocked', notes: 'Staging down' });
    expect(await runRow(executionId)).toMatchObject({ status: 'completed', skippedTests: 1, failedTests: 0 });
  });

  it('leaves a cancelled run cancelled', async () => {
    const { executionId, ids } = await seedRun('cancelled', [{ status: 'Pending', manual: true }]);
    await verdict(executionId, ids[0], { outcome: 'failed' });
    expect((await runRow(executionId)).status).toBe('cancelled');
  });

  it('refuses an automated result, a run still going, and step outcomes that do not match the steps', async () => {
    const done = await seedRun('completed', [{ status: 'Passed' }, { status: 'Pending', manual: true }]);
    expect((await verdict(done.executionId, done.ids[0], { outcome: 'failed' })).status).toBe(409);
    expect((await verdict(done.executionId, done.ids[1], { outcome: 'passed', stepOutcomes: [{ outcome: 'passed' }] })).status).toBe(400);
    expect((await verdict(done.executionId, done.ids[1], { outcome: 'maybe' })).status).toBe(400);

    const running = await seedRun('running', [{ status: 'Pending', manual: true }]);
    expect((await verdict(running.executionId, running.ids[0], { outcome: 'passed' })).status).toBe(409);
  });

  it('does not reach another organization’s run', async () => {
    const { executionId, ids } = await seedRun('completed', [{ status: 'Pending', manual: true }]);
    currentUser = { id: otherUserId, username: 'other-manual-user', organizationId: otherOrganizationId, role: 'owner' };
    expect((await verdict(executionId, ids[0], { outcome: 'passed' })).status).toBe(404);
  });
});
