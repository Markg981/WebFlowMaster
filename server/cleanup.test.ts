import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { reportTestCaseResults, testPlanExecutions, testPlanSelectedTests, testPlans, tests as testsTable, users, type Cleanup } from '@shared/schema';
import { createTestOrganization } from './tests/factories';
import { cleanupReportStep, runCleanups } from './cleanup-runner';
import { describeChange } from './test-versions';

/**
 * A test's cleanup: the calls after it that remove what it created. The application under test is
 * a small server here that records what it was asked to delete; the browser part of a run is
 * stood in for, as in run-policies-execution.test.ts, and stores {{orderId}} as a step would.
 */

const executeTestSequence = vi.fn();
const runPreconditions = vi.fn();
vi.mock('./playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));
vi.mock('./precondition-runner', () => ({
  runPreconditions: (...args: any[]) => runPreconditions(...args),
}));

const { processTestPlanJob } = await import('./test-execution-service');

let server: http.Server;
let base: string;
const received: string[] = [];
/** The orders the application holds: deleting one twice answers 404 the second time. */
let orders: Set<string>;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    received.push(`${req.method} ${req.url}`);
    const match = /^\/orders\/(\w+)$/.exec(req.url ?? '');
    if (req.method === 'DELETE' && match) {
      const found = orders.delete(match[1]);
      res.writeHead(found ? 204 : 404).end();
      return;
    }
    if (req.url === '/broken') return void res.writeHead(500).end('no');
    res.writeHead(200).end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const call = (name: string, url: string, extra: Partial<Cleanup> = {}): Cleanup => ({ id: name, name, method: 'DELETE', url, ...extra });

describe('running the cleanup', () => {
  beforeEach(() => {
    received.length = 0;
    orders = new Set(['7', '8']);
  });

  it('calls each, with the variables the run ended with, and counts 404 as already gone', async () => {
    const result = await runCleanups([call('Delete order', `${base}/orders/{{orderId}}`)], [{ orderId: '7' }, { orderId: '7' }]);
    expect(received).toEqual(['DELETE /orders/7', 'DELETE /orders/7']);
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => [s.name, s.status])).toEqual([
      ['Row 1 — Delete order', 'done'],
      ['Row 2 — Delete order', 'gone'],
    ]);
  });

  it('does not call a URL with a variable the run never set, and says so', async () => {
    const result = await runCleanups([call('Delete order', `${base}/orders/{{orderId}}`)], [{ baseUrl: base }]);
    expect(received).toEqual([]);
    expect(result).toMatchObject({ ok: true, steps: [{ status: 'skipped', detail: expect.stringContaining('{{orderId}}') }] });
  });

  it('attempts every call even after one fails, and reports the failure', async () => {
    const result = await runCleanups([call('Broken', `${base}/broken`, { method: 'POST' }), call('Delete order', `${base}/orders/8`)], [{}]);
    expect(received).toEqual(['POST /broken', 'DELETE /orders/8']);
    expect(result.ok).toBe(false);
    const step = cleanupReportStep(result);
    expect(step).toMatchObject({ name: 'Cleanup', type: 'cleanup', status: 'failed', error: expect.stringContaining('HTTP 500') });
  });

  it('takes other statuses as already gone when asked', async () => {
    const result = await runCleanups([call('Broken', `${base}/broken`, { satisfiedStatuses: [500] })], [{}]);
    expect(result.steps[0].status).toBe('gone');
  });

  it('counts as a change in the test\'s history', () => {
    const before = { name: 't', url: 'u', sequence: [], elements: [], cleanups: [call('a', `${base}/orders/1`)] };
    expect(describeChange(before, { ...before, cleanups: [call('a', `${base}/orders/2`)] })).toBe('Cleanup changed.');
    expect(describeChange(before, { ...before, cleanups: [] })).toBe('Cleanup 1 → 0.');
  });
});

describe('in a plan run', () => {
  let organizationId: number;
  let userId: number;
  let planId: string;

  beforeEach(async () => {
    received.length = 0;
    orders = new Set(['42']);
    await privilegedDb.delete(reportTestCaseResults);
    await privilegedDb.delete(testPlanSelectedTests);
    await privilegedDb.delete(testPlanExecutions);
    await privilegedDb.delete(testPlans);
    await privilegedDb.delete(testsTable);
    await privilegedDb.delete(users);
    organizationId = await createTestOrganization('Cleanup Org');
    const [user] = await privilegedDb.insert(users).values({ username: `cleanup-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId }).returning();
    userId = user.id;
    executeTestSequence.mockReset();
    runPreconditions.mockReset();
    runPreconditions.mockResolvedValue({ ok: true, steps: [] });
  });

  afterEach(async () => {
    if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
  });

  async function run(cleanups: Cleanup[]) {
    planId = uuidv4();
    await privilegedDb.insert(testPlans).values({ id: planId, name: 'Cleanup', userId, organizationId } as any);
    const [test] = await privilegedDb
      .insert(testsTable)
      .values({ userId, organizationId, name: 'Order', url: `${base}/shop`, sequence: [], elements: [], cleanups })
      .returning();
    await privilegedDb.insert(testPlanSelectedTests).values({ testPlanId: planId, testType: 'ui', testId: test.id, organizationId } as any);
    const executionId = uuidv4();
    await privilegedDb.insert(testPlanExecutions).values({ id: executionId, organizationId, testPlanId: planId, status: 'queued', triggeredBy: 'manual' } as any);
    await processTestPlanJob(planId, executionId, userId);
    const [result] = await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
    return { result, steps: JSON.parse(result.detailedLog ?? '[]') as Array<{ name: string; type: string; status: string }> };
  }

  it('deletes what the test stored, after a failure too, without changing the result', async () => {
    executeTestSequence.mockImplementation(async (_test, _user, _dir, _run, vars, _env, options) => {
      options.onVariables({ ...vars, orderId: '42' });
      return { success: false, steps: [{ name: 'Pay', type: 'click', status: 'failed', error: 'Button not found' }], duration: 5 };
    });
    const { result, steps } = await run([call('Delete order', `${base}/orders/{{orderId}}`)]);
    expect(received).toEqual(['DELETE /orders/42']);
    expect(result.status).toBe('Failed');
    expect(steps.at(-1)).toMatchObject({ name: 'Cleanup', type: 'cleanup', status: 'passed' });
  });

  it('runs after a precondition blocked the test, with the environment\'s variables', async () => {
    runPreconditions.mockResolvedValue({ ok: false, steps: [], failedAt: 'Create order', reason: 'HTTP 500' });
    const { steps } = await run([call('Delete order', `${base}/orders/42`), call('Delete by id', `${base}/orders/{{orderId}}`)]);
    expect(executeTestSequence).not.toHaveBeenCalled();
    expect(received).toEqual(['DELETE /orders/42']);
    expect(steps.at(-1)).toMatchObject({ name: 'Cleanup', status: 'passed' });
  });

  it('keeps a passed test passed when its cleanup fails, and shows the failure', async () => {
    executeTestSequence.mockResolvedValue({ success: true, steps: [{ name: 'Pay', type: 'click', status: 'passed' }], duration: 5 });
    const { result, steps } = await run([call('Broken', `${base}/broken`)]);
    expect(result.status).toBe('Passed');
    expect(steps.at(-1)).toMatchObject({ name: 'Cleanup', status: 'failed' });
  });
});
