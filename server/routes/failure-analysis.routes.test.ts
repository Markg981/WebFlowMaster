import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from '../db';
import { auditLog, reportTestCaseResults, testPlanExecutions, testPlans } from '@shared/schema';
import { buildFailurePrompt, parseFailureAnswer, promptValue } from '../failure-analysis';
import { createTestOrganization, createTestUser } from '../tests/factories';

vi.mock('../logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

const ai = vi.hoisted(() => ({
  available: true,
  explainFailure: vi.fn(),
}));
vi.mock('../ai-automation-service', () => ({
  aiService: {
    isAvailable: () => ai.available,
    explainFailure: ai.explainFailure,
    analysisModel: 'gemini-test',
  },
}));

/**
 * The AI's reading of a failed result: what is sent to the model, what of its answer is believed,
 * and that the reading is kept, so a second look is free.
 */

let app: express.Express;
let organizationId: number;
let userId: number;
let otherOrganizationId: number;
let otherUserId: number;
let currentUser: { id: number; username: string; organizationId: number; role: string };
let planId: string;

const failedLog = [
  { name: 'Open login', type: 'navigate', value: 'https://shop.test/login', status: 'passed' },
  { name: 'Type password', type: 'input', selector: '#password', value: 'Sup3rSecret!', status: 'passed' },
  { name: 'Press Sign in', type: 'click', selector: 'button.btn-login', status: 'failed', error: "Timeout 5000ms exceeded waiting for locator('button.btn-login')" },
];

const answer = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    category: 'locator',
    confidence: 'high',
    summary: 'The Sign in button is no longer found by its class.',
    explanation: 'Step 3 timed out waiting for button.btn-login; the screenshot shows a button labelled Sign in.',
    suggestion: 'Find the button by its role and name.',
    failedStep: 3,
    proposedSelector: "role=button[name='Sign in']",
    ...overrides,
  });

beforeAll(async () => {
  organizationId = await createTestOrganization('Analysis Org');
  userId = await createTestUser(organizationId, 'analysis-user');
  otherOrganizationId = await createTestOrganization('Other Analysis Org');
  otherUserId = await createTestUser(otherOrganizationId, 'other-analysis-user');

  const { default: routes } = await import('./failure-analysis.routes');
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
  currentUser = { id: userId, username: 'analysis-user', organizationId, role: 'editor' };
  ai.available = true;
  ai.explainFailure.mockReset();
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({ id: planId, name: 'Checkout', userId, organizationId } as any);
});

async function seedResult(status = 'Failed', detailedLog: unknown = failedLog) {
  const executionId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId, organizationId, testPlanId: planId, status: 'failed', triggeredBy: 'manual', totalTests: 1,
  } as any);
  const id = uuidv4();
  await privilegedDb.insert(reportTestCaseResults).values({
    id, organizationId, testPlanExecutionId: executionId, testType: 'ui', testName: 'Login', browser: 'chromium',
    status, reasonForFailure: status === 'Passed' ? null : 'Press Sign in: Timeout 5000ms exceeded',
    detailedLog: JSON.stringify(detailedLog), startedAt: new Date(),
    networkSummary: {
      requests: 12, failed: 1, transferredBytes: 1000,
      failures: [{ method: 'POST', url: 'https://shop.test/api/session', status: 500, statusText: 'Internal Server Error', timeMs: 80, resourceType: 'fetch' }],
      slowest: [],
    },
  } as any);
  return { executionId, id };
}

const analyse = (executionId: string, resultId: string, body: unknown = {}) =>
  request(app).post(`/api/test-plan-executions/${executionId}/results/${resultId}/ai-analysis`).send(body);

describe('the failure prompt', () => {
  const evidence = {
    testName: 'Login', testType: 'ui', browser: 'firefox', status: 'Failed',
    reason: 'Press Sign in: Timeout', detailedLog: JSON.stringify(failedLog),
    network: {
      requests: 3, failed: 1, transferredBytes: 0, slowest: [],
      failures: [{ method: 'POST', url: 'https://shop.test/api/session', status: 500, statusText: 'Internal Server Error', timeMs: 80, resourceType: 'fetch' }],
    },
  };

  it('carries the steps, their errors and the failed requests, in the language asked for', () => {
    const prompt = buildFailurePrompt(evidence, 'it', true);
    expect(prompt).toContain('3. [failed] click "Press Sign in" | selector: button.btn-login');
    expect(prompt).toContain("error: Timeout 5000ms exceeded");
    expect(prompt).toContain('FAILED POST https://shop.test/api/session → 500 Internal Server Error');
    expect(prompt).toContain('in Italian');
    expect(prompt).toContain('attached image');
    expect(prompt).toContain('(ui, firefox)');
  });

  it('never carries a value that looks like a secret', () => {
    const prompt = buildFailurePrompt(evidence, 'en', false);
    expect(prompt).not.toContain('Sup3rSecret!');
    expect(prompt).toContain('value: [hidden]');
    expect(prompt).toContain('value: https://shop.test/login');
    expect(prompt).toContain('No screenshot is available.');
    expect(promptValue({ name: 'Type code', type: 'input', selector: '#otp', value: '123456', status: 'passed', error: null, healed: false })).toBe('[hidden]');
  });

  it('keeps only the steps around the failure', () => {
    const long = [
      ...Array.from({ length: 30 }, (_, i) => ({ name: `Step ${i + 1}`, type: 'click', status: 'passed' })),
      { name: 'Broken', type: 'click', status: 'failed', error: 'boom' },
      { name: 'After', type: 'click', status: 'passed' },
      { name: 'Far after', type: 'click', status: 'passed' },
    ];
    const prompt = buildFailurePrompt({ ...evidence, detailedLog: JSON.stringify(long) }, 'en', false);
    expect(prompt).toContain('Steps (33 in all');
    expect(prompt).toContain('23. [passed] click "Step 23"');
    expect(prompt).not.toContain('"Step 22"');
    expect(prompt).toContain('32. [passed] click "After"');
    expect(prompt).not.toContain('Far after');
  });
});

describe('reading the answer', () => {
  it('takes the JSON out of prose or a code fence', () => {
    const parsed = parseFailureAnswer('Here you go:\n```json\n' + answer() + '\n```', 3);
    expect(parsed).toMatchObject({ category: 'locator', confidence: 'high', failedStep: 3, proposedSelector: "role=button[name='Sign in']" });
  });

  it('believes nothing outside the shape', () => {
    const parsed = parseFailureAnswer(answer({ category: 'cosmic-rays', confidence: 'absolute', failedStep: 9 }), 3);
    expect(parsed).toMatchObject({ category: 'unknown', confidence: 'low', failedStep: null, proposedSelector: null });
  });

  it('offers a selector only for a locator failure', () => {
    expect(parseFailureAnswer(answer({ category: 'application' }), 3)?.proposedSelector).toBeNull();
  });

  it('gives up on an answer that is not one', () => {
    expect(parseFailureAnswer(null, 3)).toBeNull();
    expect(parseFailureAnswer('I cannot help with that.', 3)).toBeNull();
    expect(parseFailureAnswer('{"category":"locator"}', 3)).toBeNull();
    expect(parseFailureAnswer('{not json}', 3)).toBeNull();
  });
});

describe('analysing a failed result', () => {
  it('asks the model, keeps the analysis on the result and audits it', async () => {
    ai.explainFailure.mockResolvedValueOnce(answer());
    const { executionId, id } = await seedResult();

    const res = await analyse(executionId, id, { language: 'it' });

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.analysis).toMatchObject({
      category: 'locator', failedStep: 3, language: 'it', model: 'gemini-test', byUsername: 'analysis-user', sawScreenshot: false,
    });
    const [prompt, screenshot] = ai.explainFailure.mock.calls[0];
    expect(prompt).toContain('Press Sign in');
    expect(prompt).not.toContain('Sup3rSecret!');
    expect(screenshot).toBeNull();

    const [row] = await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.id, id));
    expect(row.aiAnalysis).toMatchObject({ category: 'locator', summary: expect.any(String) });
    const audit = await privilegedDb.select().from(auditLog).where(eq(auditLog.targetId, executionId));
    expect(audit.find((entry) => entry.action === 'run.failure_analysed')?.metadata).toMatchObject({ test: 'Login', category: 'locator' });
  });

  it('hands back the kept analysis without asking again, unless told to refresh', async () => {
    ai.explainFailure.mockResolvedValueOnce(answer()).mockResolvedValueOnce(answer({ category: 'application', summary: 'The session API answered 500.' }));
    const { executionId, id } = await seedResult();

    await analyse(executionId, id);
    const again = await analyse(executionId, id);
    expect(again.body.cached).toBe(true);
    expect(ai.explainFailure).toHaveBeenCalledTimes(1);

    const fresh = await analyse(executionId, id, { refresh: true });
    expect(fresh.body).toMatchObject({ cached: false, analysis: { category: 'application' } });
    expect(ai.explainFailure).toHaveBeenCalledTimes(2);
  });

  it('refuses a result that did not fail', async () => {
    const { executionId, id } = await seedResult('Passed');
    expect((await analyse(executionId, id)).status).toBe(409);
    expect(ai.explainFailure).not.toHaveBeenCalled();
  });

  it('says so when no model is configured, and when the model gives nothing usable', async () => {
    const { executionId, id } = await seedResult();
    ai.available = false;
    expect((await analyse(executionId, id)).status).toBe(503);

    ai.available = true;
    ai.explainFailure.mockResolvedValueOnce('Sorry.');
    expect((await analyse(executionId, id)).status).toBe(502);
    const [row] = await privilegedDb.select().from(reportTestCaseResults).where(eq(reportTestCaseResults.id, id));
    expect(row.aiAnalysis).toBeNull();
  });

  it('rejects a language it does not write in', async () => {
    const { executionId, id } = await seedResult();
    expect((await analyse(executionId, id, { language: 'xx' })).status).toBe(400);
  });

  it("does not let another organization analyse, or read, a result", async () => {
    ai.explainFailure.mockResolvedValue(answer());
    const { executionId, id } = await seedResult();
    currentUser = { id: otherUserId, username: 'other-analysis-user', organizationId: otherOrganizationId, role: 'owner' };

    expect((await analyse(executionId, id)).status).toBe(404);
    expect(ai.explainFailure).not.toHaveBeenCalled();
  });

  it('is not open to viewers', async () => {
    const { executionId, id } = await seedResult();
    currentUser = { ...currentUser, role: 'viewer' };
    expect((await analyse(executionId, id)).status).toBe(403);
  });
});
