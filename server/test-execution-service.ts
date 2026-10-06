import { failedStepReason } from './failed-step-reason';
import { playwrightService } from './playwright-service';
import type { Test, ApiTest, TestPlan, TestPlanExecution, InsertReportTestCaseResult, Precondition, Cleanup, ExecutionTrigger } from '@shared/schema'; // Assuming ApiTest will be defined or Test is generic enough
import { runPreconditions } from './precondition-runner';
import { cleanupReportStep, runCleanups } from './cleanup-runner';
import type { StepResult } from './playwright-service'; // Import StepResult type
import loggerPromise from './logger';
import { privilegedDb } from './db';
import { getTenantOrgId, runWithTenant, withTenantTransaction } from './middleware/tenancy';
import {
  tests as testsTable,
  apiTests as apiTestsTable,
  testPlanSelectedTests,
  testPlans,
  testPlanExecutions as testPlanExecutionsTable,
  reportTestCaseResults as reportTestCaseResultsTable, // Added
  mobileTests as mobileTestsTable,
  type MobileTest,
  type BrowserGrid,
} from '@shared/schema';
import { mobileDeviceLabel, performMobileTest, type MobileOutcome } from './mobile-runner';
import { freezeMobilePlanDefinitions, mobilePlanTargets, type MobilePlanTarget } from './mobile-plan-units';
import { toGridConfig } from './browser-grids';
import { and, asc, eq, inArray } from 'drizzle-orm'; // Added sql
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs-extra';
import path from 'path';
import { getWsEmitter, type ExecutionLogEntry } from './websocket';
import { secrets as secretsTable } from '@shared/schema';
import { decryptSecret } from './crypto';
import { defaultVariables } from './variables';
import { protocolReport } from './api-protocol-report';
import { runDedicatedBddTest } from './bdd-execution';
import { runApiRequest, type ApiRequestSpec, type Extraction } from './api-test-runner';
import { runPerformance } from './api-performance';
import { mailRunFinished } from './run-mail';
import { organizationMailConfigured } from './mailer';
import { SharedDataError, expandSharedDataset, loadDataVariables } from './test-data';
import type { ApiPerformance, PerformanceSummary } from '@shared/api-performance';
import { AgentHttp } from './agents/agent-fetch';
import type { Assertion, AuthParams } from '@shared/schema';
import { browsersForRun, describeBrowser, hasConfiguredBrowsers, launchBrowser, onAgents, onGrid, type BrowserChoice } from './browsers';
import { browserGrids } from '@shared/schema';
import { BROWSER_GRID_LABELS, type BrowserGridProvider } from '@shared/browser-grids';
import { gridWarnings } from './browser-grids';
import { LOCALE_VARIABLE, passLabel } from '@shared/locales';
import { isManualSequence, manualStepsOf, type ManualResultLog } from '@shared/manual-tests';
import type { MobileResultLog } from '@shared/mobile';
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
import { publishExecution } from './test-management';
import { currentContentOf, currentVersionsOf } from './test-version-store';
import { reproducibilitySummary } from './execution-provenance';
import { publishedContentOf, reviewRequired } from './test-publishing';
import { failuresOf, openQuarantinesOf, refKey } from './test-quarantine';
import { describeNetworkFailures, type NetworkSummary } from '@shared/network';
import { takeExecution, transitionExecution } from './execution-state';
import { artifactStore } from './artifact-store';
import { QuotaError, quotaErrorBody } from './tenant-quotas';
import { withExecutionUsage } from './execution-usage';
import { watchRun } from './run-watch';
import {
  claimWorkItem,
  finishWorkItem,
  heartbeatWorkItems,
  openWorkItems,
  recordStopReason,
  shardCount,
  shardDispatcher,
  sharedStopReason,
  workItemResults,
  workerName,
  writeWorkItems,
  WORK_ITEM_HEARTBEAT_MS,
  WORK_POLL_MS,
  type WorkUnit,
} from './run-shards';
import {
  describePolicies,
  runPoliciesFrom,
  stopReasonAfter,
  type PreconditionFailurePolicy,
  type StepRuntime,
} from './run-policies';
import { ExecutionEnqueueError, executionOrchestrator } from './execution-orchestrator';
import {
  buildExecutionSnapshot,
  readExecutionSnapshot,
  type ExecutionSnapshot,
  type SnapshotTestReference,
} from './execution-snapshot';
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
  status: 'passed' | 'failed' | 'error' | 'skipped'; // Add 'error' for execution errors before steps
  /** Its preconditions failed — which the plan's prerequisite policy decides what to do about. */
  blockedByPrecondition?: boolean;
  steps?: StepResult[]; // from playwright-service
  error?: string; // For errors during test execution itself (e.g., Playwright internal error)
  durationMs: number;
  /** Values an API test captured, for the requests that come after it in the plan. */
  extracted?: Record<string, string>;
  extractionErrors?: Array<{ name: string; reason: string }>;
  /** An API test's performance check, when it has one (shared/api-performance.ts). */
  performance?: PerformanceSummary;
  /** Bounded native transcript redacted for persisted reports. Live extractions stay separate. */
  protocol?: ReturnType<typeof protocolReport>;
  bdd?: { runs: import('@shared/bdd-agent').BddAgentResult[] };
  screenshotPath?: string; // General screenshot for API tests if applicable, or last step for UI
  /** Kept only when the plan asked for them — see server/run-evidence.ts. */
  videoPath?: string;
  tracePath?: string;
  harPath?: string;
  /** Read from the HAR whenever the network was recorded, kept file or not. */
  network?: NetworkSummary;
  /** The directory this test wrote its evidence into, to be published to the artifact store. */
  artifactDir?: string;
}


/** What the plan adds to a single test run: which browser, and whether to compare it visually. */
export interface RunTestOptions {
  browser?: BrowserChoice;
  visual?: Omit<VisualContext, 'testId' | 'browser'>;
  /** Whether to keep a video and a trace of the run. The directory is this test's own. */
  evidence?: { video?: EvidenceCaptureMode; trace?: EvidenceCaptureMode; network?: EvidenceCaptureMode };
  /** The plan's timeouts, screenshots and step retry — see server/run-policies.ts. */
  runtime?: StepRuntime;
  /** What a failed precondition means for this test. Absent: it is blocked, as it always was. */
  onPreconditionFailure?: PreconditionFailurePolicy;
  /** Aborted when the run is cancelled or out of time; the test stops at its next step. */
  signal?: AbortSignal;
  /**
   * Where API tests, API preconditions and OAuth token requests are sent from. Absent: this
   * runner. For a plan on an agent pool, the agent (server/agents/agent-fetch.ts).
   */
  http?: typeof fetch;
  /** The language the browser starts in (shared/locales.ts). Absent: the browser's default. */
  locale?: string;
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
  if (testType === 'ui' && (test as Test).bdd?.mode === 'cucumber') return runDedicatedBddTest(test as Test,vars,options);

  if (testType === 'ui' && isManualSequence((test as Test).sequence)) {
    // Nothing for a browser to do: a person performs it and records the result in a plan run.
    return {
      testId,
      testType: 'ui',
      name: testName,
      success: false,
      status: 'skipped',
      error: 'Manual test: it is performed by a person, and its result is recorded in the report of a plan run.',
      durationMs: 0,
    };
  }

  if (testType === 'ui') {
    const uiTest = test as Test;
    // The variables each run of the steps ended with (one per dataset row), for the cleanup.
    const variableSets: Array<Record<string, string>> = [];
    /**
     * The test's cleanup (server/cleanup-runner.ts), after the test whatever became of it — passed,
     * failed, blocked by a precondition that may have created half of what it meant to. Shown as the
     * last line of its steps; it never changes the result.
     */
    const withCleanup = async (result: IndividualTestRunResult): Promise<IndividualTestRunResult> => {
      const cleanups = (uiTest as unknown as { cleanups?: Cleanup[] | null }).cleanups;
      if (!cleanups || cleanups.length === 0) return result;
      const cleanup = await runCleanups(cleanups, variableSets.length > 0 ? variableSets : [vars], options?.http);
      for (const step of cleanup.steps.filter((s) => s.status === 'failed' || s.status === 'skipped')) {
        getWsEmitter().emitExecutionLog(runId, {
          level: 'warn',
          source: 'system',
          message: `"${uiTest.name}": cleanup "${step.name}" ${step.status === 'failed' ? 'failed' : 'was skipped'}: ${step.detail}`,
          timestamp: new Date().toISOString(),
        });
      }
      return { ...result, steps: [...(result.steps ?? []), cleanupReportStep(cleanup) as StepResult] };
    };
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
        options?.http,
      );
      if (!preResult.ok && options?.onPreconditionFailure === 'continue') {
        // "Continue Anyway": the test runs from whatever state the application is in, and
        // says so, because a failure after this may be the setup's rather than the test's.
        getWsEmitter().emitExecutionLog(runId, {
          level: 'warn',
          source: 'system',
          message:
            `"${uiTest.name}": precondition "${preResult.failedAt}" failed (${preResult.reason}); ` +
            `running the test anyway, as this plan asks.`,
          timestamp: new Date().toISOString(),
        });
      } else if (!preResult.ok) {
        const durationMs = Date.now() - startTime;
        const reason = `Precondition failed at "${preResult.failedAt}": ${preResult.reason}`;
        resolvedLogger.warn({
          message: 'UI Test blocked: precondition failed',
          testId, testName, planId, runId, failedAt: preResult.failedAt, reason: preResult.reason,
        });
        const skipped = options?.onPreconditionFailure === 'skip';
        return withCleanup({
          testId,
          testType: 'ui',
          name: uiTest.name,
          success: false,
          // "Skip Test Case" says the test said nothing either way, which is what a skip is.
          status: skipped ? 'skipped' : 'error',
          blockedByPrecondition: true,
          error: skipped ? `Skipped: ${reason}` : reason,
          durationMs,
        });
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
                // Each language against its own baselines: an Italian page compared with an
                // English screenshot differs by every word, which is not a regression.
                browser: `${options.browser?.label ?? 'default'}${options.locale ? `_${options.locale}` : ''}`,
                artifactDir: screenshotBaseDir,
              }
            : undefined,
          evidence: options?.evidence
            ? { ...options.evidence, artifactDir: screenshotBaseDir }
            : undefined,
          runtime: options?.runtime,
          signal: options?.signal,
          locale: options?.locale,
          onVariables: (set) => variableSets.push(set),
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
      return withCleanup({
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
        harPath: result.evidence?.harPath,
        network: result.evidence?.network,
        artifactDir: screenshotBaseDir,
      });
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      resolvedLogger.error({ message: `Critical error during UI test execution`, testId, testName, planId, runId, error: error.message, stack: error.stack });
      return withCleanup({
        testId,
        testType: 'ui',
        name: uiTest.name,
        success: false,
        status: 'error',
        error: `Execution failed: ${error.message}`,
        durationMs,
      });
    }
  } else if (testType === 'api') {
    const apiTest = test as ApiTest; // Cast to ApiTest
    resolvedLogger.info({ message: `API Test execution starting`, testId: apiTest.id, testName: apiTest.name, planId, runId });

    // This used to be `Math.random() > 0.2` under a TODO: no request was made, and every
    // API test in a plan reported a fabricated result that looked exactly like a real one.
    const spec: ApiRequestSpec = {
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
      protoDefinition: apiTest.protoDefinition,
      protocolConfig: apiTest.protocolConfig,
    };
    const result = await runApiRequest(spec, vars, options?.http);
    const nativeProtocol = ['GRPC', 'WEBSOCKET', 'WS'].includes(spec.method) || !!apiTest.protocolConfig || /^(grpcs?|wss?):/.test(spec.url);

    // The performance check runs only when the request could be made at all: timing an
    // endpoint that cannot be reached would measure nothing but the timeout.
    const settings = (apiTest as ApiTest & { performance?: ApiPerformance | null }).performance;
    const performance =
      settings && !result.error
        ? await runPerformance(spec, vars, settings, result, options?.http, () => !!options?.signal?.aborted)
        : undefined;

    const durationMs = Date.now() - startTime;
    const failedAssertions = result.assertions.filter((a) => !a.pass);
    const success = result.passed && !result.error && !(performance && performance.breaches.length > 0);
    const failure = result.error ?? ([
      ...failedAssertions.map(a => `${a.assertion.source}${a.assertion.property ? ` "${a.assertion.property}"` : ''} ` +
        `${a.assertion.comparison} "${a.assertion.targetValue ?? ''}" — actual: ${JSON.stringify(a.actualValue)}` + (a.error ? ` (${a.error})` : '')),
      ...(performance?.breaches.length ? [`Performance over ${performance.iterations} requests: ${performance.breaches.join(', ')}`] : []),
    ].join('; ') || undefined);
    const protocol = nativeProtocol ? protocolReport({ ...result, error: failure }, vars) : undefined;

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
      error: protocol ? protocol.error : failure,
      durationMs,
      extracted: result.extracted,
      extractionErrors: result.extractionErrors,
      ...(performance ? { performance } : {}),
      ...(protocol ? { protocol } : {}),
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
/**
 * What a caller can say about a run beyond which plan it is.
 *
 * Every run, whoever asks for it, is created by server/execution-orchestrator.ts; this is the
 * shape the routes and webhooks have always called, over it.
 */
export interface RunTestPlanOptions {
  environmentId?: number | null;
  /** Accept this run's screenshots as the new visual baselines. */
  updateBaselines?: boolean;
  /** Asking again with the same key returns the first run instead of starting another. */
  idempotencyKey?: string | null;
  /** Who asked for it, when that is not a person pressing Run. */
  trigger?: ExecutionTrigger;
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
  const resolvedLogger = await loggerPromise;

  try {
    const execution = await executionOrchestrator.enqueue({
      planId,
      requestedByUserId: userId,
      trigger: options.trigger ?? 'manual',
      environmentId: options.environmentId ?? null,
      updateBaselines: options.updateBaselines,
      idempotencyKey: options.idempotencyKey,
    });
    resolvedLogger.info({ message: 'Test plan execution enqueued', planId, testPlanRunId: execution.id, userId });
    return execution;
  } catch (error: any) {
    if (error instanceof ExecutionEnqueueError) {
      resolvedLogger.warn({ message: 'Test plan execution not enqueued', planId, code: error.code, error: error.message });
      return { error: error.message, status: error.status, testPlanRunId: error.executionId };
    }
    const quota = quotaErrorBody(error);
    if (quota) return { error: String(quota.error), status: 429 };
    resolvedLogger.error({ message: 'Failed to enqueue test plan run', planId, error: error.message, stack: error.stack });
    return { error: `Failed to initialize test plan run: ${error.message}`, status: 500 };
  }
}

/** The one privileged read of a job: which organization its execution belongs to. Shared by both job kinds. */
async function organizationOfExecution(executionId: string): Promise<{ organizationId: number } | undefined> {
  const [execution] = await privilegedDb
    .select({ organizationId: testPlanExecutionsTable.organizationId })
    .from(testPlanExecutionsTable)
    .where(eq(testPlanExecutionsTable.id, executionId))
    .limit(1);
  return execution;
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
  const execution = await organizationOfExecution(testPlanRunId);

  if (!execution) {
    bootstrapLogger.error({ message: 'Test plan execution record not found', testPlanRunId });
    return { error: `Test plan execution ${testPlanRunId} not found.`, status: 500, testPlanRunId };
  }

  return runWithTenant(execution.organizationId, () =>
    runTestPlanJobInTenant(planId, testPlanRunId, userId, jobOptions),
  );
}

/**
 * A helper's share of a run on several workers (server/run-shards.ts): the job the coordinator
 * queued as `execute-shard`. Same boundary as processTestPlanJob: one privileged lookup of the
 * organization, everything else under it.
 */
export async function processShardJob(
  planId: string,
  executionId: string,
  userId: number,
  shard: number,
  jobOptions: { updateBaselines?: boolean } = {},
): Promise<any> {
  const execution = await organizationOfExecution(executionId);
  if (!execution) return { skipped: true, reason: 'Execution not found.', testPlanRunId: executionId };
  return runWithTenant(execution.organizationId, () =>
    withExecutionUsage('shard', () => runTestPlanJobInTenant(planId, executionId, userId, jobOptions, { shard }), `${executionId}-shard-${shard}`),
  );
}

async function runTestPlanJobInTenant(
  planId: string,
  testPlanRunId: string,
  userId: number,
  jobOptions: { updateBaselines?: boolean } = {},
  /** Set for a helper sharing a run another worker took (server/run-shards.ts). */
  helper?: { shard: number },
): Promise<any> {
  const resolvedLogger = await loggerPromise;
  // A helper repeats the coordinator's setup; its informational lines would only say everything twice.
  let quiet = !!helper;
  const sharedEmitter = getWsEmitter();
  const wsEmitter: typeof sharedEmitter = helper
    ? { ...sharedEmitter, emitExecutionLog: (id, entry) => { if (!(quiet && entry.level === 'info')) sharedEmitter.emitExecutionLog(id, entry); } }
    : sharedEmitter;
  let overallStartTime = Date.now();
  if (helper) {
    // A helper does not take the run: it joins one that is running, and it is the coordinator's
    // to end. Its time limit counts from when the run started, not from when the helper did.
    const [row] = await withTenantTransaction((tx) =>
      tx.select({ status: testPlanExecutionsTable.status, startedAt: testPlanExecutionsTable.startedAt })
        .from(testPlanExecutionsTable)
        .where(eq(testPlanExecutionsTable.id, testPlanRunId))
        .limit(1),
    );
    if (row?.status !== 'running') {
      return { skipped: true, reason: `Execution is ${row?.status ?? 'missing'}, not running.`, testPlanRunId };
    }
    overallStartTime = row.startedAt?.getTime() ?? overallStartTime;
    return joinRun();
  }

  const startLog: ExecutionLogEntry = {
    level: 'info',
    source: 'system',
    message: `Starting background test plan execution for plan ${planId}`,
    timestamp: new Date(overallStartTime).toISOString(),
    metadata: { planId, testPlanRunId, userId }
  };
  // Take the run. Only a run that is still queued can be taken, and the database lets exactly
  // one worker do it: a job BullMQ delivers twice, or a run somebody cancelled while it waited,
  // gets nothing back here and stops — instead of running the whole plan a second time over the
  // results of the first. And only while its organization is within its limit of runs at once
  // (see server/tenant-quotas.ts): past it the run stays queued and the job comes back later.
  const take = await takeExecution(testPlanRunId);
  if (take.outcome === 'over_quota') {
    resolvedLogger.info({
      message: take.reason === 'execution_quota_exceeded'
        ? 'Test plan execution deferred: monthly execution allowance exhausted'
        : 'Test plan execution deferred: its organization is at its limit of runs at once',
      testPlanRunId,
      running: take.running,
      maxConcurrentRuns: take.maxConcurrentRuns,
      reason: take.reason ?? 'concurrent_run_quota',
      periodEnd: take.periodEnd,
    });
    return { deferred: true, retryInMs: RUN_DEFERRAL_MS, testPlanRunId, reason: take.reason ?? 'concurrent_run_quota', periodEnd: take.periodEnd };
  }
  if (take.outcome !== 'taken') {
    resolvedLogger.warn({
      message: 'Test plan execution was not taken: it is no longer queued',
      testPlanRunId,
      status: take.status ?? 'missing',
    });
    return { skipped: true, reason: `Execution is ${take.status ?? 'missing'}, not queued.`, testPlanRunId };
  }
  resolvedLogger.info(startLog);
  wsEmitter.emitExecutionLog(testPlanRunId, startLog);
  return joinRun();

  async function joinRun(): Promise<any> {
  // From here on the run is this worker's: it keeps a heartbeat on it, hears a cancellation, and
  // stops it at its time limit — see server/run-watch.ts. Stopped however the run ends.
  const watch = watchRun(testPlanRunId, {
    startedAt: overallStartTime,
    onStop: (_cause, reason) => {
      const entry: ExecutionLogEntry = {
        level: 'warn',
        source: 'system',
        message: `Stopping the run: ${reason.replace(/^Not run: /, '')}`,
        timestamp: new Date().toISOString(),
      };
      resolvedLogger.warn(entry);
      wsEmitter.emitExecutionLog(testPlanRunId, entry);
    },
  });
  try {
    return await runTakenPlan();
  } finally {
    watch.stop();
  }

  async function runTakenPlan(): Promise<any> {
  const currentTestPlanRun: any = { startedAt: Math.floor(overallStartTime / 1000) };

  const baseResultsDir = path.join('./results', planId, testPlanRunId);
  try {
    await fs.ensureDir(baseResultsDir);
  } catch (dirError: any) {
    resolvedLogger.error({ message: 'Failed to create base results directory', baseResultsDir, error: dirError.message });
    // A helper that cannot write leaves the run to the others.
    if (helper) return { error: `Failed to create results directory: ${dirError.message}`, testPlanRunId };
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
  // What this run was asked to do, as it was asked. Everything below reads it and not the plan,
  // so a plan edited while the run waited does not change what the run does.
  const snapshot = await snapshotForRun(planId, executionRecord[0], jobOptions);
  if (snapshot.definitions && !reproducibilitySummary(snapshot).available)
    throw new Error('The queued execution inputs are incomplete or their fingerprints do not match.');
  const environmentId = snapshot.environmentId;

  const configuredBrowsers =
    hasConfiguredBrowsers(snapshot.browsers.requested) || hasConfiguredBrowsers(snapshot.browsers.testMachines);
  // A plan on a browser grid (shared/browser-grids.ts). A pool of agents wins if both were ever
  // set; the plan routes refuse to save both.
  const gridId = snapshot.runOn?.agentPool ? null : snapshot.runOn?.browserGridId ?? null;
  const [gridRow] = gridId
    ? await withTenantTransaction((tx) =>
        tx.select({ id: browserGrids.id, name: browserGrids.name, provider: browserGrids.provider }).from(browserGrids).where(eq(browserGrids.id, gridId)).limit(1),
      )
    : [];
  // Gone between the snapshot and now: each test says so when its browser cannot be opened.
  const grid = gridId ? { id: gridId, name: gridRow?.name ?? gridId, provider: (gridRow?.provider ?? 'playwright_server') as BrowserGridProvider } : null;
  const { browsers: browserMatrix, warnings: browserWarnings } = browsersForRun({
    executionBrowsers: snapshot.browsers.requested,
    testMachines: snapshot.browsers.testMachines,
    onGrid: !!grid,
  });
  // `undefined` means "whatever the runner would have used", which is the user's own setting
  // — exactly what every plan did before its browser configuration was honoured.
  const basePasses: Array<BrowserChoice | undefined> = configuredBrowsers ? browserMatrix : [undefined];
  // A plan set to a pool of local agents borrows its browsers from them (shared/agents.ts).
  const agentPool = snapshot.runOn?.agentPool ?? null;
  const runPasses: Array<BrowserChoice | undefined> = agentPool
    ? onAgents(basePasses, { organizationId: executionRecord[0].organizationId, pool: agentPool })
    : grid
      ? onGrid(basePasses, grid)
      : basePasses;
  if (grid) {
    browserWarnings.push(
      ...new Set(
        runPasses.flatMap((pass) =>
          pass?.grid ? gridWarnings(grid.provider, { label: pass.grid.browserName, ...pass.machine }) : [],
        ),
      ),
    );
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message: `Browsers for this run come from the ${BROWSER_GRID_LABELS[grid.provider]} grid "${grid.name}": ${runPasses.map((pass) => pass?.label).join(', ')}.`,
      timestamp: new Date().toISOString(),
      metadata: { browserGrid: grid.name, provider: grid.provider },
    });
  }
  // Its API requests go out from the same agents, so they reach what its pages reach. Nothing is
  // borrowed until the first request: a plan without API tests or preconditions never asks.
  const agentHttp = agentPool
    ? new AgentHttp({ organizationId: executionRecord[0].organizationId, pool: agentPool })
    : null;
  if (agentPool) {
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message:
        `Browsers for this run come from the local agents of pool "${agentPool}", so pages open from their network. ` +
        `Its API tests, API preconditions and OAuth token requests are sent from those agents too.`,
      timestamp: new Date().toISOString(),
      metadata: { agentPool },
    });
  }
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
  const networkMode = snapshot.evidence.network ?? 'never';
  const runEvidence: { video?: EvidenceCaptureMode; trace?: EvidenceCaptureMode; network?: EvidenceCaptureMode } | undefined =
    shouldRecord(snapshot.evidence.video) || shouldRecord(snapshot.evidence.trace) || shouldRecord(networkMode)
      ? { video: snapshot.evidence.video, trace: snapshot.evidence.trace, network: networkMode }
      : undefined;
  if (runEvidence) {
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message:
        `Recording this run: video ${runEvidence.video}, trace ${runEvidence.trace}, network ${runEvidence.network}. ` +
        `Kept files appear on each result in the report.`,
      timestamp: new Date().toISOString(),
      metadata: { ...runEvidence },
    });
  }

  const policies = runPoliciesFrom(snapshot);
  wsEmitter.emitExecutionLog(testPlanRunId, {
    level: 'info',
    source: 'system',
    message: describePolicies(policies),
    timestamp: new Date().toISOString(),
  });
  for (const setting of policies.notApplied) {
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'warn',
      source: 'system',
      message: `${setting} has no effect on this run.`,
      timestamp: new Date().toISOString(),
    });
  }
  /**
   * Set when a plan policy stops the run. Every test that has not started by then is recorded as
   * skipped with this as its reason, rather than silently absent: a report with three results
   * out of forty has to say why the other thirty-seven are not there. Tests already running when
   * it is set — other browsers, parallel slots — finish, because stopping a browser mid-step
   * leaves the application in a state nobody asked for.
   */
  let stopReason: string | null = null;
  // Set below, once it is known whether workers share this run.
  let sharedRun = false;
  const stopRun = async (reason: string) => {
    if (stopReason) return;
    stopReason = reason;
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'error',
      source: 'system',
      message: `Stopping the run: ${reason.replace(/^Not run: /, '')}`,
      timestamp: new Date().toISOString(),
    });
    // The other workers sharing it read it before each item they take.
    if (sharedRun) await recordStopReason(testPlanRunId, reason).catch(() => undefined);
  };

  const visualTesting = snapshot.visualTesting.enabled;
  const updateBaselines = snapshot.visualTesting.updateBaselines;
  if (visualTesting) {
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message: updateBaselines
        ? 'Visual testing: this run replaces the stored baselines with its own screenshots.'
        : 'Visual testing: each step is compared against its stored baseline; a first run records one.',
      timestamp: new Date().toISOString(),
    });
  }

  const secretsMap: Record<string, string> = {};
  // The organization's shared test data, as {{data.<set>.<column>}} (shared/test-data.ts).
  const dataVariables: Record<string, string> = snapshot.datasets
    ? snapshot.datasets.variables
    : await withTenantTransaction((tx) => loadDataVariables(tx));
  // The defaults underneath, the environment's secrets on top — so an environment can
  // override `baseUrl` like any other name, and a run against site B does not depend on
  // what a process env var happened to hold.
  const runVariables = (captured: Record<string, string>): Record<string, string> => ({
    ...defaultVariables(),
    ...dataVariables,
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

  const selectedTestsLinks = snapshot.selectedTests;

  wsEmitter.emitExecutionLog(testPlanRunId, {
    level: 'info',
    source: 'system',
    message: `Found ${selectedTestsLinks.length} tests to execute in this plan.`,
    timestamp: new Date().toISOString()
  });
  // Narrowed to what a change affects, or not and why (server/test-impact.ts).
  if (snapshot.selection) {
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message: snapshot.selection.reason,
      timestamp: new Date().toISOString(),
      metadata: { selection: snapshot.selection.mode, affectedTags: snapshot.selection.affectedTags },
    });
  }

  // ⚡ BOLT OPTIMIZATION: Resolve N+1 query problem by batch-fetching all required
  // UI and API test definitions in a single database roundtrip.
  // Using Map for O(1) in-memory lookups during the sequential execution loop.
  // This significantly reduces DB load and latency for plans with many tests.
  const uiTestIds = selectedTestsLinks.filter(l => l.testType === 'ui' && l.testId).map(l => l.testId as number);
  const apiTestIds = selectedTestsLinks.filter(l => l.testType === 'api' && l.apiTestId).map(l => l.apiTestId as number);

  const uiTestsMap = new Map<number, Test>();
  if (snapshot.definitions) {
    snapshot.definitions.ui.forEach(row => uiTestsMap.set(row.id, structuredClone(row.definition)));
  } else if (uiTestIds.length > 0) {
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
  const testVersionsInRun = snapshot.definitions
    ? new Map(snapshot.definitions.ui.flatMap(row => row.version === null ? [] : [[row.id, row.version] as [number, number]]))
    : uiTestIds.length > 0
    ? await withTenantTransaction((tx) => currentVersionsOf(tx, uiTestIds))
    : new Map<number, number>();

  // What was published, not what is being edited (migration 0032). A published test runs its
  // published version, laid over the working copy loaded above, and its results name that
  // version. Where the organization requires review, a test never published does not run at all:
  // running an unreviewed working copy is what the policy exists to prevent.
  const unpublishedUnderPolicy = new Map<string, string>();
  if (snapshot.definitions) {
    const required = await withTenantTransaction(tx => reviewRequired(tx, executionRecord[0].organizationId));
    if (required) for (const row of [...snapshot.definitions.ui.map(row => ({ ...row, kind: 'ui' })), ...snapshot.definitions.api.map(row => ({ ...row, kind: 'api' }))]) {
      if (row.source !== 'published') unpublishedUnderPolicy.set(`${row.kind}:${row.id}`, 'Not published: this organization runs reviewed, published versions only.');
    }
  } else if (uiTestIds.length > 0) {
    const { published, required } = await withTenantTransaction(async (tx) => ({
      published: await publishedContentOf(tx, uiTestIds),
      required: await reviewRequired(tx, executionRecord[0].organizationId),
    }));
    for (const [testId, content] of published) {
      const workingCopy = uiTestsMap.get(testId);
      if (!workingCopy) continue;
      uiTestsMap.set(testId, {
        ...workingCopy,
        name: content.name,
        url: content.url,
        sequence: content.sequence,
        elements: content.elements,
        preconditions: content.preconditions,
        cleanups: content.cleanups,
        dataset: content.dataset,
        bdd: content.bdd as import('@shared/bdd').BddTest | null,
      } as Test);
      testVersionsInRun.set(testId, content.version);
    }
    if (required) {
      for (const testId of uiTestIds) {
        if (!published.has(testId)) {
          unpublishedUnderPolicy.set(`ui:${testId}`, 'Not published: this organization runs reviewed, published versions only.');
        }
      }
    }
  }

  // New runs carry data from enqueue, including null/empty datasets and unavailable-set errors.
  // Historical runs without this field retain their original worker-time resolution.
  const datasetErrors = new Map<number, string>();
  if (snapshot.datasets) {
    const frozen = new Map(snapshot.datasets.tests.map(entry => [entry.testId, entry]));
    for (const [testId, test] of uiTestsMap) {
      const entry = frozen.get(testId);
      // Overlay even errored entries: BDD lane/row counts must not use repaired live data.
      uiTestsMap.set(testId, { ...test, dataset: entry ? structuredClone(entry.dataset) : null } as Test);
      if (!entry) datasetErrors.set(testId, 'The queued run has no dataset snapshot for this test.');
      else if (entry.error) datasetErrors.set(testId, entry.error);
    }
  } else if (uiTestsMap.size > 0) {
    await withTenantTransaction(async (tx) => {
      for (const [testId, test] of Array.from(uiTestsMap)) {
        try {
          uiTestsMap.set(testId, await expandSharedDataset(tx, test));
        } catch (error) {
          if (!(error instanceof SharedDataError)) throw error;
          datasetErrors.set(testId, error.message);
        }
      }
    });
  }

  const apiTestsMap = new Map<number, ApiTest>();
  if (snapshot.definitions) {
    snapshot.definitions.api.forEach(row => apiTestsMap.set(row.id, structuredClone(row.definition)));
  } else if (apiTestIds.length > 0) {
    const apiTests = await withTenantTransaction((tx) =>
      tx.select().from(apiTestsTable).where(inArray(apiTestsTable.id, apiTestIds)),
    );
    apiTests.forEach(t => apiTestsMap.set(t.id, t as ApiTest));
  }

  // Mobile app tests (migration 0053), each with the grid it names: a plan's browsers and its
  // "run on" do not apply to a device, so the test says where it runs.
  const mobileTestIds = selectedTestsLinks.filter(l => l.testType === 'mobile' && l.mobileTestId).map(l => l.mobileTestId as number);
  const mobileTestsMap = new Map<number, { test: MobileTest; grid: BrowserGrid | null }>();
  if (!snapshot.mobileDefinitions && mobileTestIds.length > 0) {
    const rows = await withTenantTransaction((tx) =>
      tx
        .select({ test: mobileTestsTable, grid: browserGrids })
        .from(mobileTestsTable)
        .leftJoin(browserGrids, eq(browserGrids.id, mobileTestsTable.gridId))
        .where(inArray(mobileTestsTable.id, mobileTestIds)),
    );
    rows.forEach((row) => mobileTestsMap.set(row.test.id, { test: row.test as MobileTest, grid: (row.grid as BrowserGrid | null) ?? null }));
  }

  // Each protocol has its own id space; API 4 and mobile 4 are different tests.
  const apiVersionsInRun = new Map<number, number>(snapshot.definitions?.api.flatMap(row => row.version === null ? [] : [[row.id, row.version] as [number, number]]) ?? []);
  const mobileVersionsInRun = new Map<number, number>();
  await withTenantTransaction(async (tx) => {
    const required = await reviewRequired(tx, executionRecord[0].organizationId);
    for (const [kind, ids, versions] of [
      ['api', apiTestIds, apiVersionsInRun],
      ['mobile', mobileTestIds, mobileVersionsInRun],
    ] as const) {
      if ((kind === 'api' && snapshot.definitions) || (kind === 'mobile' && snapshot.mobileDefinitions)) continue;
      if (!ids.length) continue;
      const current = await currentContentOf(tx, ids, kind);
      const published = await publishedContentOf(tx, ids, kind);
      // Pin a saved working definition and its version together, then prefer the publication.
      for (const [id, content] of [...current, ...published]) {
        if (kind === 'api') {
          const working = apiTestsMap.get(id);
          if (working) apiTestsMap.set(id, { ...working, ...content.snapshot } as ApiTest);
        } else {
          const working = mobileTestsMap.get(id);
          if (working) {
            const test = { ...working.test, ...content.snapshot } as MobileTest;
            // The published version can name a different grid from the working copy.
            const [grid] = test.gridId ? await tx.select().from(browserGrids).where(eq(browserGrids.id, test.gridId)).limit(1) : [];
            mobileTestsMap.set(id, { test, grid: grid ?? null });
          }
        }
        versions.set(id, content.version);
      }
      if (required) for (const id of ids) if (!published.has(id))
        unpublishedUnderPolicy.set(`${kind}:${id}`, 'Not published: this organization runs reviewed, published versions only.');
    }
  });

  // Tests in quarantine run like the rest; their failures are recorded and do not count against
  const frozenMobile = snapshot.mobileDefinitions ?? await withTenantTransaction(tx=>freezeMobilePlanDefinitions(tx,mobileTestIds));
  await withTenantTransaction(async tx=>{
    const required = await reviewRequired(tx, executionRecord[0].organizationId);
    for(const frozen of frozenMobile){
      const key = `mobile:${frozen.id}`;
      if (required && (!frozen.version || frozen.definition.publishedVersion !== frozen.version)) {
        unpublishedUnderPolicy.set(key, 'Not published: this organization runs reviewed, published versions only.');
      } else {
        unpublishedUnderPolicy.delete(key);
      }
      const [grid]=frozen.definition.gridId?await tx.select().from(browserGrids).where(eq(browserGrids.id,frozen.definition.gridId)):[];
      mobileTestsMap.set(frozen.id,{test:frozen.definition,grid:grid??null});
      if(frozen.version)mobileVersionsInRun.set(frozen.id,frozen.version);
    }
  });
  if (!snapshot.mobileDefinitions) {
    snapshot.mobileDefinitions=frozenMobile;
    await withTenantTransaction(async tx=>{await tx.update(testPlanExecutionsTable).set({configurationSnapshot:snapshot}).where(eq(testPlanExecutionsTable.id,testPlanRunId));});
  }
  // the run (server/test-quarantine.ts). Read as the run starts, like the published versions above.
  const quarantined = await withTenantTransaction((tx) =>
    openQuarantinesOf(tx, [
      ...uiTestIds.map((id) => ({ type: 'ui' as const, id })),
      ...apiTestIds.map((id) => ({ type: 'api' as const, id })),
      ...mobileTestIds.map((id) => ({ type: 'mobile' as const, id })),
    ]),
  );
  if (quarantined.size > 0) {
    wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message:
        `${quarantined.size} test(s) in this run are in quarantine: they run and their results are recorded, ` +
        `but a failure of theirs does not fail the run.`,
      timestamp: new Date().toISOString(),
      metadata: { quarantined: [...quarantined.keys()] },
    });
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
  const onlyBdd = selectedTestsLinks.length > 0 && selectedTestsLinks.every(link => link.testType === 'ui' && !!link.testId && uiTestsMap.get(link.testId)?.bdd?.mode === 'cucumber');
  if (onlyBdd) usablePasses.push(undefined);
  // A helper runs the browsers the coordinator resolved, as its work items say.
  for (const pass of helper || onlyBdd ? [] : runPasses) {
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
      // A branded build (Google Chrome, Microsoft Edge) is a channel of an engine, and a runner
      // installed from the Playwright image has the engine but not the brand. "chrome" is what the
      // plan wizard offers first, so failing the pass left most plans with no results at all and
      // a run_incomplete nobody could explain. The engine underneath runs the same tests; the
      // report says that is what happened.
      if (pass.channel) {
        const onEngine: BrowserChoice = { ...pass, channel: undefined };
        let started = false;
        for (const headless of pass.headless === false ? [false, true] : [true]) {
          try {
            const probe = await launchBrowser({ ...onEngine, headless });
            await probe.close();
            usablePasses.push({ ...onEngine, headless });
            started = true;
            break;
          } catch {
            // Try headless next, then report the original failure.
          }
        }
        if (started) {
          const fallback: ExecutionLogEntry = {
            level: 'warn',
            source: 'system',
            message:
              `${pass.label} (channel "${pass.channel}") is not installed on this runner; ` +
              `its tests ran on Playwright's bundled ${pass.engine} instead.`,
            timestamp: new Date().toISOString(),
            metadata: { browser: pass.label, channel: pass.channel, engine: pass.engine },
          };
          resolvedLogger.warn(fallback);
          wsEmitter.emitExecutionLog(testPlanRunId, fallback);
          continue;
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
  type RunUnit = { browserChoice?: BrowserChoice; locale?: string; link: (typeof selectedTestsLinks)[number]; bddRowIndex?: number; mobileTarget?:MobilePlanTarget };

  /**
   * One test, on one browser.
   *
   * Extracted from the loop it used to be so that several can be in flight at once. It takes
   * its pass's captured variables rather than reaching for a shared object: two browsers
   * running the same flow each create their own records, and one pass reading the id the
   * other captured is how a parallel run quietly tests the wrong thing.
   */
  const runUnit = async (
    { browserChoice, locale, link, bddRowIndex, mobileTarget }: RunUnit,
    captured: Record<string, string>,
    // Where its entry of the legacy results list goes: a shared run keeps them with each work item.
    sink: IndividualTestRunResult[] = legacyIndividualTestResultsForJsonBlob,
  ): Promise<void> => {
    let testObjectDefinition: Test | ApiTest | undefined;
    const testTypeForRun: 'ui' | 'api' | 'mobile' | undefined = link.testType as ('ui' | 'api' | 'mobile');
    const mobileBase = link.testType === 'mobile' && link.mobileTestId ? mobileTestsMap.get(link.mobileTestId) : undefined;
    const mobile = mobileBase ? {...mobileBase,test:{...mobileBase.test,...mobileTarget}} : undefined;

    if (link.testId && link.testType === 'ui') {
      testObjectDefinition = uiTestsMap.get(link.testId);
      if (testObjectDefinition && bddRowIndex !== undefined) {
        const dataset=testObjectDefinition.dataset;
        if (testObjectDefinition.bdd?.mode !== 'cucumber' || !Array.isArray(dataset) || !Number.isInteger(bddRowIndex) || bddRowIndex < 0 || bddRowIndex >= dataset.length) throw new Error('The selected BDD dataset row is unavailable.');
        testObjectDefinition={...testObjectDefinition,dataset:[dataset[bddRowIndex]],name:`${testObjectDefinition.name} — Row ${bddRowIndex+1}`};
      }
    } else if (link.apiTestId && link.testType === 'api') {
      testObjectDefinition = apiTestsMap.get(link.apiTestId);
    }

    const singleTestStartTime = Date.now();
    let reportStatus: InsertReportTestCaseResult['status'] = 'Pending'; // Default
    let failureReason: string | undefined = undefined;
    let screenshotFinalPath: string | undefined = undefined;
    let videoFinalPath: string | undefined = undefined;
    let traceFinalPath: string | undefined = undefined;
    let harFinalPath: string | undefined = undefined;
    let networkSummary: NetworkSummary | undefined = undefined;
    let stepsOrLogData: string | undefined = undefined;
    let attempts = 1;

    const testName = testObjectDefinition?.name || mobile?.test.name || `Unknown Test (ID: ${link.testId || link.apiTestId || link.mobileTestId})`;
    const onBrowser =
      (browserChoice ? ` on ${describeBrowser(browserChoice)}` : '') + (locale ? ` in ${locale}` : '');
    // A plan policy, a cancellation or the time limit: either way this test does not start. Nor
    // does a test with no published version where the organization requires review.
    const referencedId = link.testType === 'ui' ? link.testId : link.testType === 'api' ? link.apiTestId : link.mobileTestId;
    const notPublished = referencedId ? unpublishedUnderPolicy.get(`${link.testType}:${referencedId}`) : undefined;
    const inQuarantine =
      link.testType === 'ui'
        ? !!link.testId && quarantined.has(refKey({ type: 'ui', id: link.testId }))
        : link.testType === 'mobile'
          ? !!link.mobileTestId && quarantined.has(refKey({ type: 'mobile', id: link.mobileTestId }))
          : !!link.apiTestId && quarantined.has(refKey({ type: 'api', id: link.apiTestId }));
    const haltedBy = stopReason ?? watch.stopReason ?? notPublished;
    if (haltedBy) {
      reportStatus = 'Skipped';
      failureReason = haltedBy;
    } else if (link.testType === 'ui' && link.testId && datasetErrors.has(link.testId)) {
      reportStatus = 'Error';
      failureReason = datasetErrors.get(link.testId);
    }
    if (!haltedBy) wsEmitter.emitExecutionLog(testPlanRunId, {
      level: 'info',
      source: 'system',
      message: `Starting test: ${testName} (${testTypeForRun})${onBrowser}`,
      timestamp: new Date(singleTestStartTime).toISOString(),
      metadata: { testId: link.testId || link.apiTestId || link.mobileTestId, testType: testTypeForRun, browser: browserChoice?.label, locale }
    });

    if (reportStatus === 'Skipped' || reportStatus === 'Error') {
      // Stopped before it started; recorded below with the reason.
    } else if (testTypeForRun === 'ui' && testObjectDefinition && (testObjectDefinition as Test).bdd?.mode !== 'cucumber' && isManualSequence((testObjectDefinition as Test).sequence)) {
      // A manual test: no browser. It waits in the report for somebody's verdict, with the
      // steps of the version that ran, so a later edit does not change what was asked.
      reportStatus = 'Pending';
      const log: ManualResultLog = { manual: true, steps: manualStepsOf((testObjectDefinition as Test).sequence) };
      stepsOrLogData = JSON.stringify(log);
      wsEmitter.emitExecutionLog(testPlanRunId, {
        level: 'info',
        source: 'system',
        message: `Manual test: ${testName} is waiting for its result in the run report.`,
        timestamp: new Date().toISOString(),
        metadata: { testId: link.testId, manual: true },
      });
    } else if (testTypeForRun === 'mobile') {
      // A mobile app test: once per run, on a device of the grid it names (server/mobile-runner.ts).
      if (!mobile) {
        reportStatus = 'Error';
        failureReason = 'Mobile test not found: it was deleted after the run was planned.';
      } else if ('preparationError' in mobile.test && mobile.test.preparationError) {
        reportStatus='Error';failureReason=String(mobile.test.preparationError);
      } else if (!mobile.grid) {
        reportStatus = 'Error';
        failureReason = `${mobile.test.name} names no grid to run on. Choose a BrowserStack or LambdaTest grid in the test's settings.`;
      } else {
        const grid = toGridConfig(mobile.grid);
        const attemptOnce = () =>
          performMobileTest(mobile.test, grid, runVariables(captured), `WebFlowMaster · ${planId} · ${testPlanRunId.slice(0, 8)}`);
        let outcome: MobileOutcome = await attemptOnce();
        while (outcome.status !== 'passed' && attempts <= policies.testReruns && !watch.stopReason) {
          attempts += 1;
          wsEmitter.emitExecutionLog(testPlanRunId, {
            level: 'warn',
            source: 'system',
            message: `${testName} ${outcome.status}; running it again (attempt ${attempts} of ${policies.testReruns + 1}).`,
            timestamp: new Date().toISOString(),
            metadata: { attempt: attempts },
          });
          outcome = await attemptOnce();
        }
        reportStatus = outcome.status === 'passed' ? 'Passed' : outcome.status === 'failed' ? 'Failed' : 'Error';
        failureReason = outcome.error ?? undefined;
        const log: MobileResultLog = {
          mobile: true,
          device: mobileDeviceLabel(mobile.test),
          platform: mobile.test.platform,
          sessionUrl: outcome.sessionUrl,
          steps: outcome.steps,
        };
        stepsOrLogData = JSON.stringify(log);
        if (outcome.screenshot) {
          const dir = path.join('./results', planId, testPlanRunId, `mobile_${mobile.test.id}`, mobile.test.deviceMatrix?.length ? mobileTarget?.key ?? 'device-0' : '');
          try {
            await fs.ensureDir(dir);
            const file = path.join(dir, 'final.png');
            await fs.writeFile(file, Buffer.from(outcome.screenshot, 'base64'));
            await publishArtifacts(dir, testPlanRunId);
            screenshotFinalPath = file.replace(/^\.?\/?results/, '/results').replace(/\\/g, '/');
          } catch (error: any) {
            resolvedLogger.warn({ message: 'Could not store a mobile test screenshot', error: error?.message ?? String(error) });
          }
        }
        const reasonToStop = inQuarantine ? null : stopReasonAfter(
          { testName, status: outcome.status, cause: outcome.steps.some((step) => step.status === 'failed') ? 'step' : 'other' },
          policies,
        );
        if (reasonToStop) await stopRun(reasonToStop);
        wsEmitter.emitExecutionLog(testPlanRunId, {
          level: reportStatus === 'Passed' ? 'info' : 'error',
          source: 'system',
          message: `Finished test: ${testName} on ${log.device}. Status: ${reportStatus} (${Date.now() - singleTestStartTime}ms)`,
          timestamp: new Date().toISOString(),
          metadata: { status: reportStatus, device: log.device },
        });
      }
    } else if (testObjectDefinition && testTypeForRun) {
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

      const attemptOnce = () =>
        runTest(
          testObjectDefinition!,
          userId,
          planId,
          testPlanRunId,
          testTypeForRun,
          runVariables(captured),
          planEnvironment(),
          {
            browser: browserChoice,
            locale,
            visual:
              visualTesting && testTypeForRun === 'ui'
                ? {
                    organizationId: executionRecord[0].organizationId,
                    updateBaselines,
                  }
                : undefined,
            evidence: runEvidence,
            runtime: policies.step,
            onPreconditionFailure: policies.onPreconditionFailure,
            signal: watch.signal,
            http: agentHttp?.fetch,
          },
        );
      let resultFromRunTest = await attemptOnce();
      // "Re-Run On Failure": a test that failed or errored is run again, up to the plan's
      // number, and the last attempt is its result. A skip is a decision, not a failure, and is
      // not re-run. The attempts are recorded on the result, so a test that needed two to pass
      // is visibly flaky rather than indistinguishable from one that passed first time.
      while (
        (resultFromRunTest.status === 'failed' || resultFromRunTest.status === 'error') &&
        attempts <= policies.testReruns &&
        // A test cut short because the run is stopping is not a failure to try again.
        !watch.stopReason
      ) {
        attempts += 1;
        wsEmitter.emitExecutionLog(testPlanRunId, {
          level: 'warn',
          source: 'system',
          message: `${testName}${onBrowser} ${resultFromRunTest.status}; running it again (attempt ${attempts} of ${policies.testReruns + 1}).`,
          timestamp: new Date().toISOString(),
          metadata: { attempt: attempts },
        });
        resultFromRunTest = await attemptOnce();
      }
      sink.push(resultFromRunTest.protocol
        ? { ...resultFromRunTest, extracted: resultFromRunTest.protocol.extracted }
        : resultFromRunTest); // Live captures below remain available to subsequent requests.

      // Once its last attempt is over, the test's evidence goes where the report is served
      // from. Per test rather than at the end, so a report opened while the run goes on shows
      // the pictures of what has finished.
      if (resultFromRunTest.artifactDir) await publishArtifacts(resultFromRunTest.artifactDir, testPlanRunId);

      // A quarantined test's failure does not stop the plan: stopping on it would be failing
      // the run by another route.
      const reasonToStop = inQuarantine ? null : stopReasonAfter(
        {
          testName,
          status: resultFromRunTest.status,
          cause: resultFromRunTest.blockedByPrecondition
            ? 'precondition'
            // The cleanup's line is not one of the test's steps: it never decides why a test stopped.
            : resultFromRunTest.steps?.some((step) => step.status === 'failed' && step.type !== 'cleanup')
              ? 'step'
              : 'other',
        },
        policies,
      );
      if (reasonToStop) await stopRun(reasonToStop);

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
      else if (resultFromRunTest.status === 'skipped') reportStatus = 'Skipped';

      failureReason = resultFromRunTest.error || failedStepReason(resultFromRunTest.status, resultFromRunTest.steps);
      screenshotFinalPath = resultFromRunTest.screenshotPath; // This is a file path
      videoFinalPath = resultFromRunTest.videoPath;
      traceFinalPath = resultFromRunTest.tracePath;
      harFinalPath = resultFromRunTest.harPath;
      networkSummary = resultFromRunTest.network;
      stepsOrLogData = resultFromRunTest.bdd
        ? JSON.stringify({bdd:resultFromRunTest.bdd,steps:resultFromRunTest.steps ?? []})
        : resultFromRunTest.steps
        ? JSON.stringify(resultFromRunTest.steps) // For UI tests
        : resultFromRunTest.performance || resultFromRunTest.protocol
          ? JSON.stringify({ api: true, ...(resultFromRunTest.performance ? { performance: resultFromRunTest.performance } : {}), ...(resultFromRunTest.protocol ? { protocol: resultFromRunTest.protocol } : {}) })
          : undefined;

      const singleTestDurationMs = Date.now() - singleTestStartTime;
      wsEmitter.emitExecutionLog(testPlanRunId, {
        level: reportStatus === 'Passed' ? 'info' : 'error',
        source: 'system',
        message: `Finished test: ${testName}. Status: ${reportStatus} (${singleTestDurationMs}ms)`,
        timestamp: new Date().toISOString(),
        metadata: { durationMs: singleTestDurationMs, status: reportStatus }
      });
      // A failed test whose page saw server errors: said next to the failure, because it is
      // the likeliest reason and the screenshot cannot show it.
      const networkNote = reportStatus !== 'Passed' && networkSummary ? describeNetworkFailures(networkSummary) : null;
      if (networkNote) {
        wsEmitter.emitExecutionLog(testPlanRunId, {
          level: 'warn',
          source: 'system',
          message: `${testName}${onBrowser}: ${networkNote}`,
          timestamp: new Date().toISOString(),
          metadata: { failedRequests: networkSummary!.failed },
        });
      }

      // Convert screenshotPath to a URL if needed, e.g., /results/planId/runId/testId/screenshot.png
      // Stored the way the report reads them: the artifacts route turns one of these back
      // into something a browser can open (see server/routes/artifacts.routes.ts).
      const asResultsUrl = (filePath?: string) =>
        filePath ? filePath.replace(/^\.?\/?results/, '/results').replace(/\\/g, '/') : undefined;
      screenshotFinalPath = asResultsUrl(screenshotFinalPath);
      videoFinalPath = asResultsUrl(videoFinalPath);
      traceFinalPath = asResultsUrl(traceFinalPath);
      harFinalPath = asResultsUrl(harFinalPath);


    } else {
      resolvedLogger.warn({ message: `Test object not found or type mismatch for link`, testType: link.testType, testId: link.testId ?? link.apiTestId });
      reportStatus = 'Error';
      failureReason = 'Test definition not found or type mismatch during plan execution.';
      sink.push({
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
      mobileTestId: link.testType === 'mobile' ? link.mobileTestId ?? null : null,
      testType: link.testType as 'ui' | 'api' | 'mobile',
      testName,
      // Null when the plan named no browser, which is every run made before the matrix
      // existed: the report should not claim to know something the run never decided.
      // With a language, the language too: "chromium · it-IT" (shared/locales.ts).
      // A mobile test names the device it ran on instead.
      browser: mobile ? mobileDeviceLabel(mobile.test) : passLabel(browserChoice?.label, locale),
      // The version actually executed, including published API/mobile content.
      testVersion: referencedId ? (link.testType === 'ui' ? testVersionsInRun : link.testType === 'api' ? apiVersionsInRun : mobileVersionsInRun).get(referencedId) ?? null : null,
      status: reportStatus,
      attempts,
      quarantined: inQuarantine,
      reasonForFailure: failureReason,
      screenshotUrl: screenshotFinalPath,
      videoUrl: videoFinalPath ?? null,
      traceUrl: traceFinalPath ?? null,
      harUrl: harFinalPath ?? null,
      networkSummary: networkSummary ?? null,
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
      await withTenantTransaction(async tx => {
        // A frozen test remains executable after deletion. Keep its identity in provenance,
        // but only link the result to a live row. Locks protect this check from concurrent deletes.
        if (snapshot.definitions && newReportEntry.uiTestId) {
          const [live] = await tx.select({ id: testsTable.id }).from(testsTable).where(eq(testsTable.id, newReportEntry.uiTestId)).for('key share');
          if (!live) newReportEntry.uiTestId = null;
        }
        if (snapshot.definitions && newReportEntry.apiTestId) {
          const [live] = await tx.select({ id: apiTestsTable.id }).from(apiTestsTable).where(eq(apiTestsTable.id, newReportEntry.apiTestId)).for('key share');
          if (!live) newReportEntry.apiTestId = null;
        }
        if (snapshot.mobileDefinitions && newReportEntry.mobileTestId) {
          const [live] = await tx.select({ id: mobileTestsTable.id }).from(mobileTestsTable).where(eq(mobileTestsTable.id, newReportEntry.mobileTestId)).for('key share');
          if (!live) newReportEntry.mobileTestId = null;
        }
        await tx.insert(reportTestCaseResultsTable).values(newReportEntry);
      });
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
  // And one per language on each browser, when the plan names languages: each is a run of the
  // plan of its own, and starts with {{locale}} among its variables so UI and API tests can
  // both read it.
  const runLocales: Array<string | undefined> = snapshot.locales && snapshot.locales.length > 0 ? snapshot.locales : [undefined];
  // A manual test is done once per run by a person, not once per browser and language: only the
  // first lane carries it, and its result names no browser.
  // So is a mobile app test: it runs on its own device, not in the plan's browsers.
  const isManualLink = (link: (typeof selectedTestsLinks)[number]) =>
    link.testType === 'mobile' ||
    (link.testType === 'ui' && !!link.testId && (uiTestsMap.get(link.testId)?.bdd?.mode === 'cucumber' || isManualSequence(uiTestsMap.get(link.testId)?.sequence)));
  const bddLinks=selectedTestsLinks.filter(link => link.testType === 'ui' && !!link.testId && uiTestsMap.get(link.testId)?.bdd?.mode === 'cucumber');
  const independentLinks = selectedTestsLinks.filter(link => link.testType === 'mobile' || bddLinks.includes(link));
  const lanePasses=usablePasses.length ? usablePasses : independentLinks.length ? [undefined] : [];
  const lanes = lanePasses.flatMap((browserChoice, browserIndex) =>
    runLocales.map((locale, localeIndex) => {
      const first = browserIndex === 0 && localeIndex === 0;
      return {
        browserChoice,
        units: (usablePasses.length ? selectedTestsLinks : independentLinks)
          .filter((link) => first || !isManualLink(link))
          .flatMap((link):RunUnit[] => {
            if(link.testType==='mobile'&&link.mobileTestId){
              const definition=mobileTestsMap.get(link.mobileTestId)?.test;
              return definition?mobilePlanTargets(definition).map(mobileTarget=>({link,mobileTarget})):[{link}];
            }
            const test=link.testType === 'ui' && link.testId ? uiTestsMap.get(link.testId) : undefined;
            if (test?.bdd?.mode === 'cucumber' && Array.isArray(test.dataset) && test.dataset.length) {
              return test.dataset.map((_row,bddRowIndex) => ({link,bddRowIndex}));
            }
            return [isManualLink(link) ? {link} : {browserChoice,locale,link}];
          }),
        captured: (locale ? { [LOCALE_VARIABLE]: locale } : {}) as Record<string, string>,
      };
    }),
  );

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

  const parallelism = effectiveConcurrency(snapshot.maxParallelTests);
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
  const recordSettled = (settled: PromiseSettledResult<void>[], into: string[] = unitFailures) => {
    for (const outcome of settled) {
      if (outcome.status !== 'rejected') continue;
      const message = `A test in this run could not be executed: ${
        (outcome.reason as any)?.message ?? String(outcome.reason)
      }`;
      into.push(message);
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

  const shards = shardCount(snapshot.shards);
  sharedRun = !!helper || shards > 1;
  quiet = false;

  /**
   * Shares the run's work with other workers (server/run-shards.ts): the coordinator writes it
   * down and asks for helpers; then everyone, the coordinator included, takes items until none
   * are left. The coordinator also waits for the items others hold, and takes back any whose
   * worker stopped answering.
   */
  const runShared = async () => {
    const worker = workerName();
    if (!helper) {
      const spec = (unit: RunUnit) => ({ link: selectedTestsLinks.indexOf(unit.link), browserChoice: unit.browserChoice, locale: unit.locale,bddRowIndex:unit.bddRowIndex,mobileTarget:unit.mobileTarget });
      const items: Array<{ key: string; unit: WorkUnit }> = laneIsChained
        ? lanes.map((lane, i) => ({ key: `lane-${i}`, unit: { units: lane.units.map(spec), captured: lane.captured } }))
        : lanes.flatMap((lane, i) => lane.units.map((unit, j) => ({ key: `${i}-${j}`, unit: { units: [spec(unit)], captured: lane.captured } })));
      await writeWorkItems(testPlanRunId, executionRecord[0].organizationId, items);
      const dispatch = shardDispatcher();
      const helpers = Math.min(shards - 1, Math.max(0, items.length - 1));
      let asked = 0;
      for (let shard = 1; dispatch && shard <= helpers; shard++) {
        await dispatch({ executionId: testPlanRunId, planId, userId, shard, updateBaselines })
          .then(() => asked++)
          .catch((error: any) => resolvedLogger.warn({ message: 'Could not queue a helper for a shared run', testPlanRunId, shard, error: error?.message }));
      }
      wsEmitter.emitExecutionLog(testPlanRunId, {
        level: asked > 0 || helpers === 0 ? 'info' : 'warn',
        source: 'system',
        message: asked > 0
          ? `Sharing this run with up to ${asked} more worker(s): ${items.length} piece(s) of work, taken one at a time by whichever worker is free.`
          : helpers === 0
            ? 'This run has one piece of work; it runs on this worker.'
            : `This plan asks for ${shards} workers, but no other could be asked: this worker runs every test.`,
        timestamp: new Date().toISOString(),
        metadata: { shards, helpers: asked, items: items.length },
      });
    }
    const beat = setInterval(() => heartbeatWorkItems(testPlanRunId, worker).catch(() => undefined), WORK_ITEM_HEARTBEAT_MS);
    try {
      const takeItems = async () => {
        for (;;) {
          if (watch.cause === 'lost') return;
          const item = await claimWorkItem(testPlanRunId, worker);
          if (!item) {
            // A helper is done when nothing is left to take; the coordinator, when nothing is left at all.
            if (helper || (await openWorkItems(testPlanRunId)) === 0) return;
            await new Promise((resolve) => setTimeout(resolve, WORK_POLL_MS));
            continue;
          }
          if (!stopReason) stopReason = await sharedStopReason(testPlanRunId);
          const legacy: IndividualTestRunResult[] = [];
          const failures: string[] = [];
          const captured = { ...item.unit.captured };
          for (const spec of item.unit.units) {
            const link = selectedTestsLinks[spec.link];
            if (!link) continue;
            try {
              await runUnit({ browserChoice: spec.browserChoice, locale: spec.locale, link,bddRowIndex:spec.bddRowIndex,mobileTarget:spec.mobileTarget }, captured, legacy);
            } catch (error: any) {
              recordSettled([{ status: 'rejected', reason: error }], failures);
            }
          }
          await finishWorkItem(testPlanRunId, item.key, worker, { legacy, failures });
        }
      };
      recordSettled(await runWithConcurrency(parallelism, Array.from({ length: parallelism }, () => takeItems)));
    } finally {
      clearInterval(beat);
    }
  };

  try {
    if (sharedRun) {
      await runShared();
    } else if (parallelism <= 1) {
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
  } finally {
    // The browser the API requests went through goes back to the agent.
    await agentHttp?.close();
  }

  // Whatever is left in the run's directory — a test that ended before it returned its own, a
  // file written outside any test — is published with the rest.
  await publishArtifacts(baseResultsDir, testPlanRunId);

  // A helper's share is done; ending the run is the coordinator's.
  if (helper) return { shard: helper.shard, testPlanRunId };
  if (sharedRun) {
    const shared = await workItemResults(testPlanRunId);
    legacyIndividualTestResultsForJsonBlob.push(...(shared.legacy as IndividualTestRunResult[]));
    unitFailures.push(...shared.failures);
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
  const failures = failuresOf(finalDetailedResults);
  // Consider 'Error' status as failures or a separate category if needed for overall status.
  // For overall status, let's say if any 'Failed' or 'Error', the whole run is 'failed'.
  // If any 'Skipped' and no 'Failed'/'Error', maybe 'partial' or 'completed_with_skipped'.
  // If all 'Passed', then 'completed'.

  // Every branch below assigns one of the three; 'error' is what a state nobody anticipated
  // should end as, rather than a run left looking unfinished.
  let finalOverallStatus: 'completed' | 'failed' | 'error' = 'error';
  if (calculatedTotalTests === 0 && selectedTestsLinks.length > 0) {
    finalOverallStatus = 'error'; // No results recorded but tests were expected
  } else if (failures.holding > 0) {
    // Failures of quarantined tests are counted but do not decide the run.
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
    const aggregates = {
      results: JSON.stringify(legacyIndividualTestResultsForJsonBlob), // Keep the old JSON blob for now
      totalTests: calculatedTotalTests,
      passedTests: calculatedPassedTests,
      failedTests: calculatedFailedTests,
      skippedTests: calculatedSkippedTests,
      quarantinedFailures: failures.quarantined,
      executionDurationMs: overallExecutionDurationMs,
    };

    // How the run ends. A stop the watch saw decides it: a cancelled run is cancelled and a run
    // past its limit timed out, whatever the tests that did run said. Otherwise the verdict —
    // which only a run still running can be given, so an ending that arrived meanwhile stands.
    let ending: 'verdict' | 'cancelled' | 'timed_out' =
      watch.cause === 'cancelled' ? 'cancelled' : watch.cause === 'timed_out' ? 'timed_out' : 'verdict';
    let finished: TestPlanExecution | null = null;
    if (ending === 'timed_out') {
      finished = await transitionExecution(testPlanRunId, 'timed_out', {
        ...aggregates,
        failureCode: 'run_timed_out',
        failureMessage: watch.stopReason?.replace(/^Not run: /, '') ?? 'The run went past its time limit.',
      });
    } else if (ending === 'cancelled') {
      finished = await transitionExecution(testPlanRunId, 'cancelled', aggregates);
    } else {
      finished = await transitionExecution(testPlanRunId, finalOverallStatus, {
        ...aggregates,
        ...(finalOverallStatus === 'error'
          ? {
              failureCode: 'run_incomplete',
              // The reason itself when there is one: "Not every browser produced a result" sends
              // somebody looking for which, when the run already knows.
              failureMessage: ['Not every browser or test in the plan produced a result.', ...browserStartupFailures, ...unitFailures]
                .join(' ')
                .slice(0, 2000),
            }
          : {}),
      });
    }
    if (!finished && ending !== 'cancelled') {
      // A cancellation asked for after the watch last looked: the run is `cancelling`, and it is
      // this worker that finishes stopping it.
      finished = await transitionExecution(testPlanRunId, 'cancelled', aggregates);
      if (finished) ending = 'cancelled';
    }
    const finalUpdateResult = finished ? [finished] : [];

    if (finalUpdateResult.length > 0 && ending === 'cancelled') {
      // Nobody is told and nothing is filed about a run somebody chose to stop.
      resolvedLogger.info({ message: 'Test plan execution cancelled', planId, testPlanRunId, testsRun: calculatedTotalTests });
      return finalUpdateResult[0];
    }

    if (finalUpdateResult.length > 0 && ending === 'timed_out') {
      // Announced — a nightly run that never finished is exactly what somebody needs to hear
      // about — but not filed: which tests would have failed is not known.
      await notifyRunFinished({
        plan: { notificationSettings: snapshot.notificationSettings },
        execution: executionRecord[0],
        summary: {
          planId,
          planName: snapshot.plan.name || planId,
          executionId: testPlanRunId,
          status: 'timed_out',
          totalTests: calculatedTotalTests,
          passedTests: calculatedPassedTests,
          failedTests: calculatedFailedTests,
          skippedTests: calculatedSkippedTests,
          quarantinedFailures: failures.quarantined,
          durationMs: overallExecutionDurationMs,
          triggeredBy: executionRecord[0].triggeredBy ?? 'manual',
          ci: executionRecord[0].ciContext ?? null,
          browsers: usablePasses.filter(Boolean).map((b) => (b as BrowserChoice).label),
        },
      });
      return finalUpdateResult[0];
    }

    if (finalUpdateResult.length > 0) {
      resolvedLogger.info({ message: `Test plan execution COMPLETED and DB updated`, planId, testPlanRunId, overallStatus: finalOverallStatus, testsRun: calculatedTotalTests });

      // A failed attempt with attempts left is not the verdict yet: the next attempt is queued,
      // and the issues and the notification wait for the attempt that decides. Filing a bug for
      // a failure the retry then clears is exactly the noise that gets retry policies switched off.
      const retry = await queueRetryIfAllowed(finalUpdateResult[0]);
      if (retry) {
        wsEmitter.emitExecutionLog(testPlanRunId, {
          level: 'info',
          source: 'system',
          message:
            `Attempt ${finalUpdateResult[0].attempt} of ${finalUpdateResult[0].maxAttempts} ended ${finalOverallStatus}; ` +
            `attempt ${retry.attempt} is queued as run ${retry.id}.`,
          timestamp: new Date().toISOString(),
          metadata: { retryExecutionId: retry.id, attempt: retry.attempt },
        });
        return finalUpdateResult[0];
      }

      // Before the notification, so a message that says "3 failed" arrives after the issues
      // those failures produced already exist to be linked to.
      await fileFailuresIfConfigured({
        plan: {
          name: snapshot.plan.name,
          issueTrackerId: snapshot.issues.trackerId,
          createIssuesOnFailure: snapshot.issues.createOnFailure,
        },
        planId,
        executionId: testPlanRunId,
        organizationId: executionRecord[0].organizationId,
        results: finalDetailedResults,
      });
      if (snapshot.testManagement?.connectionId) await publishToTestManagement(testPlanRunId);
      await notifyRunFinished({
        plan: { notificationSettings: snapshot.notificationSettings },
        execution: executionRecord[0],
        summary: {
          planId,
          planName: snapshot.plan.name || planId,
          executionId: testPlanRunId,
          status: finalOverallStatus,
          totalTests: calculatedTotalTests,
          passedTests: calculatedPassedTests,
          failedTests: calculatedFailedTests,
          skippedTests: calculatedSkippedTests,
          quarantinedFailures: failures.quarantined,
          durationMs: overallExecutionDurationMs,
          triggeredBy: executionRecord[0].triggeredBy ?? 'manual',
          ci: executionRecord[0].ciContext ?? null,
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
  } // runTakenPlan
  } // joinRun
}

/**
 * Publishes a directory of evidence to the artifact store.
 *
 * Never throws: the verdict does not depend on the pictures, and a bucket that refused an upload
 * must cost the report its images, not the run its result. The local copy stays when an upload
 * fails, so the evidence still exists somewhere.
 */
async function publishArtifacts(localDir: string, executionId: string): Promise<void> {
  try {
    await artifactStore().publishDirectory(localDir);
  } catch (error: any) {
    const resolvedLogger = await loggerPromise;
    await withTenantTransaction(tx => tx.update(testPlanExecutionsTable)
      .set({ artifactStorageStatus: error instanceof QuotaError ? 'quota_exceeded' : 'error' })
      .where(eq(testPlanExecutionsTable.id, executionId)).returning()).catch(() => undefined);
    const entry: ExecutionLogEntry = {
      level: 'warn',
      source: 'system',
      message: `Evidence in ${localDir} could not be stored: ${error?.message ?? error}. It stays on this worker's disk.`,
      timestamp: new Date().toISOString(),
    };
    resolvedLogger.warn(entry);
    getWsEmitter().emitExecutionLog(executionId, entry);
  }
}

/** How long a run over its organization's limit waits before a worker looks at it again. */
export const RUN_DEFERRAL_MS = Number(process.env.RUN_DEFERRAL_MS) || 10_000;

/** How long a failed scheduled attempt waits before the next: long enough for a blip to pass. */
export const RETRY_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 30_000;

/**
 * Queues the next attempt of a run that ended failed, when its request allowed one.
 *
 * Never throws: the verdict of this attempt is already written, and a retry that cannot be
 * queued leaves that verdict as the final one — which is then announced like any other.
 */
async function queueRetryIfAllowed(finished: TestPlanExecution): Promise<TestPlanExecution | null> {
  try {
    return await executionOrchestrator.retryFailedRun(finished, RETRY_DELAY_MS);
  } catch (error: any) {
    const resolvedLogger = await loggerPromise;
    resolvedLogger.error({ message: 'Could not queue the retry of a failed run', executionId: finished.id, error: error?.message });
    return null;
  }
}

/**
 * The configuration this run executes with.
 *
 * The one it was queued with, when it has one. A run without — every run queued before snapshots
 * existed, and scheduled runs until the scheduler enqueues through the orchestrator — gets the
 * plan as it is now, with the row's own environment and browsers over it, which is exactly what
 * such runs always did. A plan deleted in the meantime leaves a snapshot with no tests, and the
 * run ends saying it found none, as it did before.
 */
async function snapshotForRun(
  planId: string,
  execution: TestPlanExecution,
  jobOptions: { updateBaselines?: boolean },
): Promise<ExecutionSnapshot> {
  const stored = readExecutionSnapshot(execution.configurationSnapshot);
  if (stored) return stored;

  const [plan] = await withTenantTransaction((tx) =>
    tx.select().from(testPlans).where(eq(testPlans.id, planId)).limit(1),
  );
  const selected = plan
    ? await withTenantTransaction((tx) =>
        tx
          .select({
            testType: testPlanSelectedTests.testType,
            testId: testPlanSelectedTests.testId,
            apiTestId: testPlanSelectedTests.apiTestId,
            mobileTestId: testPlanSelectedTests.mobileTestId,
          })
          .from(testPlanSelectedTests)
          .where(eq(testPlanSelectedTests.testPlanId, planId))
          .orderBy(asc(testPlanSelectedTests.id)),
      )
    : [];
  const environmentId = execution.environment ? parseInt(execution.environment, 10) : NaN;

  return buildExecutionSnapshot(
    plan ?? ({ id: planId, name: planId } as TestPlan),
    selected as SnapshotTestReference[],
    {
      environmentId: Number.isNaN(environmentId) ? null : environmentId,
      browsers: execution.browsers,
      updateBaselines: jobOptions.updateBaselines,
    },
  );
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
  results: Array<{ testName: string; browser?: string | null; status: string; reasonForFailure?: string | null; startedAt?: Date | null; uiTestId?: number | null; testVersion?: number | null; quarantined?: boolean | null }>;
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
        // Somebody already knows this test is unreliable, and said so by quarantining it: a new
        // issue for each of its failures is the noise quarantine exists to stop.
        if (row.quarantined) continue;
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
 * Sends the finished run to the plan's TestRail, Xray or Zephyr Scale (server/test-management.ts).
 *
 * Like issue filing, it cannot fail the run: whatever the tool answered is recorded against the
 * run and said in its log, and the report offers to publish again.
 */
async function publishToTestManagement(executionId: string): Promise<void> {
  const resolvedLogger = await loggerPromise;
  const say = (level: 'info' | 'warn', message: string) => {
    const entry: ExecutionLogEntry = { level, source: 'system', message, timestamp: new Date().toISOString() };
    if (level === 'warn') resolvedLogger.warn(entry); else resolvedLogger.info(entry);
    getWsEmitter().emitExecutionLog(executionId, entry);
  };
  try {
    const publication = await publishExecution(executionId);
    if (!publication) return;
    const unmapped = publication.unmappedCount ? ` ${publication.unmappedCount} tests have no case there and were not sent.` : '';
    if (publication.status === 'published') {
      say('info', `Published ${publication.publishedCount} results to ${publication.connectionName} as ${publication.externalKey}.${unmapped}`);
      if (publication.message) say('warn', `${publication.connectionName} did not take every result: ${publication.message}`);
    } else {
      say('warn', `Not published to ${publication.connectionName}: ${publication.message ?? publication.status}`);
    }
  } catch (error: any) {
    say('warn', `Publishing to the test management tool could not be attempted: ${error?.message ?? error}`);
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
  execution: { scheduleId?: string | null; requestedByUserId?: number | null };
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

    // E-mail first, on its own: the plan's addresses and the person who started the run
    // (server/run-mail.ts). A mail server that refuses is said on the run's console.
    try {
      for (const outcome of await mailRunFinished(settings, input.execution.requestedByUserId, input.summary)) {
        wsEmitter.emitExecutionLog(input.summary.executionId, {
          level: outcome.sent ? 'info' : 'warn',
          source: 'system',
          message: outcome.sent ? `Run notification e-mailed to ${outcome.to}.` : `Run notification not e-mailed to ${outcome.to}: ${outcome.error}`,
          timestamp: new Date().toISOString(),
        });
      }
      for (const note of describeUnsupported(settings, await organizationMailConfigured(getTenantOrgId()))) {
        resolvedLogger.warn({ message: note, executionId: input.summary.executionId });
        wsEmitter.emitExecutionLog(input.summary.executionId, {
          level: 'warn',
          source: 'system',
          message: note,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      resolvedLogger.warn({ message: `Run notification e-mail could not be attempted: ${error?.message ?? error}`, executionId: input.summary.executionId });
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
