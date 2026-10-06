import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import {
  browserGrids,
  organizations,
  mobileTests,
  reportTestCaseResults,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  testDataSets,
  testQuarantines,
  tests as testsTable,
  users,
} from '@shared/schema';
import { isMobileResultLog, type MobileResultLog } from '@shared/mobile';
import { createTestOrganization } from './tests/factories';
import type { MobileOutcome } from './mobile-runner';

/**
 * Mobile app tests in a plan (migration 0053).
 *
 * A mobile test runs once per run, on a device of the grid it names — not once per browser and
 * language of the plan — and its result is a row of the report like any other: the device as
 * its "browser", the steps and the grid's session page in its log, the device's last screen as
 * its screenshot. The device itself is not reached here: `performMobileTest` is what
 * server/mobile-runner.test covers through the routes; what is under test is the plan's wiring.
 */

const executeTestSequence = vi.fn();
const launchBrowser = vi.fn(async () => ({ close: async () => {} }) as any);
const performMobileTest = vi.fn<(...args: any[]) => Promise<MobileOutcome>>();

vi.mock('./playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));
vi.mock('./precondition-runner', () => ({
  runPreconditions: async () => ({ ok: true, steps: [] }),
}));
vi.mock('./browsers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./browsers')>();
  return { ...actual, launchBrowser: (...args: any[]) => launchBrowser(...(args as [any])) };
});
vi.mock('./mobile-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mobile-runner')>();
  return { ...actual, performMobileTest: (...args: any[]) => performMobileTest(...args) };
});

const { processTestPlanJob } = await import('./test-execution-service');
const { buildExecutionSnapshot } = await import('./execution-snapshot');
const { assertSelectedTestsBelongTo } = await import('./routes/selected-tests');
const { stepsWithArtifactUrls } = await import('./routes/artifacts.routes');
const { evidenceSteps } = await import('./failure-analysis');

// A 1×1 PNG.
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const passed: MobileOutcome = {
  status: 'passed',
  steps: [{ index: 0, action: 'tap', target: '~Login', status: 'passed', durationMs: 40 }],
  error: null,
  screenshot: PIXEL,
  sessionUrl: 'https://app-automate.browserstack.com/s/abc',
};
const failed: MobileOutcome = {
  status: 'failed',
  steps: [
    {
      index: 0,
      action: 'tap',
      target: '~Login',
      status: 'failed',
      error: 'No visible element ~Login within 15s.',
      durationMs: 15000,
    },
  ],
  error: 'No visible element ~Login within 15s.',
  screenshot: null,
  sessionUrl: null,
};

let organizationId: number;
let userId: number;
let planId: string;
let uiTestId: number;
let mobileTestId: number;
let gridId: string;

async function seedPlan(
  planColumns: Record<string, unknown> = {},
  mobileColumns: Record<string, unknown> = {},
) {
  planId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'Release', userId, organizationId, ...planColumns } as any);

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
  await privilegedDb
    .insert(testPlanSelectedTests)
    .values({ testPlanId: planId, testType: 'ui', testId: uiTestId, organizationId } as any);

  gridId = uuidv4();
  await privilegedDb
    .insert(browserGrids)
    .values({
      id: gridId,
      organizationId,
      name: 'BrowserStack',
      provider: 'browserstack',
      username: 'qa',
    });
  const [mobile] = await privilegedDb
    .insert(mobileTests)
    .values({
      organizationId,
      name: 'Login on Android',
      platform: 'android',
      app: 'bs://app',
      deviceName: 'Google Pixel 8',
      osVersion: '14.0',
      gridId,
      steps: [{ action: 'tap', target: '~Login' }],
      ...mobileColumns,
    } as any)
    .returning();
  mobileTestId = mobile.id;
  await privilegedDb
    .insert(testPlanSelectedTests)
    .values({ testPlanId: planId, testType: 'mobile', mobileTestId, organizationId } as any);
}

async function runPlan(executionColumns: Record<string, unknown> = {}) {
  const executionId = uuidv4();
  await privilegedDb
    .insert(testPlanExecutions)
    .values({
      id: executionId,
      organizationId,
      testPlanId: planId,
      status: 'queued',
      triggeredBy: 'manual',
      ...executionColumns,
    } as any);
  await processTestPlanJob(planId, executionId, userId);
  const [execution] = await privilegedDb
    .select()
    .from(testPlanExecutions)
    .where(eq(testPlanExecutions.id, executionId));
  const rows = await privilegedDb
    .select()
    .from(reportTestCaseResults)
    .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
  return { execution, rows, mobileRows: rows.filter((row) => row.testType === 'mobile') };
}

beforeEach(async () => {
  organizationId = await createTestOrganization('Mobile Plans Org');
  const [user] = await privilegedDb
    .insert(users)
    .values({
      username: `mobile-plans-${uuidv4().slice(0, 8)}`,
      password: 'hashed',
      organizationId,
    })
    .returning();
  userId = user.id;
  executeTestSequence.mockReset();
  executeTestSequence.mockResolvedValue({ success: true, steps: [], duration: 5 });
  launchBrowser.mockReset();
  launchBrowser.mockResolvedValue({ close: async () => {} });
  performMobileTest.mockReset();
  performMobileTest.mockResolvedValue(passed);
});

afterEach(async () => {
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('a mobile test in a plan', () => {
  it('uses shared variables frozen at enqueue after the set is deleted', async () => {
    await seedPlan();
    const { createExecutionOrchestrator } = await import('./execution-orchestrator');
    const [set] = await privilegedDb.insert(testDataSets).values({ organizationId, name: 'mobile_input', columns: ['value'], rows: [{ value: 'queued' }] }).returning();
    const execution = await createExecutionOrchestrator({ add: async () => {} }).enqueue({ planId, requestedByUserId: userId, trigger: 'manual' });
    await privilegedDb.delete(testDataSets).where(eq(testDataSets.id, set.id));
    await processTestPlanJob(planId, execution.id, userId);
    expect(performMobileTest.mock.calls[0][2]).toMatchObject({ 'data.mobile_input.value': 'queued' });
  });
  it('runs native targets when all web browser probes fail', async () => {
    await seedPlan(
      {},
      {
        deviceMatrix: [
          { deviceName: 'Pixel 8', osVersion: '14' },
          { deviceName: 'Pixel 9', osVersion: '15' },
        ],
      },
    );
    launchBrowser.mockRejectedValueOnce(new Error('No browser binary'));
    launchBrowser.mockRejectedValueOnce(new Error('No browser binary'));
    const { mobileRows } = await runPlan({ browsers: ['chromium'] });
    expect(performMobileTest).toHaveBeenCalledTimes(2);
    expect(mobileRows).toHaveLength(2);
  });
  it('does not execute frozen unpublished content after a later publication', async () => {
    await seedPlan({}, { publishedVersion: 2 });
    const [plan] = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, planId));
    const [mobile] = await privilegedDb
      .select()
      .from(mobileTests)
      .where(eq(mobileTests.id, mobileTestId));
    const snapshot = buildExecutionSnapshot(plan, [
      { testType: 'mobile', testId: null, apiTestId: null, mobileTestId },
    ]);
    snapshot.mobileDefinitions = [
      {
        id: mobileTestId,
        version: 1,
        definition: { ...mobile, publishedVersion: null, executionSteps: mobile.steps },
      },
    ];
    await privilegedDb
      .update(organizations)
      .set({ testReviewRequired: true })
      .where(eq(organizations.id, organizationId));
    // Mimic a live publication via the same lookup the worker consumes.
    const { recordTypedTestVersion } = await import('./test-version-store');
    await recordTypedTestVersion(privilegedDb as any, {
      testType: 'mobile',
      testId: mobileTestId,
      organizationId,
      userId,
      test: mobile,
    });
    await privilegedDb
      .update(mobileTests)
      .set({ publishedVersion: 1 })
      .where(eq(mobileTests.id, mobileTestId));
    const { mobileRows } = await runPlan({ configurationSnapshot: snapshot });
    expect(performMobileTest).not.toHaveBeenCalled();
    expect(mobileRows[0].status).toBe('Skipped');
    expect(mobileRows[0].reasonForFailure).toContain('Not published');
  });
  it('runs matrix devices once each outside browser and locale lanes', async () => {
    await seedPlan(
      { locales: ['it-IT', 'en-US'] },
      {
        deviceMatrix: [
          { deviceName: 'Pixel 8', osVersion: '14' },
          { deviceName: 'Pixel 9', osVersion: '15' },
        ],
      },
    );
    const { execution, rows, mobileRows } = await runPlan({ browsers: ['chromium', 'firefox'] });
    expect(performMobileTest).toHaveBeenCalledTimes(2);
    expect(mobileRows.map((row) => row.browser).sort()).toEqual(['Pixel 8 · 14', 'Pixel 9 · 15']);
    expect(new Set(mobileRows.map((row) => row.screenshotUrl)).size).toBe(2);
    expect(rows.filter((row) => row.uiTestId === uiTestId)).toHaveLength(4);
    expect(execution).toMatchObject({ status: 'completed', totalTests: 6, passedTests: 6 });
  });
  it('runs once on its device, whatever the browsers and languages, and is a row of the report', async () => {
    await seedPlan({ locales: ['it-IT', 'en-US'] });

    const { execution, rows, mobileRows } = await runPlan({ browsers: ['chromium', 'firefox'] });

    expect(performMobileTest).toHaveBeenCalledTimes(1);
    const [test, grid] = performMobileTest.mock.calls[0];
    expect(test).toMatchObject({ id: mobileTestId, deviceName: 'Google Pixel 8' });
    expect(grid).toMatchObject({ id: gridId, provider: 'browserstack' });
    // The web test still ran on every browser and language.
    expect(rows.filter((row) => row.uiTestId === uiTestId)).toHaveLength(4);

    expect(mobileRows).toHaveLength(1);
    const row = mobileRows[0];
    expect(row).toMatchObject({
      mobileTestId,
      uiTestId: null,
      apiTestId: null,
      testName: 'Login on Android',
      browser: 'Google Pixel 8 · 14.0',
      status: 'Passed',
    });
    const log = JSON.parse(row.detailedLog!) as MobileResultLog;
    expect(isMobileResultLog(log)).toBe(true);
    expect(log).toMatchObject({
      device: 'Google Pixel 8 · 14.0',
      platform: 'android',
      sessionUrl: passed.sessionUrl,
    });
    expect(log.steps).toEqual(passed.steps);
    // The report, the failure analysis and the exports read it as the step list they know.
    expect(stepsWithArtifactUrls(row.testPlanExecutionId, row.detailedLog)).toMatchObject([
      { name: '1. tap ~Login', type: 'tap', selector: '~Login', status: 'passed' },
    ]);
    expect(evidenceSteps(row.detailedLog)).toMatchObject([
      { name: '1. tap ~Login', status: 'passed' },
    ]);
    // The device's last screen is the result's screenshot, served like a web test's.
    expect(row.screenshotUrl).toMatch(
      new RegExp(`^/results/${planId}/[^/]+/mobile_${mobileTestId}/final\\.png$`),
    );
    expect(await fs.pathExists(path.resolve(process.cwd(), row.screenshotUrl!.slice(1)))).toBe(
      true,
    );
    expect(execution).toMatchObject({ status: 'completed', totalTests: 5, passedTests: 5 });
  });

  it('receives the environment’s variables, like the plan’s other tests', async () => {
    await seedPlan();

    await runPlan();

    const vars = performMobileTest.mock.calls[0][2] as Record<string, string>;
    expect(typeof vars).toBe('object');
  });

  it('fails the run when it fails, with the step’s reason', async () => {
    await seedPlan();
    performMobileTest.mockResolvedValue(failed);

    const { execution, mobileRows } = await runPlan();

    expect(mobileRows[0]).toMatchObject({
      status: 'Failed',
      reasonForFailure: failed.error,
      screenshotUrl: null,
    });
    expect(execution.status).toBe('failed');
  });

  it('in quarantine, still runs and records its failure, and does not fail the run', async () => {
    await seedPlan();
    await privilegedDb
      .insert(testQuarantines)
      .values({
        organizationId,
        testType: 'mobile',
        mobileTestId,
        reason: 'Device farm drops the session',
      });
    performMobileTest.mockResolvedValue(failed);

    const { execution, mobileRows } = await runPlan();

    expect(performMobileTest).toHaveBeenCalledTimes(1);
    expect(mobileRows[0]).toMatchObject({ status: 'Failed', quarantined: true });
    expect(execution.status).toBe('completed');
  });

  it('is run again under the plan’s re-run policy, and records the attempts', async () => {
    await seedPlan({ reRunOnFailure: 'once' });
    performMobileTest.mockResolvedValueOnce(failed).mockResolvedValueOnce(passed);

    const { mobileRows } = await runPlan();

    expect(performMobileTest).toHaveBeenCalledTimes(2);
    expect(mobileRows[0]).toMatchObject({ status: 'Passed', attempts: 2 });
  });

  it('is an error, not a device session, when it names no grid', async () => {
    await seedPlan({}, { gridId: null });

    const { mobileRows, execution } = await runPlan();

    expect(performMobileTest).not.toHaveBeenCalled();
    expect(mobileRows[0].status).toBe('Error');
    expect(mobileRows[0].reasonForFailure).toMatch(/names no grid/);
    expect(execution.status).toBe('failed');
  });

  it('is recorded in the run’s snapshot with its id, and a web test’s reference stays as it was', async () => {
    await seedPlan();
    const [plan] = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, planId));

    const snapshot = buildExecutionSnapshot(plan, [
      { testType: 'ui', testId: uiTestId, apiTestId: null, mobileTestId: null },
      { testType: 'mobile', testId: null, apiTestId: null, mobileTestId },
    ]);

    expect(snapshot.selectedTests).toEqual([
      { testType: 'ui', testId: uiTestId, apiTestId: null },
      { testType: 'mobile', testId: null, apiTestId: null, mobileTestId },
    ]);
  });

  it('is accepted in a plan only from the same organization', async () => {
    await seedPlan();
    await expect(
      assertSelectedTestsBelongTo(privilegedDb, organizationId, [
        { id: mobileTestId, type: 'mobile' },
      ]),
    ).resolves.toBeUndefined();
    const otherOrganizationId = await createTestOrganization('Other Mobile Plans Org');
    await expect(
      assertSelectedTestsBelongTo(privilegedDb, otherOrganizationId, [
        { id: mobileTestId, type: 'mobile' },
      ]),
    ).rejects.toThrow(/do not exist/);
    // Nor an id that names no mobile test at all.
    await expect(
      assertSelectedTestsBelongTo(privilegedDb, organizationId, [
        { id: mobileTestId + 100000, type: 'mobile' },
      ]),
    ).rejects.toThrow(/do not exist/);
  });
});
