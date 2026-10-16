/**
 * One UI or API test, run once: what a plan run (server/execution/plan-run/run-unit.ts) calls for each test,
 * browser and language.
 */
import { playwrightService } from '../web/playwright-service';
import type { Test, ApiTest, Precondition, Cleanup } from '@shared/schema';
import { runPreconditions } from '../runtime/precondition-runner';
import { cleanupReportStep, runCleanups } from '../runtime/cleanup-runner';
import type { StepResult } from '../web/playwright-service';
import logger from '../platform/logger';
import fs from 'fs-extra';
import path from 'path';
import { getWsEmitter } from '../http/websocket';
import { defaultVariables } from '../runtime/variables';
import { protocolReport } from '../api-tests/api-protocol-report';
import { runDedicatedBddTest } from '../bdd/bdd-execution';
import { apiTestSpec, runApiRequest, type ApiRequestSpec } from '../api-tests/api-test-runner';
import { runPerformance } from '../api-tests/api-performance';
import type { ApiPerformance, PerformanceSummary } from '@shared/api-performance';
import { type BrowserChoice } from '../runtime/browsers';
import { isSensitiveFlow, prudentEvidence } from '../runtime/run-evidence';
import { isManualSequence } from '@shared/manual-tests';
import type { VisualContext } from '../web/visual-testing';
import { sequenceStatus } from '../web/playwright/visual-verdict';
import type { EvidenceCaptureMode } from '@shared/schema';
import { type NetworkSummary } from '@shared/network';
import { type PreconditionFailurePolicy, type StepRuntime } from '../runtime/run-policies';
import type { FrozenDependencies } from '../authoring/executable-definition';

/** Keeps a browser label from turning into a path when it names a directory. */
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 40) || 'browser';
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
  /** Kept only when the plan asked for them — see server/runtime/run-evidence.ts. */
  videoPath?: string;
  tracePath?: string;
  harPath?: string;
  /** Read from the HAR whenever the network was recorded, kept file or not. */
  network?: NetworkSummary;
  /** The directory this test wrote its evidence into, to be published to the artifact store. */
  artifactDir?: string;
  /**
   * A UI test with a dataset: each row's own outcome and evidence, from its own directory
   * (`row_<index>`). The fields above stay the merged view the report has always read.
   */
  rows?: RowRunResult[];
}

/** One dataset row of a UI test run: how it ended, and the evidence it kept. */
export interface RowRunResult {
  datasetRow: number;
  status: 'passed' | 'failed' | 'error';
  error?: string;
  screenshotPath?: string;
  videoPath?: string;
  tracePath?: string;
  harPath?: string;
}

/** What the plan adds to a single test run: which browser, and whether to compare it visually. */
export interface RunTestOptions {
  browser?: BrowserChoice;
  visual?: Omit<VisualContext, 'testId' | 'browser'>;
  /** Whether to keep a video and a trace of the run. The directory is this test's own. */
  evidence?: {
    video?: EvidenceCaptureMode;
    trace?: EvidenceCaptureMode;
    network?: EvidenceCaptureMode;
  };
  /** The plan's timeouts, screenshots and step retry — see server/runtime/run-policies.ts. */
  runtime?: StepRuntime;
  /** What a failed precondition means for this test. Absent: it is blocked, as it always was. */
  onPreconditionFailure?: PreconditionFailurePolicy;
  /** Aborted when the run is cancelled or out of time; the test stops at its next step. */
  signal?: AbortSignal;
  /**
   * Where API tests, API preconditions and OAuth token requests are sent from. Absent: this
   * runner. For a plan on an agent pool, the agent (server/runtime/agents/agent-fetch.ts).
   */
  http?: typeof fetch;
  /** The language the browser starts in (shared/locales.ts). Absent: the browser's default. */
  locale?: string;
  /**
   * Where this try writes its evidence: the attempt's own directory of the run's manifest
   * (`results/<plan>/<run>/units/<unit>/attempt_<n>`, shared/execution-identity.ts). Absent for a
   * unit without an id, which keeps the directory named after its test, browser and language.
   */
  evidenceDir?: string;
  /**
   * What the UI test calls, frozen with its definition: the steps are resolved from this alone,
   * never from the live groups, elements and custom actions. Absent: read live, as before R1.
   */
  dependencies?: FrozenDependencies;
}

/** The screenshot that says most about a run of steps: a visual failure's diff, else the last one. */
function telltaleScreenshot(steps: StepResult[] | undefined): string | undefined {
  const visualFailure = steps?.find(
    (step) => step.status === 'failed' && step.visual?.outcome === 'diff' && step.visual.diffImage,
  );
  if (visualFailure?.visual?.diffImage) return visualFailure.visual.diffImage;
  for (let i = (steps?.length ?? 0) - 1; i >= 0; i--) {
    const shot = steps![i].screenshot;
    if (typeof shot === 'string' && shot && !shot.startsWith('data:image')) return shot;
  }
  return undefined;
}

export async function runTest(
  test: Test | ApiTest, // Test is from shared/schema, ApiTest would also be from there
  userId: number | null,
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
  const startTime = Date.now();
  const testId = test.id;
  const testName = test.name;

  logger.info({
    message: `Starting ${testType} test execution`,
    testId,
    testName,
    planId,
    runId,
    userId,
  });
  if (testType === 'ui' && (test as Test).bdd?.mode === 'cucumber')
    return runDedicatedBddTest(test as Test, vars, options);

  if (testType === 'ui' && isManualSequence((test as Test).sequence)) {
    // Nothing for a browser to do: a person performs it and records the result in a plan run.
    return {
      testId,
      testType: 'ui',
      name: testName,
      success: false,
      status: 'skipped',
      error:
        'Manual test: it is performed by a person, and its result is recorded in the report of a plan run.',
      durationMs: 0,
    };
  }

  if (testType === 'ui') {
    const uiTest = test as Test;
    // The variables each run of the steps ended with (one per dataset row), for the cleanup.
    const variableSets: Array<Record<string, string>> = [];
    /**
     * The test's cleanup (server/runtime/cleanup-runner.ts), after the test whatever became of it — passed,
     * failed, blocked by a precondition that may have created half of what it meant to. Shown as the
     * last line of its steps; it never changes the result.
     */
    const withCleanup = async (
      result: IndividualTestRunResult,
    ): Promise<IndividualTestRunResult> => {
      const cleanups = (uiTest as unknown as { cleanups?: Cleanup[] | null }).cleanups;
      if (!cleanups || cleanups.length === 0) return result;
      const cleanup = await runCleanups(
        cleanups,
        variableSets.length > 0 ? variableSets : [vars],
        options?.http,
      );
      for (const step of cleanup.steps.filter(
        (s) => s.status === 'failed' || s.status === 'skipped',
      )) {
        getWsEmitter().emitExecutionLog(runId, {
          level: 'warn',
          source: 'system',
          message: `"${uiTest.name}": cleanup "${step.name}" ${step.status === 'failed' ? 'failed' : 'was skipped'}: ${step.detail}`,
          timestamp: new Date().toISOString(),
        });
      }
      return {
        ...result,
        steps: [...(result.steps ?? []), cleanupReportStep(cleanup) as StepResult],
      };
    };
    // The attempt's own directory when the run's manifest named this unit: every browser,
    // language and re-run apart. Otherwise one per browser and language, because a plan covering
    // two of either runs this test twice and the second would overwrite the first one's evidence.
    const screenshotBaseDir =
      options?.evidenceDir ??
      path.join(
        './results',
        planId,
        runId,
        [
          `ui_${testId}`,
          ...(options?.browser ? [sanitizeSegment(options.browser.label)] : []),
          ...(options?.locale ? [sanitizeSegment(options.locale)] : []),
        ].join('_'),
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
        logger.warn({
          message: 'UI Test blocked: precondition failed',
          testId,
          testName,
          planId,
          runId,
          failedAt: preResult.failedAt,
          reason: preResult.reason,
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

      // A flow that visibly handles a credential records no trace (server/runtime/run-evidence.ts).
      const evidence = prudentEvidence(
        options?.evidence ? { ...options.evidence, artifactDir: screenshotBaseDir } : undefined,
        isSensitiveFlow(uiTest.sequence),
      );
      if (evidence.traceWithheld) {
        getWsEmitter().emitExecutionLog(runId, {
          level: 'info',
          source: 'system',
          message: `"${uiTest.name}": no Playwright trace recorded, because the test handles a password or a secret and a trace would keep it in clear. Video, screenshots and the network summary are kept as the plan asks.`,
          timestamp: new Date().toISOString(),
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
          evidence: evidence.options,
          runtime: options?.runtime,
          signal: options?.signal,
          locale: options?.locale,
          onVariables: (set) => variableSets.push(set),
          dependencies: options?.dependencies,
        },
      );
      const durationMs = Date.now() - startTime;

      // Passed, failed, or in error when a visual comparison the plan asked for could not be
      // made: an unverified step is neither a pass nor a regression (visual-verdict.ts, C09).
      const finalStatus = sequenceStatus(result);

      // The last screenshot taken, or — for a test that failed on a visual comparison — the
      // diff, not the page: the page is what the report already has; the diff is the only
      // picture that answers "what changed?".
      const lastScreenshotPath = telltaleScreenshot(result.steps);

      // Each dataset row as itself: its outcome, its error and its own files, which the merged
      // steps above cannot say (a row's video and trace were never anywhere in them).
      const rows: RowRunResult[] | undefined = result.rows?.map((row) => ({
        datasetRow: row.index,
        status: sequenceStatus(row),
        ...(row.error ? { error: row.error } : {}),
        ...(telltaleScreenshot(row.steps) ? { screenshotPath: telltaleScreenshot(row.steps) } : {}),
        ...(row.evidence?.videoPath ? { videoPath: row.evidence.videoPath } : {}),
        ...(row.evidence?.tracePath ? { tracePath: row.evidence.tracePath } : {}),
        ...(row.evidence?.harPath ? { harPath: row.evidence.harPath } : {}),
      }));

      logger.info({
        message: `UI Test completed`,
        testId,
        testName,
        planId,
        runId,
        success: result.success,
        durationMs,
      });
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
        ...(rows ? { rows } : {}),
      });
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      logger.error({
        message: `Critical error during UI test execution`,
        testId,
        testName,
        planId,
        runId,
        error: error.message,
        stack: error.stack,
      });
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
    logger.info({
      message: `API Test execution starting`,
      testId: apiTest.id,
      testName: apiTest.name,
      planId,
      runId,
    });

    // This used to be `Math.random() > 0.2` under a TODO: no request was made, and every
    // API test in a plan reported a fabricated result that looked exactly like a real one.
    const spec: ApiRequestSpec = apiTestSpec(apiTest);
    const result = await runApiRequest(spec, vars, options?.http);
    const nativeProtocol =
      ['GRPC', 'WEBSOCKET', 'WS'].includes(spec.method) ||
      !!apiTest.protocolConfig ||
      /^(grpcs?|wss?):/.test(spec.url);

    // The performance check runs only when the request could be made at all: timing an
    // endpoint that cannot be reached would measure nothing but the timeout.
    const settings = (apiTest as ApiTest & { performance?: ApiPerformance | null }).performance;
    const performance =
      settings && !result.error
        ? await runPerformance(
            spec,
            vars,
            settings,
            result,
            options?.http,
            () => !!options?.signal?.aborted,
          )
        : undefined;

    const durationMs = Date.now() - startTime;
    const failedAssertions = result.assertions.filter((a) => !a.pass);
    const success =
      result.passed && !result.error && !(performance && performance.breaches.length > 0);
    const failure =
      result.error ??
      ([
        ...failedAssertions.map(
          (a) =>
            `${a.assertion.source}${a.assertion.property ? ` "${a.assertion.property}"` : ''} ` +
            `${a.assertion.comparison} "${a.assertion.targetValue ?? ''}" — actual: ${JSON.stringify(a.actualValue)}` +
            (a.error ? ` (${a.error})` : ''),
        ),
        ...(performance?.breaches.length
          ? [
              `Performance over ${performance.iterations} requests: ${performance.breaches.join(', ')}`,
            ]
          : []),
      ].join('; ') ||
        undefined);
    const protocol = nativeProtocol
      ? protocolReport({ ...result, error: failure }, vars)
      : undefined;

    logger.info({
      message: `API Test completed`,
      testId: apiTest.id,
      testName: apiTest.name,
      planId,
      runId,
      success,
      durationMs,
      status: result.status,
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
    logger.error({
      message: 'Unknown test type provided to runTest',
      testType,
      testId,
      planId,
      runId,
    });
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
