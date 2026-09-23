import { playwrightService } from './playwright-service';
import type { Test, ApiTest, TestPlanExecution, InsertReportTestCaseResult, Precondition } from '@shared/schema'; // Assuming ApiTest will be defined or Test is generic enough
import { runPreconditions } from './precondition-runner';
import type { StepResult } from './playwright-service'; // Import StepResult type
import loggerPromise from './logger';
import { privilegedDb } from './db';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';
import {
  tests as testsTable,
  apiTests as apiTestsTable,
  testPlanSelectedTests,
  testPlans,
  testPlanExecutions as testPlanExecutionsTable,
  reportTestCaseResults as reportTestCaseResultsTable // Added
} from '@shared/schema';
import { and, eq, inArray } from 'drizzle-orm'; // Added sql
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
import path from 'path';
import { getWsEmitter, type ExecutionLogEntry } from './websocket';
import { testExecutionQueue } from './queue';
import { secrets as secretsTable } from '@shared/schema';
import { decryptSecret } from './crypto';
import { getCorrelationId } from './middleware/correlation';
import { defaultVariables } from './variables';
import { runApiRequest, type Extraction } from './api-test-runner';
import type { Assertion, AuthParams } from '@shared/schema';
import { browsersForRun, describeBrowser, hasConfiguredBrowsers, launchBrowser, type BrowserChoice } from './browsers';
import { effectiveConcurrency, runWithConcurrency } from './concurrency';
import type { VisualContext } from './visual-testing';
import { shouldRecord } from './run-evidence';
import type { EvidenceCaptureMode } from '@shared/schema';
import {
  describeUnsupported,
  mergeNotificationSettings,
  sendRunNotification,
  type RunSummary,
} from './notifications';
import { fileFailure, loadTracker, markResolved } from './issue-store';
import { currentVersionsOf } from './test-version-store';
import { transitionExecution } from './execution-state';
import { testPlanSchedules } from '@shared/schema';

/** Reads a jsonb column that came back as text, as these columns sometimes do. */
function safeJsonArray(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Keeps a browser label from turning into a path when it names a directory. */
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 40) || 'browser';
}

// Helper to interpolate {{SECRET_KEY}} in strings
function interpolateSecrets(str: string, secretsMap: Record<string, string>): string {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (match, keyName) => {
    return secretsMap[keyName] !== undefined ? secretsMap[keyName] : match;
  });
}

// Deep clone and inject secrets into a test object
function injectSecretsIntoTest(testObj: any, secretsMap: Record<string, string>): any {
  if (testObj === null || typeof testObj !== 'object') {
    return typeof testObj === 'string' ? interpolateSecrets(testObj, secretsMap) : testObj;
  }

  if (Array.isArray(testObj)) {
    return testObj.map(item => injectSecretsIntoTest(item, secretsMap));
  }

  const result: any = {};
  for (const [key, value] of Object.entries(testObj)) {
    result[key] = injectSecretsIntoTest(value, secretsMap);
  }
  return result;
}

// Define a common result structure for individual test runs
export interface IndividualTestRunResult {
  testId: number;
  testType: 'ui' | 'api';
  name: string;
  success: boolean;
  status: 'passed' | 'failed' | 'error'; // Add 'error' for execution errors before steps
  steps?: StepResult[]; // from playwright-service
  error?: string; // For errors during test execution itself (e.g., Playwright internal error)
  durationMs: number;
  /** Values an API test captured, for the requests that come after it in the plan. */
  extracted?: Record<string, string>;
  extractionErrors?: Array<{ name: string; reason: string }>;
  screenshotPath?: string; // General screenshot for API tests if applicable, or last step for UI
  /** Kept only when the plan asked for them — see server/run-evidence.ts. */
  videoPath?: string;
  tracePath?: string;
}


/** What the plan adds to a single test run: which browser, and whether to compare it visually. */
export interface RunTestOptions {
  browser?: BrowserChoice;
  visual?: Omit<VisualContext, 'testId' | 'browser'>;
  /** Whether to keep a video and a trace of the run. The directory is this test's own. */
  evidence?: { video?: EvidenceCaptureMode; trace?: EvidenceCaptureMode };
}

export async function runTest(
  test: Test | ApiTest, // Test is from shared/schema, ApiTest would also be from there
  userId: number,
  planId: string,
  runId: string, // This is the testPlanRun.id
  testType: 'ui' | 'api',
  // Resolved `{{name}}` values for this run's environment. One resolution feeds both the
  // preconditions and the step executor, so a placeholder cannot mean two different things
  // depending on which of them reads it.
  vars: Record<string, string> = defaultVariables(),
  // The environment whose saved browser session to start from, when it has one.
  environment?: { environmentId: number; organizationId: number },
  // Which browser, and whether to compare each step against its baseline. Both come from the
  // plan, and both were collected by the product long before anything acted on them.
  options?: RunTestOptions,
): Promise<IndividualTestRunResult> {
  const resolvedLogger = await loggerPromise;
  const startTime = Date.now();
  const testId = test.id;
  const testName = test.name;

  resolvedLogger.info({ message: `Starting ${testType} test execution`, testId, testName, planId, runId, userId });

  if (testType === 'ui') {
    const uiTest = test as Test;
    // One directory per browser, because a plan covering two browsers runs this test twice
    // and the second run would otherwise overwrite the first one's evidence.
    const screenshotBaseDir = path.join(
      './results',
      planId,
      runId,
      options?.browser ? `ui_${testId}_${sanitizeSegment(options.browser.label)}` : `ui_${testId}`,
    );
    try {
      await fs.ensureDir(screenshotBaseDir);

      // Establish preconditions (ordered API setup calls) before the UI sequence, so the
      // system under test is in the required state. Fail-fast: if setup fails, the test
      // is blocked (reported as 'error'), not a misleading pass/fail.
      const preResult = await runPreconditions(
        (uiTest as unknown as { preconditions?: Precondition[] | null }).preconditions,
        vars,
      );
      if (!preResult.ok) {
        const durationMs = Date.now() - startTime;
        resolvedLogger.warn({
          message: 'UI Test blocked: precondition failed',
          testId, testName, planId, runId, failedAt: preResult.failedAt, reason: preResult.reason,
        });
        return {
          testId,
          testType: 'ui',
          name: uiTest.name,
          success: false,
          status: 'error',
          error: `Precondition failed at "${preResult.failedAt}": ${preResult.reason}`,
          durationMs,
        };
      }

      const result = await playwrightService.executeTestSequence(
        uiTest,
        userId,
        screenshotBaseDir,
        runId,
        vars,
        environment,
        {
          browser: options?.browser,
          visual: options?.visual
            ? {
                ...options.visual,
                testId,
                browser: options.browser?.label ?? 'default',
                artifactDir: screenshotBaseDir,
              }
            : undefined,
          evidence: options?.evidence
            ? { ...options.evidence, artifactDir: screenshotBaseDir }
            : undefined,
        },
      );
      const durationMs = Date.now() - startTime;

      // Determine overall test status
      let finalStatus: 'passed' | 'failed' = 'passed';
      if (!result.success) {
        finalStatus = 'failed';
      } else if (result.steps?.some(step => step.status === 'failed')) {
        finalStatus = 'failed';
      }

      // Find the last screenshot taken, if any (especially on failure)
      let lastScreenshotPath: string | undefined;
      if (result.steps && result.steps.length > 0) {
        for (let i = result.steps.length - 1; i >= 0; i--) {
          if (result.steps[i].screenshot && typeof result.steps[i].screenshot === 'string' && !result.steps[i].screenshot!.startsWith('data:image')) {
            lastScreenshotPath = result.steps[i].screenshot;
            break;
          }
        }
      }

      // A test that failed on a visual comparison shows the diff, not the page. The page is
      // what the report already has; the diff is the only picture that answers "what changed?".
      const visualFailure = result.steps?.find(
        (step) => step.status === 'failed' && step.visual?.outcome === 'diff' && step.visual.diffImage,
      );
      if (visualFailure?.visual?.diffImage) {
        lastScreenshotPath = visualFailure.visual.diffImage;
      }


      resolvedLogger.info({ message: `UI Test completed`, testId, testName, planId, runId, success: result.success, durationMs });
      return {
        testId,
        testType: 'ui',
        name: uiTest.name,
        success: result.success,
        status: finalStatus,
        steps: result.steps,
        error: result.error,
        durationMs,
        screenshotPath: lastScreenshotPath, // Or a specific error screenshot for the whole test
        videoPath: result.evidence?.videoPath,
        tracePath: result.evidence?.tracePath,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      resolvedLogger.error({ message: `Critical error during UI test execution`, testId, testName, planId, runId, error: error.message, stack: error.stack });
      return {
        testId,
        testType: 'ui',
        name: uiTest.name,
        success: false,
        status: 'error',
        error: `Execution failed: ${error.message}`,
        durationMs,
      };
    }
  } else if (testType === 'api') {
    const apiTest = test as ApiTest; // Cast to ApiTest
    resolvedLogger.info({ message: `API Test execution starting`, testId: apiTest.id, testName: apiTest.name, planId, runId });

    // This used to be `Math.random() > 0.2` under a TODO: no request was made, and every
    // API test in a plan reported a fabricated result that looked exactly like a real one.
    const result = await runApiRequest(
      {
        method: apiTest.method,
        url: apiTest.url,
        queryParams: apiTest.queryParams as Record<string, string> | null,
        headers: apiTest.requestHeaders as Record<string, string> | null,
        body: apiTest.requestBody ?? undefined,
        assertions: (apiTest.assertions as Assertion[] | null) ?? [],
        extractions: (apiTest.extractions as Extraction[] | null) ?? [],
        // The test's own auth settings, which only the API Tester page used to apply — so a
        // scheduled run sent the request anonymous and failed for the wrong reason.
        auth: apiTest.authParams as AuthParams | null,
      },
      vars,
    );

    const durationMs = Date.now() - startTime;
    const failedAssertions = result.assertions.filter((a) => !a.pass);
    const success = result.passed && !result.error;

    resolvedLogger.info({
      message: `API Test completed`,
      testId: apiTest.id, testName: apiTest.name, planId, runId,
      success, durationMs, status: result.status,
      assertionsRun: result.assertions.length,
      extracted: Object.keys(result.extracted),
    });

    return {
      testId: apiTest.id,
      testType: 'api',
      name: apiTest.name,
      success,
      // A request that could not be made at all is an error, not a failed assertion: the
      // test did not get far enough to say anything about the system under test.
      status: result.error ? 'error' : success ? 'passed' : 'failed',
      error:
        result.error ??
        (failedAssertions.length > 0
          ? failedAssertions
              .map(
                (a) =>
                  `${a.assertion.source}${a.assertion.property ? ` "${a.assertion.property}"` : ''} ` +
                  `${a.assertion.comparison} "${a.assertion.targetValue ?? ''}" — actual: ${JSON.stringify(a.actualValue)}` +
                  (a.error ? ` (${a.error})` : ''),
              )
              .join('; ')
          : undefined),
      durationMs,
      extracted: result.extracted,
      extractionErrors: result.extractionErrors,
    };
  } else {
    const durationMs = Date.now() - startTime;
    resolvedLogger.error({ message: "Unknown test type provided to runTest", testType, testId, planId, runId });
    return {
      testId,
      testType: testType, // Echo back the unknown type
      name: testName,
      success: false,
      status: 'error',
      error: `Unknown test type: ${testType}`,
      durationMs,
    };
  }
}
// runTestPlan will be added here later
// Placeholder for executeApiTestInternal - this would need full implementation
// async function executeApiTestInternal(apiTest: ApiTest, userId: number) {
//   // Fetch API, execute, run assertions, etc.
//   // Similar to the logic in POST /api/proxy-api-request in routes.ts
//   return { success: true, details: { statusCode: 200, responseBody: { message: "ok"} } };
// }

/**
 * What a caller can say about a run beyond which plan it is.
 *
 * `executionId` exists for the scheduler, which creates the execution row itself — with the
 * schedule's environment, its browsers and its `scheduled` provenance — and then needs the
 * job to run *that* row. Before this it did not: `runTestPlan` inserted a second row, and the
 * run that actually happened was the second one, marked manual, with no environment and no
 * browsers. The schedule's configuration was recorded on a row nothing ever executed.
 */
export interface RunTestPlanOptions {
  environmentId?: number | null;
  /** Accept this run's screenshots as the new visual baselines. */
  updateBaselines?: boolean;
  /** An execution row the caller has already created, to be run instead of a new one. */
  executionId?: string;
}

export async function runTestPlan(
  planId: string,
  userId: number,
  environmentIdOrOptions?: number | RunTestPlanOptions,
): Promise<TestPlanExecution | { error: string; status?: number; testPlanRunId?: string }> {
  const options: RunTestPlanOptions =
    typeof environmentIdOrOptions === 'number'
      ? { environmentId: environmentIdOrOptions }
      : (environmentIdOrOptions ?? {});
  const environmentId = options.environmentId ?? undefined;
  const resolvedLogger = await loggerPromise;
  // The caller's row when it made one, so the schedule's environment and browsers are on the
  // row that actually runs rather than on a duplicate nothing executes.
  const testPlanRunId = options.executionId ?? uuidv4();

  resolvedLogger.info({ message: `Enqueueing test plan execution`, planId, testPlanRunId, userId });

  // The other tenant-context boundary, alongside processTestPlanJob's. This is called both
  // from a route (which has an ambient organization and has already checked the caller owns
  // this plan) and from the scheduler (which has neither), so the lookup that establishes the
  // organization runs privileged in both cases and the insert below is stamped from it.
  const planResult = await privilegedDb.select().from(testPlans).where(eq(testPlans.id, planId)).limit(1);
  if (!planResult || planResult.length === 0) {
    resolvedLogger.error({ message: `Test Plan not found`, planId, testPlanRunId });
    return { error: 'Test Plan not found', status: 404 };
  }

  let currentTestPlanRun: TestPlanExecution;
  try {
    if (options.executionId) {
      // Read under the plan's organization rather than privileged: the boundary that
      // establishes which organization this is has already been crossed, three lines up.
      const existing = await runWithTenant(planResult[0].organizationId, () =>
        withTenantTransaction((tx) =>
          tx
            .select()
            .from(testPlanExecutionsTable)
            .where(eq(testPlanExecutionsTable.id, options.executionId as string))
            .limit(1),
        ),
      );
      if (existing.length === 0) {
        return { error: `Test plan execution ${options.executionId} not found`, status: 404 };
      }
      currentTestPlanRun = existing[0];
    } else {
      const inserted = await privilegedDb.insert(testPlanExecutionsTable)
        .values({
          id: testPlanRunId,
          // Same organization as the plan being run.
          organizationId: planResult[0].organizationId,
          testPlanId: planId,
          // Waiting for a worker. started_at stays empty until one takes it, so the time a run
          // spent in the queue is not reported as time it spent running.
          status: 'queued',
          // Stamped here rather than left to the column default, so it shares a clock with
          // started_at and completed_at, which are also written by this process. The default is
          // the database's now(), and in a timestamp column without a zone that is the
          // database's local time — an hour or two away from every other stamp on the row.
          queuedAt: new Date(),
          requestedByUserId: userId,
          environment: environmentId ? environmentId.toString() : null, // Save environment ID here
          triggeredBy: 'manual',
        })
        .returning();
      currentTestPlanRun = inserted[0];
    }

    // Add job to Queue
    await testExecutionQueue.add('execute-plan', {
      planId,
      testPlanRunId,
      userId,
      updateBaselines: options.updateBaselines === true,
      correlationId: getCorrelationId() || `job-${testPlanRunId.slice(0, 8)}`
    });

    resolvedLogger.info({ message: 'TestPlanRun job enqueued successfully', testPlanRunId, dbId: currentTestPlanRun.id });
    return currentTestPlanRun;
  } catch (dbError: any) {
    resolvedLogger.error({ message: 'Failed to enqueue test plan run', planId, testPlanRunId, error: dbError.message, stack: dbError.stack });
    return { error: `Failed to initialize test plan run: ${dbError.message}`, status: 500 };
  }
}

/**
 * Establishes the tenant context for a queue job, then runs it.
 *
 * A BullMQ worker has no Express request, so `tenancyMiddleware` never ran and there is no
 * ambient organization to inherit. Exactly one lookup therefore has to run privileged — the
 * one that answers "which organization is this job for?" — and everything after it runs under
 * that organization's RLS binding. This function is that boundary, and it is the only place in
 * the execution path that reaches an org-scoped table outside the tenant context.
 *
 * Deliberately NOT one long transaction around the whole job: a plan execution drives a real
 * browser for minutes, and holding a pooled connection open for its duration would starve the
 * pool. `runWithTenant` establishes the ambient organization; each query inside opens its own
 * short `withTenantTransaction`.
 */
export async function processTestPlanJob(
  planId: string,
  testPlanRunId: string,
  userId: number,
  jobOptions: { updateBaselines?: boolean } = {},
): Promise<any> {
  const bootstrapLogger = await loggerPromise;
  const [execution] = await privilegedDb
    .select({ organizationId: testPlanExecutionsTable.organizationId })
    .from(testPlanExecutionsTable)
    .where(eq(testPlanExecutionsTable.id, testPlanRunId))
    .limit(1);

  if (!execution) {
    bootstrapLogger.error({ message: 'Test plan execution record not found', testPlanRunId });
    return { error: `Test plan execution ${testPlanRunId} not found.`, status: 500, testPlanRunId };
  }

  return runWithTenant(execution.organizationId, () =>
    runTestPlanJobInTenant(planId, testPlanRunId, userId, jobOptions),
  );
}

async function runTestPlanJobInTenant(
  planId: string,
  testPlanRunId: string,
  userId: number,
  jobOptions: { updateBaselines?: boolean } = {},
): Promise<any> {
  const resolvedLogger = await loggerPromise;
  const wsEmitter = getWsEmitter();
  const overallStartTime = Date.now();

  const startLog: ExecutionLogEntry = {
    level: 'info',
    source: 'system',
    message: `Starting background test plan execution for plan ${planId}`,
    timestamp: new Date(overallStartTime).toISOString(),
    metadata: { planId, testPlanRunId, userId }
  };
  resolvedLogger.info(startLog);
  wsEmitter.emitExecutionLog(testPlanRunId, startLog);

  // Take the run. Only a run that is still queued can be taken, and the database lets exactly
  // one worker do it: a job BullMQ delivers twice, or a run somebody cancelled while it waited,
  // gets nothing back here and stops — instead of running the whole plan a second time over the
  // results of the first.
  const taken = await transitionExecution(testPlanRunId, 'running');
  if (!taken) {
    const [current] = await withTenantTransaction((tx) =>
      tx
        .select({ status: testPlanExecutionsTable.status })
        .from(testPlanExecutionsTable)
        .where(eq(testPlanExecutionsTable.id, testPlanRunId))
        .limit(1),
    );
    resolvedLogger.warn({
      message: 'Test plan execution was not taken: it is no longer queued',
      testPlanRunId,
      status: current?.status ?? 'missing',
    });
    return { skipped: true, reason: `Execution is ${current?.status ?? 'missing'}, not queued.`, testPlanRunId };
  }

  const currentTestPlanRun: any = { startedAt: Math.floor(overallStartTime / 1000) };

  const baseResultsDir = path.join('./results', planId, testPlanRunId);
  try {
    await fs.ensureDir(baseResultsDir);
  } catch (dirError: any) {
    resolvedLogger.error({ message: 'Failed to create base results directory', baseResultsDir, error: dirError.message });
    await transitionExecution(testPlanRunId, 'error', {
      failureCode: 'results_directory_unavailable',
      failureMessage: `Failed to create results directory: ${dirError.message}`,
      results: JSON.stringify([{ error: `Failed to create results directory: ${dirError.message}` }]),
      executionDurationMs: Date.now() - overallStartTime,
    });
    return { error: `Failed to create results directory: ${dirError.message}`, status: 500, testPlanRunId };
  }

  // Phase 8: Fetch Environment and Secrets
  const executionRecord = await withTenantTransaction((tx) =>
    tx.select().from(testPlanExecutionsTable).where(eq(testPlanExecutionsTable.id, testPlanRunId)).limit(1),
  );
  if (executionRecord.length === 0) {
    resolvedLogger.error({ message: 'Test plan execution record not found after creation', testPlanRunId });
    return { error: `Test plan execution ${testPlanRunId} not found.`, status: 500, testPlanRunId };
  }
  const environmentId = executionRecord[0].environment ? parseInt(executionRecord[0].environment) : null;

  // The plan itself, for the three things it has always recorded and nothing ever read: the
  // browsers to cover, whether to compare each step against its visual baseline, and who to
  // tell when the run is over.
  const planRecord = await withTenantTransaction((tx) =>
    tx.select().from(testPlans).where(eq(testPlans.id, planId)).limit(1),
  );
  const plan = planRecord[0];

  const configuredBrowsers =
    hasConfiguredBrowsers(executionRecord[0].browsers) || hasConfiguredBrowsers(plan?.testMachinesConfig);
  const { browsers: browserMatrix, warnings: browserWarnings } = browsersForRun({
    executionBrowsers: executionRecord[0].browsers,
    testMachines: plan?.testMachinesConfig,
  });
  // `undefined` means "whatever the runner would have used", which is the user's own setting
  // — exactly what every plan did before its browser configuration was honoured.
  const runPasses: Array<BrowserChoice | undefined> = configuredBrowsers ? browserMatrix : [undefined];
  for (const warning of browserWarnings) {
    const entry: ExecutionLogEntry = {
      level: 'warn',
      source: 'system',
      message: warning,
      timestamp: new Date().toISOString(),
    };
    resolvedLogger.warn(entry);
    wsEmitter.emitExecutionLog(testPlanRunId, entry);
  }
  if (configuredBrowsers) {
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message: `Running this plan on ${runPasses.length} browser(s): ${browserMatrix.map(describeBrowser).join(', ')}.`,
      timestamp: new Date().toISOString(),
      metadata: { browsers: browserMatrix.map((b) => b.label) },
    });
  }

  /**
   * Whether this run keeps a video and a trace of itself.
   *
   * Undefined when the plan wants neither, so a run that records nothing does not even build
   * the option — which is every plan until somebody turns it on.
   */
  const runEvidence: { video?: EvidenceCaptureMode; trace?: EvidenceCaptureMode } | undefined =
    shouldRecord(plan?.captureVideo as EvidenceCaptureMode) || shouldRecord(plan?.captureTrace as EvidenceCaptureMode)
      ? {
          video: (plan?.captureVideo as EvidenceCaptureMode) ?? 'never',
          trace: (plan?.captureTrace as EvidenceCaptureMode) ?? 'never',
        }
      : undefined;
  if (runEvidence) {
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message:
        `Recording this run: video ${runEvidence.video}, trace ${runEvidence.trace}. ` +
        `Kept files appear on each result in the report.`,
      timestamp: new Date().toISOString(),
      metadata: { ...runEvidence },
    });
  }

  const visualTesting = plan?.visualTestingEnabled === true;
  if (visualTesting) {
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message: jobOptions.updateBaselines
        ? 'Visual testing: this run replaces the stored baselines with its own screenshots.'
        : 'Visual testing: each step is compared against its stored baseline; a first run records one.',
      timestamp: new Date().toISOString(),
    });
  }

  const secretsMap: Record<string, string> = {};
  // The defaults underneath, the environment's secrets on top — so an environment can
  // override `baseUrl` like any other name, and a run against site B does not depend on
  // what a process env var happened to hold.
  const runVariables = (captured: Record<string, string>): Record<string, string> => ({
    ...defaultVariables(),
    ...secretsMap,
    // Values captured by tests that already ran in this pass. Last write wins, so a later
    // request can refresh a token an earlier one obtained.
    ...captured,
  });
  // The same environment supplies the variables and the saved login, so a scheduled run
  // cannot resolve one site's secrets while reusing another site's session.
  const planEnvironment = () =>
    environmentId && !isNaN(environmentId)
      ? { environmentId, organizationId: executionRecord[0].organizationId }
      : undefined;

  if (environmentId && !isNaN(environmentId)) {
    // These values are decrypted and injected into the running test, and environmentId comes
    // off the execution row, which a caller can influence — so an id belonging to another
    // tenant would exfiltrate their secrets. RLS now bounds this to the job's organization;
    // the explicit organizationId predicate stays as the second lock.
    const environmentSecrets = await withTenantTransaction((tx) =>
      tx
        .select()
        .from(secretsTable)
        .where(
          and(
            eq(secretsTable.environmentId, environmentId),
            eq(secretsTable.organizationId, executionRecord[0].organizationId),
          ),
        ),
    );
    for (const secret of environmentSecrets) {
      try {
        secretsMap[secret.keyName] = decryptSecret(secret.encryptedValue, secret.iv, secret.authTag);
      } catch (e) {
        resolvedLogger.warn(`Failed to decrypt secret ${secret.keyName} for environment ${environmentId}`);
      }
    }
    const envLog: ExecutionLogEntry = {
      level: 'info',
      source: 'system',
      message: `Loaded and decrypted ${Object.keys(secretsMap).length} secrets for environment ${environmentId}`,
      timestamp: new Date().toISOString(),
      metadata: { environmentId, secretCount: Object.keys(secretsMap).length }
    };
    resolvedLogger.info(envLog);
    wsEmitter.emitExecutionLog(testPlanRunId, envLog);
  }

  const selectedTestsLinks = await withTenantTransaction((tx) =>
    tx
      .select()
      .from(testPlanSelectedTests)
      .where(eq(testPlanSelectedTests.testPlanId, planId)),
  );

  wsEmitter.emitExecutionLog(testPlanRunId, {
    level: 'info',
    source: 'system',
    message: `Found ${selectedTestsLinks.length} tests to execute in this plan.`,
    timestamp: new Date().toISOString()
  });

  // ⚡ BOLT OPTIMIZATION: Resolve N+1 query problem by batch-fetching all required
  // UI and API test definitions in a single database roundtrip.
  // Using Map for O(1) in-memory lookups during the sequential execution loop.
  // This significantly reduces DB load and latency for plans with many tests.
  const uiTestIds = selectedTestsLinks.filter(l => l.testType === 'ui' && l.testId).map(l => l.testId as number);
  const apiTestIds = selectedTestsLinks.filter(l => l.testType === 'api' && l.apiTestId).map(l => l.apiTestId as number);

  const uiTestsMap = new Map<number, Test>();
  if (uiTestIds.length > 0) {
    // No organization predicate: RLS supplies it. These ids come from the join rows above, and
    // the create/update handlers validate them against the caller's organization, but this is
    // the query that used to make an unvalidated foreign id executable.
    const uiTests = await withTenantTransaction((tx) =>
      tx.select().from(testsTable).where(inArray(testsTable.id, uiTestIds)),
    );
    uiTests.forEach(t => uiTestsMap.set(t.id, t as Test));
  }

  // Which version of each test this run is about to execute, read once and stamped on every
  // result. Without it the history of a test and the runs of it sit side by side and never
  // meet, so "did the application change, or did the test?" stays a question somebody has to
  // answer by reading dates.
  const testVersionsInRun = uiTestIds.length > 0
    ? await withTenantTransaction((tx) => currentVersionsOf(tx, uiTestIds))
    : new Map<number, number>();

  const apiTestsMap = new Map<number, ApiTest>();
  if (apiTestIds.length > 0) {
    const apiTests = await withTenantTransaction((tx) =>
      tx.select().from(apiTestsTable).where(inArray(apiTestsTable.id, apiTestIds)),
    );
    apiTests.forEach(t => apiTestsMap.set(t.id, t as ApiTest));
  }

  const legacyIndividualTestResultsForJsonBlob: IndividualTestRunResult[] = [];

  /**
   * Browsers the plan asked for that this runner cannot start.
   *
   * Checked once, before any test runs, rather than discovered by every test in turn: "Edge
   * is not installed here" is one fact about the machine, and reporting it as forty failed
   * logins sends forty people to read the login test.
   */
  const browserStartupFailures: string[] = [];
  const usablePasses: Array<BrowserChoice | undefined> = [];
  for (const pass of runPasses) {
    if (!pass) {
      usablePasses.push(pass);
      continue;
    }
    try {
      const probe = await launchBrowser(pass);
      await probe.close();
      usablePasses.push(pass);
    } catch (error: any) {
      // The plan wizard's machine configuration defaults to headed, and a runner in a
      // container has no display to be headed on. Falling back is better than failing the
      // whole pass over a checkbox nobody deliberately ticked — as long as the report says
      // that is what happened.
      if (pass.headless === false) {
        try {
          const probe = await launchBrowser({ ...pass, headless: true });
          await probe.close();
          usablePasses.push({ ...pass, headless: true });
          const fallback: ExecutionLogEntry = {
            level: 'warn',
            source: 'system',
            message: `${pass.label} could not start headed on this runner; it ran headless instead.`,
            timestamp: new Date().toISOString(),
            metadata: { browser: pass.label },
          };
          resolvedLogger.warn(fallback);
          wsEmitter.emitExecutionLog(testPlanRunId, fallback);
          continue;
        } catch {
          // Fall through to reporting the original failure.
        }
      }
      const message = error?.message ?? String(error);
      browserStartupFailures.push(message);
      const entry: ExecutionLogEntry = {
        level: 'error',
        source: 'system',
        message,
        timestamp: new Date().toISOString(),
        metadata: { browser: pass.label },
      };
      resolvedLogger.error(entry);
      wsEmitter.emitExecutionLog(testPlanRunId, entry);
    }
  }

  /**
   * Every test, on every browser that starts.
   *
   * A pass is the whole plan, API tests included: a plan is a flow, and the ids one of its
   * requests captured belong to the pass that captured them, not to the browser that ran
   * first.
   */
  type RunUnit = { browserChoice?: BrowserChoice; link: (typeof selectedTestsLinks)[number] };

  /**
   * One test, on one browser.
   *
   * Extracted from the loop it used to be so that several can be in flight at once. It takes
   * its pass's captured variables rather than reaching for a shared object: two browsers
   * running the same flow each create their own records, and one pass reading the id the
   * other captured is how a parallel run quietly tests the wrong thing.
   */
  const runUnit = async ({ browserChoice, link }: RunUnit, captured: Record<string, string>): Promise<void> => {
    let testObjectDefinition: Test | ApiTest | undefined;
    const testTypeForRun: 'ui' | 'api' | undefined = link.testType as ('ui' | 'api');

    if (link.testId && link.testType === 'ui') {
      testObjectDefinition = uiTestsMap.get(link.testId);
    } else if (link.apiTestId && link.testType === 'api') {
      testObjectDefinition = apiTestsMap.get(link.apiTestId);
    }

    const singleTestStartTime = Date.now();
    let reportStatus: InsertReportTestCaseResult['status'] = 'Pending'; // Default
    let failureReason: string | undefined = undefined;
    let screenshotFinalPath: string | undefined = undefined;
    let videoFinalPath: string | undefined = undefined;
    let traceFinalPath: string | undefined = undefined;
    let stepsOrLogData: string | undefined = undefined;

    const testName = testObjectDefinition?.name || `Unknown Test (ID: ${link.testId || link.apiTestId})`;
    const onBrowser = browserChoice ? ` on ${describeBrowser(browserChoice)}` : '';
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message: `Starting test: ${testName} (${testTypeForRun})${onBrowser}`,
      timestamp: new Date(singleTestStartTime).toISOString(),
      metadata: { testId: link.testId || link.apiTestId, testType: testTypeForRun, browser: browserChoice?.label }
    });

    if (testObjectDefinition && testTypeForRun) {
      if (testTypeForRun === 'ui' && typeof (testObjectDefinition as Test).sequence === 'string') {
        try { (testObjectDefinition as Test).sequence = JSON.parse((testObjectDefinition as Test).sequence as any); }
        catch (e) { resolvedLogger.warn("Failed to parse UI test sequence"); }
      }
      if (testTypeForRun === 'ui' && typeof (testObjectDefinition as Test).elements === 'string') {
        try { (testObjectDefinition as Test).elements = JSON.parse((testObjectDefinition as Test).elements as any); }
        catch (e) { resolvedLogger.warn("Failed to parse UI test elements"); }
      }

      // API tests still have their `{{KEY}}` placeholders substituted into the request
      // object up front: the API runner has no per-field resolution step to hand a variable
      // map to. UI tests no longer need it — the shared step executor resolves them from the
      // same map — and doing both would hide an unresolved name instead of reporting it.
      if (testTypeForRun === 'api' && Object.keys(secretsMap).length > 0) {
        testObjectDefinition = injectSecretsIntoTest(testObjectDefinition, secretsMap);
      }

      const resultFromRunTest = await runTest(
        testObjectDefinition!,
        userId,
        planId,
        testPlanRunId,
        testTypeForRun,
        runVariables(captured),
        planEnvironment(),
        {
          browser: browserChoice,
          visual:
            visualTesting && testTypeForRun === 'ui'
              ? {
                  organizationId: executionRecord[0].organizationId,
                  updateBaselines: jobOptions.updateBaselines === true,
                }
              : undefined,
          evidence: runEvidence,
        },
      );
      legacyIndividualTestResultsForJsonBlob.push(resultFromRunTest); // Keep populating the old JSON blob for now

      if (resultFromRunTest.extracted) {
        Object.assign(captured, resultFromRunTest.extracted);
      }
      // Surfaced on the run's console rather than only in the result blob: an extraction
      // that found nothing is the reason the *next* test fails, and reading that in the
      // right order is the difference between a five-minute diagnosis and an hour's.
      for (const failure of resultFromRunTest.extractionErrors ?? []) {
        const entry: ExecutionLogEntry = {
          level: 'warn',
          source: 'system',
          message: `Could not capture "${failure.name}" from ${testName}: ${failure.reason}. ` +
            `Later requests using {{${failure.name}}} will fail.`,
          timestamp: new Date().toISOString(),
          metadata: { testId: resultFromRunTest.testId, variable: failure.name },
        };
        resolvedLogger.warn(entry);
        wsEmitter.emitExecutionLog(testPlanRunId, entry);
      }

      // Map runTest result to reportTestCaseResults status
      if (resultFromRunTest.status === 'passed') reportStatus = 'Passed';
      else if (resultFromRunTest.status === 'failed') reportStatus = 'Failed';
      else if (resultFromRunTest.status === 'error') reportStatus = 'Error';
      // 'Skipped' needs to be handled if runTest can produce it

      failureReason = resultFromRunTest.error;
      screenshotFinalPath = resultFromRunTest.screenshotPath; // This is a file path
      videoFinalPath = resultFromRunTest.videoPath;
      traceFinalPath = resultFromRunTest.tracePath;
      stepsOrLogData = resultFromRunTest.steps ? JSON.stringify(resultFromRunTest.steps) : undefined; // For UI tests

      const singleTestDurationMs = Date.now() - singleTestStartTime;
      wsEmitter.emitExecutionLog(testPlanRunId, {
        level: reportStatus === 'Passed' ? 'info' : 'error',
        source: 'system',
        message: `Finished test: ${testName}. Status: ${reportStatus} (${singleTestDurationMs}ms)`,
        timestamp: new Date().toISOString(),
        metadata: { durationMs: singleTestDurationMs, status: reportStatus }
      });

      // Convert screenshotPath to a URL if needed, e.g., /results/planId/runId/testId/screenshot.png
      // Stored the way the report reads them: the artifacts route turns one of these back
      // into something a browser can open (see server/routes/artifacts.routes.ts).
      const asResultsUrl = (filePath?: string) =>
        filePath ? filePath.replace(/^\.?\/?results/, '/results').replace(/\\/g, '/') : undefined;
      screenshotFinalPath = asResultsUrl(screenshotFinalPath);
      videoFinalPath = asResultsUrl(videoFinalPath);
      traceFinalPath = asResultsUrl(traceFinalPath);


    } else {
      resolvedLogger.warn({ message: `Test object not found or type mismatch for link`, linkId: link.id });
      reportStatus = 'Error';
      failureReason = 'Test definition not found or type mismatch during plan execution.';
      legacyIndividualTestResultsForJsonBlob.push({
        testId: link.testId || link.apiTestId || -1,
        testType: (link.testType as 'ui' | 'api' || 'unknown') as 'ui' | 'api',
        name: `Unknown Test (ID: ${link.testId || link.apiTestId})`,
        success: false, status: 'error', error: failureReason, durationMs: 0,
      });
    }

    const singleTestEndTime = Date.now();
    const singleTestDurationMs = singleTestEndTime - singleTestStartTime;

    const reportCaseResultId = uuidv4();
    const newReportEntry: InsertReportTestCaseResult = {
      id: reportCaseResultId,
      // Same organization as the test plan execution this result belongs to.
      organizationId: executionRecord[0].organizationId,
      testPlanExecutionId: testPlanRunId,
      uiTestId: link.testType === 'ui' ? link.testId : null,
      apiTestId: link.testType === 'api' ? link.apiTestId : null,
      testType: link.testType as 'ui' | 'api',
      testName: testObjectDefinition?.name || `Unknown Test (ID: ${link.testId || link.apiTestId})`,
      // Null when the plan named no browser, which is every run made before the matrix
      // existed: the report should not claim to know something the run never decided.
      browser: browserChoice?.label ?? null,
      // Null for an API test, which has no version history, and for a UI test saved before
      // versions were recorded. Either way the row says it does not know rather than
      // claiming version 1.
      testVersion: link.testType === 'ui' && link.testId ? testVersionsInRun.get(link.testId) ?? null : null,
      status: reportStatus,
      reasonForFailure: failureReason,
      screenshotUrl: screenshotFinalPath,
      videoUrl: videoFinalPath ?? null,
      traceUrl: traceFinalPath ?? null,
      detailedLog: stepsOrLogData, // Or specific log for API tests
      startedAt: new Date(singleTestStartTime),
      completedAt: new Date(singleTestEndTime),
      durationMs: singleTestDurationMs,
      module: testObjectDefinition?.module || null,
      featureArea: testObjectDefinition?.featureArea || null,
      scenario: testObjectDefinition?.scenario || null,
      component: testObjectDefinition?.component || null,
      priority: testObjectDefinition?.priority || null,
      severity: testObjectDefinition?.severity || null, // This is designed severity. Runtime severity could differ.
    };

    try {
      await withTenantTransaction((tx) => tx.insert(reportTestCaseResultsTable).values(newReportEntry));
    } catch (dbInsertError: any) {
      resolvedLogger.error({ message: 'Failed to insert into reportTestCaseResultsTable', entry: newReportEntry, error: dbInsertError.message });
      // Continue execution, this test result might be missing from detailed report but plan will complete.
    }
  }; // End of one run unit

  /**
   * One lane per browser: the whole plan, in order, with its own captured values.
   *
   * A pass is an independent run of the plan, so what one browser's flow created belongs to
   * that browser's flow. Sharing the captured map across passes — which is what a single
   * shared object did — meant the second browser read the first one's ids and never exercised
   * its own creates.
   */
  const lanes = usablePasses.map((browserChoice) => ({
    browserChoice,
    units: selectedTestsLinks.map((link) => ({ browserChoice, link }) as RunUnit),
    captured: {} as Record<string, string>,
  }));

  /**
   * Whether the tests in a lane have to stay in order.
   *
   * An extraction is what makes a plan a flow: the id the create returned is the id the
   * read-back needs. Those tests cannot be reordered or overlapped, and the plan that
   * declares them is saying so. Everything else is a list of independent checks.
   */
  const laneIsChained = [...apiTestsMap.values()].some((apiTest) => {
    const extractions = apiTest.extractions;
    const parsed = typeof extractions === 'string' ? safeJsonArray(extractions) : extractions;
    return Array.isArray(parsed) && parsed.length > 0;
  });

  const parallelism = effectiveConcurrency(plan?.maxParallelTests);
  if (parallelism > 1) {
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message: laneIsChained
        ? `Running up to ${parallelism} browsers at once. This plan's API tests capture values for later ` +
          `requests, so within each browser its tests stay in order.`
        : `Running up to ${parallelism} tests at once.`,
      timestamp: new Date().toISOString(),
      metadata: { parallelism, chained: laneIsChained },
    });
  }

  /** Surfaced like a browser that would not start: something ran, and it was not the test. */
  const unitFailures: string[] = [];
  const recordSettled = (settled: PromiseSettledResult<void>[]) => {
    for (const outcome of settled) {
      if (outcome.status !== 'rejected') continue;
      const message = `A test in this run could not be executed: ${
        (outcome.reason as any)?.message ?? String(outcome.reason)
      }`;
      unitFailures.push(message);
      const entry: ExecutionLogEntry = {
        level: 'error',
        source: 'system',
        message,
        timestamp: new Date().toISOString(),
      };
      resolvedLogger.error(entry);
      wsEmitter.emitExecutionLog(testPlanRunId, entry);
    }
  };

  if (parallelism <= 1) {
    // The order every plan has always run in: one browser at a time, its tests in sequence.
    for (const lane of lanes) {
      for (const unit of lane.units) {
        try {
          await runUnit(unit, lane.captured);
        } catch (error: any) {
          recordSettled([{ status: 'rejected', reason: error }]);
        }
      }
    }
  } else if (laneIsChained) {
    // Browsers side by side; within each one, the flow keeps its order.
    recordSettled(
      await runWithConcurrency(
        parallelism,
        lanes.map((lane) => async () => {
          for (const unit of lane.units) await runUnit(unit, lane.captured);
        }),
      ),
    );
  } else {
    recordSettled(
      await runWithConcurrency(
        parallelism,
        lanes.flatMap((lane) => lane.units.map((unit) => () => runUnit(unit, lane.captured))),
      ),
    );
  }

  // After all tests have run, calculate final aggregates from reportTestCaseResultsTable
  const finalDetailedResults = await withTenantTransaction((tx) =>
    tx.select()
      .from(reportTestCaseResultsTable)
      .where(eq(reportTestCaseResultsTable.testPlanExecutionId, testPlanRunId)),
  );

  const calculatedTotalTests = finalDetailedResults.length;
  const calculatedPassedTests = finalDetailedResults.filter((r: any) => r.status === 'Passed').length;
  const calculatedFailedTests = finalDetailedResults.filter((r: any) => r.status === 'Failed').length;
  const calculatedSkippedTests = finalDetailedResults.filter((r: any) => r.status === 'Skipped').length;
  // Consider 'Error' status as failures or a separate category if needed for overall status.
  // For overall status, let's say if any 'Failed' or 'Error', the whole run is 'failed'.
  // If any 'Skipped' and no 'Failed'/'Error', maybe 'partial' or 'completed_with_skipped'.
  // If all 'Passed', then 'completed'.

  // Every branch below assigns one of the three; 'error' is what a state nobody anticipated
  // should end as, rather than a run left looking unfinished.
  let finalOverallStatus: 'completed' | 'failed' | 'error' = 'error';
  if (calculatedTotalTests === 0 && selectedTestsLinks.length > 0) {
    finalOverallStatus = 'error'; // No results recorded but tests were expected
  } else if (calculatedFailedTests > 0 || finalDetailedResults.some((r: any) => r.status === 'Error')) {
    finalOverallStatus = 'failed';
  } else if (calculatedTotalTests === calculatedPassedTests && calculatedTotalTests > 0) {
    finalOverallStatus = 'completed';
  } else if (calculatedTotalTests > 0 && calculatedPassedTests < calculatedTotalTests) {
    // Some tests ran, none failed outright, but not all passed (e.g. skipped, or if we add other non-failure statuses)
    finalOverallStatus = 'completed'; // Or a more nuanced status like 'completed_with_issues'
  } else if (selectedTestsLinks.length === 0) {
    finalOverallStatus = 'completed'; // No tests to run, so it's 'completed'
  } else {
    finalOverallStatus = 'error'; // Default to error if logic doesn't cover a state
  }

  // A plan that asked for three browsers and got two did not do what it was asked, whatever
  // the tests that did run reported — and neither did one whose test never executed at all.
  // Saying "completed" for either is how a gap in coverage comes to look like coverage.
  if ((browserStartupFailures.length > 0 || unitFailures.length > 0) && finalOverallStatus === 'completed') {
    finalOverallStatus = 'error';
  }

  const overallCompletedAt = Date.now();
  const overallExecutionDurationMs = overallCompletedAt - overallStartTime;

  try {
    // Only a run that is still running can be given its verdict. If something else ended it in
    // the meantime — a cancellation, a timeout — that ending stands, and this run's late result
    // is not allowed to overwrite it.
    const finished = await transitionExecution(testPlanRunId, finalOverallStatus, {
      results: JSON.stringify(legacyIndividualTestResultsForJsonBlob), // Keep the old JSON blob for now
      totalTests: calculatedTotalTests,
      passedTests: calculatedPassedTests,
      failedTests: calculatedFailedTests,
      skippedTests: calculatedSkippedTests,
      executionDurationMs: overallExecutionDurationMs,
      ...(finalOverallStatus === 'error'
        ? {
            failureCode: 'run_incomplete',
            failureMessage: 'Not every browser or test in the plan produced a result.',
          }
        : {}),
    });
    const finalUpdateResult = finished ? [finished] : [];

    if (finalUpdateResult.length > 0) {
      resolvedLogger.info({ message: `Test plan execution COMPLETED and DB updated`, planId, testPlanRunId, overallStatus: finalOverallStatus, testsRun: calculatedTotalTests });
      // Before the notification, so a message that says "3 failed" arrives after the issues
      // those failures produced already exist to be linked to.
      await fileFailuresIfConfigured({
        plan,
        planId,
        executionId: testPlanRunId,
        organizationId: executionRecord[0].organizationId,
        results: finalDetailedResults,
      });
      await notifyRunFinished({
        plan,
        execution: executionRecord[0],
        summary: {
          planId,
          planName: plan?.name ?? planId,
          executionId: testPlanRunId,
          status: finalOverallStatus,
          totalTests: calculatedTotalTests,
          passedTests: calculatedPassedTests,
          failedTests: calculatedFailedTests,
          skippedTests: calculatedSkippedTests,
          durationMs: overallExecutionDurationMs,
          triggeredBy: executionRecord[0].triggeredBy ?? 'manual',
          browsers: usablePasses.filter(Boolean).map((b) => (b as BrowserChoice).label),
        },
      });
      return finalUpdateResult[0];
    } else {
      // The run was no longer running: something else ended it while the tests were going.
      // Its ending stands, and nothing is filed or announced for a verdict that was not recorded.
      resolvedLogger.warn({ message: `Verdict not recorded: the execution had already ended`, planId, testPlanRunId, verdict: finalOverallStatus });
      currentTestPlanRun.status = 'error'; // Update in-memory object
      return { ...currentTestPlanRun, error: "Failed to finalize database record, but execution attempted." } as any; // Cast to avoid type issues with error prop
    }
  } catch (dbError: any) {
    resolvedLogger.error({ message: 'CRITICAL: Failed to update TestPlanRun with final aggregates in DB', planId, testPlanRunId, error: dbError.message });
    return {
      id: testPlanRunId, testPlanId: planId, status: 'error',
      results: JSON.stringify(legacyIndividualTestResultsForJsonBlob),
      startedAt: currentTestPlanRun.startedAt,
      completedAt: new Date(overallCompletedAt),
      error: `DB error during final aggregate update: ${dbError.message}`
    } as any;
  }
}

/**
 * Files this run's failures where the plan said to file them.
 *
 * Only when the plan opted in and named a tracker: filing a bug is an action in somebody else's
 * system, and a build that starts doing it on its own is one nobody forgives.
 *
 * Like the notification below, it cannot fail the run. The verdict is already written, and a
 * Jira that is down, a token that expired or a project somebody renamed must cost a line in the
 * console and nothing more — a run that crashed because it could not file a bug would have
 * turned a recorded result into no result at all.
 *
 * A test that passed and had an issue open gets a comment saying so. Only a comment: whether
 * the bug is fixed depends on what else is in it, and software that closes somebody's ticket
 * off one green run is software they switch off.
 */
async function fileFailuresIfConfigured(input: {
  plan: { name?: string; issueTrackerId?: string | null; createIssuesOnFailure?: boolean } | undefined;
  planId: string;
  executionId: string;
  organizationId: number;
  results: Array<{ testName: string; browser?: string | null; status: string; reasonForFailure?: string | null; startedAt?: Date | null; uiTestId?: number | null; testVersion?: number | null }>;
}): Promise<void> {
  const resolvedLogger = await loggerPromise;
  const wsEmitter = getWsEmitter();
  const say = (level: 'info' | 'warn', message: string) => {
    const entry: ExecutionLogEntry = { level, source: 'system', message, timestamp: new Date().toISOString() };
    if (level === 'warn') resolvedLogger.warn(entry); else resolvedLogger.info(entry);
    wsEmitter.emitExecutionLog(input.executionId, entry);
  };

  try {
    if (!input.plan?.createIssuesOnFailure || !input.plan.issueTrackerId) return;

    const tracker = await loadTracker(input.plan.issueTrackerId);
    if (!tracker) {
      say('warn', 'This plan is set to file failures, but the issue tracker it names no longer exists.');
      return;
    }

    for (const row of input.results) {
      const failure = {
        planId: input.planId,
        planName: input.plan.name ?? null,
        executionId: input.executionId,
        testName: row.testName,
        browser: row.browser ?? null,
        status: row.status,
        testVersion: row.testVersion ?? null,
        reason: row.reasonForFailure ?? null,
        startedAt: row.startedAt ?? null,
      };

      const status = String(row.status).toLowerCase();
      if (status === 'failed' || status === 'error') {
        const outcome = await fileFailure({
          organizationId: input.organizationId,
          tracker,
          uiTestId: row.uiTestId ?? null,
          failure,
        });
        if (outcome.action === 'created') {
          say('info', `Filed ${outcome.issueKey} in ${tracker.name} for "${row.testName}": ${outcome.issueUrl}`);
        } else if (outcome.action === 'commented') {
          say('info', `"${row.testName}" has failed ${outcome.occurrences} times; commented on ${outcome.issueKey}.`);
        } else if (outcome.action === 'failed') {
          say('warn', `Could not file "${row.testName}" in ${tracker.name}: ${outcome.error}`);
        }
        continue;
      }

      if (status === 'passed') {
        // Cheap for the common case: this reads the link table and only reaches the tracker
        // when there is an open issue to say it about.
        const outcome = await markResolved({ tracker, failure });
        if (outcome.action === 'commented') {
          say('info', `"${row.testName}" passed again; said so on ${outcome.issueKey}.`);
        } else if (outcome.action === 'failed') {
          say('warn', `Could not comment on the issue for "${row.testName}": ${outcome.error}`);
        }
      }
    }
  } catch (error: any) {
    say('warn', `Issue filing could not be attempted: ${error?.message ?? error}`);
  }
}

/**
 * Tells whoever the plan named that the run is over.
 *
 * Wrapped in its own try/catch and never allowed to throw: the run has already happened and
 * its verdict has already been written, and a notification that cannot be delivered must not
 * turn a recorded result into a crashed job.
 */
async function notifyRunFinished(input: {
  plan: { notificationSettings?: unknown } | undefined;
  execution: { scheduleId?: string | null };
  summary: RunSummary;
}): Promise<void> {
  const resolvedLogger = await loggerPromise;
  const wsEmitter = getWsEmitter();
  try {
    // A schedule may override the plan's settings — most usefully the destination, so a
    // nightly run can report somewhere other than wherever manual runs report.
    let override: unknown;
    if (input.execution.scheduleId) {
      const schedule = await withTenantTransaction((tx) =>
        tx
          .select({ notificationConfigOverride: testPlanSchedules.notificationConfigOverride })
          .from(testPlanSchedules)
          .where(eq(testPlanSchedules.id, input.execution.scheduleId as string))
          .limit(1),
      );
      override = schedule[0]?.notificationConfigOverride;
    }

    const settings = mergeNotificationSettings(input.plan?.notificationSettings, override);
    for (const note of describeUnsupported(settings)) {
      resolvedLogger.warn({ message: note, executionId: input.summary.executionId });
      wsEmitter.emitExecutionLog(input.summary.executionId, {
        level: 'warn',
        source: 'system',
        message: note,
        timestamp: new Date().toISOString(),
      });
    }

    const result = await sendRunNotification(settings, input.summary);
    if (result.delivered) {
      wsEmitter.emitExecutionLog(input.summary.executionId, {
        level: 'info',
        source: 'system',
        message: 'Run notification delivered.',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (result.error) {
      resolvedLogger.warn({ message: result.error, executionId: input.summary.executionId });
      wsEmitter.emitExecutionLog(input.summary.executionId, {
        level: 'warn',
        source: 'system',
        message: result.error,
        timestamp: new Date().toISOString(),
      });
    } else if (result.reason) {
      resolvedLogger.debug({ message: result.reason, executionId: input.summary.executionId });
    }
  } catch (error: any) {
    resolvedLogger.warn({
      message: `Run notification could not be attempted: ${error?.message ?? error}`,
      executionId: input.summary.executionId,
    });
  }
}
