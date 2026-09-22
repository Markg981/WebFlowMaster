import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from './db';
import {
  tests as testsTable,
  testPlans,
  testPlanExecutions,
  testPlanSelectedTests,
  reportTestCaseResults,
  users,
} from '@shared/schema';
import { createTestOrganization } from './tests/factories';

/**
 * The three things the product collected and never acted on: which browsers a plan covers,
 * whether its steps are compared against a visual baseline, and who hears about the result.
 *
 * The browser is never really launched here — `launchBrowser` is the preflight check and
 * `executeTestSequence` is the run — because what is under test is the wiring between the
 * stored configuration and the runner, not Playwright.
 */

const executeTestSequence = vi.fn();
const launchBrowser = vi.fn(async () => ({ close: async () => {} }) as any);

vi.mock('./playwright-service', () => ({
  playwrightService: {
    executeTestSequence: (...args: any[]) => executeTestSequence(...args),
  },
}));

vi.mock('./browsers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./browsers')>();
  return { ...actual, launchBrowser: (...args: any[]) => launchBrowser(...(args as [any])) };
});

const { processTestPlanJob } = await import('./test-execution-service');

let organizationId: number;
let userId: number;
let planId: string;
let uiTestId: number;

async function seedPlan(planColumns: Record<string, unknown> = {}) {
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({
    id: planId,
    name: 'Matrix Plan',
    userId,
    organizationId,
    ...planColumns,
  } as any);

  const [uiTest] = await privilegedDb
    .insert(testsTable)
    .values({
      userId,
      organizationId,
      name: 'Login works',
      url: 'https://example.test/login',
      sequence: [],
      elements: [],
    })
    .returning();
  uiTestId = uiTest.id;

  await privilegedDb.insert(testPlanSelectedTests).values({
    testPlanId: planId,
    testType: 'ui',
    testId: uiTestId,
    organizationId,
  } as any);
}

async function runPlan(executionColumns: Record<string, unknown> = {}) {
  const executionId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId,
    organizationId,
    testPlanId: planId,
    status: 'pending',
    startedAt: new Date(),
    triggeredBy: 'scheduled',
    ...executionColumns,
  } as any);
  await processTestPlanJob(planId, executionId, userId);
  return executionId;
}

beforeEach(async () => {
  await privilegedDb.delete(reportTestCaseResults);
  await privilegedDb.delete(testPlanSelectedTests);
  await privilegedDb.delete(testPlanExecutions);
  await privilegedDb.delete(testPlans);
  await privilegedDb.delete(testsTable);
  await privilegedDb.delete(users);

  organizationId = await createTestOrganization('Matrix Org');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `matrix-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId })
    .returning();
  userId = user.id;

  executeTestSequence.mockReset();
  executeTestSequence.mockResolvedValue({ success: true, steps: [], duration: 5 });
  launchBrowser.mockClear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  // Every run creates its screenshot directory for real, so a suite that does not clean up
  // leaves one behind on every execution of itself.
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('the browsers a plan asks for', () => {
  it("runs each test once per browser the schedule named, and says which browser each result came from", async () => {
    await seedPlan();

    const executionId = await runPlan({ browsers: ['chromium', 'firefox'] });

    const rows = await privilegedDb.select().from(reportTestCaseResults);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.browser).sort()).toEqual(['chromium', 'firefox']);
    expect(executeTestSequence).toHaveBeenCalledTimes(2);
    const launched = executeTestSequence.mock.calls.map((call) => call[6]?.browser?.label);
    expect(launched.sort()).toEqual(['chromium', 'firefox']);
    expect(executionId).toBeTruthy();
  });

  it("falls back to the plan's own machine configuration when no schedule named any", async () => {
    await seedPlan({
      testMachinesConfig: [
        { os: 'windows', osVersion: '11', browserName: 'firefox', browserVersion: 'latest', headless: true },
      ],
    });

    await runPlan();

    const rows = await privilegedDb.select().from(reportTestCaseResults);
    expect(rows).toHaveLength(1);
    expect(rows[0].browser).toBe('firefox');
  });

  it('leaves the choice to the runner when nothing was configured, as it always did', async () => {
    await seedPlan();

    await runPlan();

    const rows = await privilegedDb.select().from(reportTestCaseResults);
    expect(rows).toHaveLength(1);
    expect(rows[0].browser).toBeNull();
    expect(executeTestSequence.mock.calls[0][6]?.browser).toBeUndefined();
  });

  it('runs headless when the machine asked for headed and this runner has no display', async () => {
    await seedPlan({
      testMachinesConfig: [{ os: 'linux', browserName: 'chromium', browserVersion: 'latest', headless: false }],
    });
    launchBrowser.mockRejectedValueOnce(new Error('Missing X server or $DISPLAY'));

    await runPlan();

    const rows = await privilegedDb.select().from(reportTestCaseResults);
    expect(rows).toHaveLength(1);
    expect(rows[0].browser).toBe('chromium');
    expect(rows[0].status).toBe('Passed');
    expect(executeTestSequence.mock.calls[0][6]?.browser?.headless).toBe(true);
  });

  it('does not report a browser it could not start as a test failure, and does not call the run clean', async () => {
    await seedPlan();
    launchBrowser.mockRejectedValueOnce(new Error('Could not start edge (channel "msedge") on this runner'));

    const executionId = await runPlan({ browsers: ['edge', 'chromium'] });

    const rows = await privilegedDb.select().from(reportTestCaseResults);
    expect(rows).toHaveLength(1);
    expect(rows[0].browser).toBe('chromium');
    expect(rows[0].status).toBe('Passed');

    const [execution] = await privilegedDb
      .select()
      .from(testPlanExecutions)
      .where(eqId(executionId));
    expect(execution.status).toBe('error');
  });
});

describe('how much of a plan runs at once', () => {
  it('runs one test at a time when the plan says so, which is what every plan said before', async () => {
    await seedPlan({ maxParallelTests: 1 });
    let inFlight = 0;
    let peak = 0;
    executeTestSequence.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return { success: true, steps: [], duration: 10 };
    });

    await runPlan({ browsers: ['chromium', 'firefox'] });

    expect(peak).toBe(1);
    expect(executeTestSequence).toHaveBeenCalledTimes(2);
  });

  it('runs browsers side by side when the plan allows it', async () => {
    await seedPlan({ maxParallelTests: 3 });
    let inFlight = 0;
    let peak = 0;
    executeTestSequence.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return { success: true, steps: [], duration: 10 };
    });

    await runPlan({ browsers: ['chromium', 'firefox', 'webkit'] });

    expect(peak).toBeGreaterThan(1);
    const rows = await privilegedDb.select().from(reportTestCaseResults);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.browser).sort()).toEqual(['chromium', 'firefox', 'webkit']);
  });

  it("does not exceed the machine's ceiling, whatever the plan asks for", async () => {
    process.env.RUN_MAX_PARALLEL = '2';
    await seedPlan({ maxParallelTests: 16 });
    let inFlight = 0;
    let peak = 0;
    executeTestSequence.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return { success: true, steps: [], duration: 10 };
    });

    await runPlan({ browsers: ['chromium', 'firefox', 'webkit', 'edge'] });

    expect(peak).toBeLessThanOrEqual(2);
    delete process.env.RUN_MAX_PARALLEL;
  });

  it('gives each browser its own captured values, so one pass never reads the other’s ids', async () => {
    await seedPlan({ maxParallelTests: 2 });
    const seenVariables: Array<Record<string, string>> = [];
    executeTestSequence.mockImplementation(async (_test: any, _userId: any, _dir: any, _id: any, vars: any) => {
      seenVariables.push({ ...vars });
      return { success: true, steps: [], duration: 1 };
    });

    await runPlan({ browsers: ['chromium', 'firefox'] });

    expect(seenVariables).toHaveLength(2);
    for (const vars of seenVariables) {
      expect(Object.keys(vars)).not.toContain('createdId');
    }
  });

  it('records a test that could not be executed at all, and does not call the run clean', async () => {
    await seedPlan({ maxParallelTests: 2 });
    executeTestSequence.mockRejectedValue(new Error('the runner exploded'));

    const executionId = await runPlan({ browsers: ['chromium'] });

    const [execution] = await privilegedDb.select().from(testPlanExecutions).where(eqId(executionId));
    expect(['failed', 'error']).toContain(execution.status);
  });
});

describe('visual testing', () => {
  it('asks for a comparison only when the plan turned it on', async () => {
    await seedPlan({ visualTestingEnabled: true });

    await runPlan({ browsers: ['chromium'] });

    const passedVisual = executeTestSequence.mock.calls[0][6]?.visual;
    expect(passedVisual?.organizationId).toBe(organizationId);
    expect(passedVisual?.testId).toBe(uiTestId);
    expect(passedVisual?.browser).toBe('chromium');
  });

  it('leaves the runner alone when it did not', async () => {
    await seedPlan({ visualTestingEnabled: false });

    await runPlan({ browsers: ['chromium'] });

    expect(executeTestSequence.mock.calls[0][6]?.visual).toBeUndefined();
  });
});

describe('the notification a finished run sends', () => {
  it('posts to the configured webhook when the outcome is one the plan asked about', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchSpy);
    await seedPlan({
      notificationSettings: { passed: true, failed: true, notExecuted: true, stopped: true, webhookUrl: 'https://hooks.test/abc' },
    });

    await runPlan({ browsers: ['chromium'] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://hooks.test/abc');
    const body = JSON.parse(init.body);
    expect(body.status).toBe('completed');
    expect(body.execution.browsers).toEqual(['chromium']);
    expect(body.text).toContain('Matrix Plan');
  });

  it('sends nothing when the plan named no destination, and the run still finishes', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await seedPlan({ notificationSettings: { passed: true, failed: true, notExecuted: true, stopped: true } });

    const executionId = await runPlan({ browsers: ['chromium'] });

    expect(fetchSpy).not.toHaveBeenCalled();
    const [execution] = await privilegedDb.select().from(testPlanExecutions).where(eqId(executionId));
    expect(execution.status).toBe('completed');
  });

  it('records the run even when the webhook is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND hooks.test')));
    await seedPlan({
      notificationSettings: { passed: true, failed: true, notExecuted: true, stopped: true, webhookUrl: 'https://hooks.test/abc' },
    });

    const executionId = await runPlan({ browsers: ['chromium'] });

    const [execution] = await privilegedDb.select().from(testPlanExecutions).where(eqId(executionId));
    expect(execution.status).toBe('completed');
    expect(execution.passedTests).toBe(1);
  });
});

/** Local helper so the expectations above read as sentences rather than as query builders. */
function eqId(executionId: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { eq } = require('drizzle-orm');
  return eq(testPlanExecutions.id, executionId);
}
