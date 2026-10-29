import type { AccessibilityFinding } from '@shared/accessibility';
import type { BrowserGridProvider } from '@shared/browser-grids';
import type { DownloadFinding } from '@shared/downloads';
import { analyseFlow, leavesPageAlone } from '@shared/flow';
import { LOCALE_VARIABLE } from '@shared/locales';
import { matrixEvidence, type MatrixEvidence } from '@shared/matrix-evidence';
import type { Test } from '@shared/schema';
import type { LighthouseFinding, PerformanceFinding } from '@shared/web-performance';
import fs from 'fs-extra';
import path from 'path';
import { BrowserContext, Page } from 'playwright';
import { markGridSession } from '../../runtime/browser-grids';
import { describeBrowser, deviceContextOptions } from '../../runtime/browsers';
import { gotoWithinPolicy } from '../../platform/egress-policy';
import { FlowCursor } from '../../runtime/flow-cursor';
import { loadLoginState, type EnvironmentScope, type LoginState } from '../../runtime/login-state';
import { browserMatrixEvidence } from '../../runtime/matrix-evidence';
import { requestVariables, substituteVariables } from '../../platform/outbound-http';
import { PlaywrightReporter } from '../playwright-reporter';
import {
  captureRunEvidence,
  harContextOptions,
  startTrace,
  videoContextOptions,
  type CapturedEvidence,
} from '../../runtime/run-evidence';
import { keepsScreenshot } from '../../runtime/run-policies';
import { elementIdOfStep } from '../../authoring/step-elements';
import { provenanceOf } from '../../authoring/step-provenance';
import { prepareSequence } from '../../authoring/executable-definition';
import {
  executeStep,
  runBounded,
  stepDeadlineMs,
  stepInterruption,
  STEP_SETTLE_MS,
  StepInterruptedError,
  type InterruptionKind,
} from '../step-executor';
import { type SequenceStep } from '../../authoring/step-groups';
import { storage } from '../../identity/storage';
import {
  compareStepScreenshot,
  isVisualError,
  isVisualFailure,
  stableScreenshot,
  visualError,
} from '../visual-testing';
import { stepVisualOf } from './visual-verdict';
import { getWsEmitter } from '../../http/websocket';

import { browserForSetting, openBrowserSession, type BrowserSession } from '../browser-session';
import { resolvedLogger } from './log';
import { datasetRows, evidenceScreenshot, runOverDataset } from './run-helpers';
import {
  DEFAULT_HEADLESS,
  DEFAULT_TIMEOUT,
  type ExecuteSequenceOptions,
  type StepResult,
  type TestStep,
} from './types';
import { datasetRowSegment } from '@shared/execution-identity';

/** One run of a test's steps: the whole test, or one row of its dataset. */
export interface SequenceResult {
  success: boolean;
  steps?: StepResult[];
  error?: string;
  duration?: number;
  evidence?: CapturedEvidence;
  /** Set when the test was cut short: the run stopped, or a step ran past its deadline. */
  interrupted?: InterruptionKind;
}

/** A test's run: with rows, each row's own result beside the merged one. */
export interface SequenceRun extends SequenceResult {
  /** One per dataset row, in order, each with its own evidence and error. Absent without rows. */
  rows?: Array<SequenceResult & { index: number }>;
}

/**
 * One row's options: its video, trace, HAR and visual diffs go in its own directory, and it
 * compares against its own baselines — row two renders row two's data, and measuring it against
 * row one's screenshot would report the dataset working. The baseline variant keeps the name it
 * has always had (`row_<n>` from 1), so existing baselines still match.
 */
function rowOptions(
  options: ExecuteSequenceOptions | undefined,
  rowDir: string | undefined,
  index: number,
): ExecuteSequenceOptions | undefined {
  if (!options) return options;
  const evidenceDir =
    rowDir ??
    (options.evidence?.artifactDir
      ? path.join(options.evidence.artifactDir, datasetRowSegment(index))
      : undefined);
  return {
    ...options,
    ...(options.evidence ? { evidence: { ...options.evidence, artifactDir: evidenceDir } } : {}),
    ...(options.visual
      ? {
          visual: {
            ...options.visual,
            variant: `row_${index + 1}`,
            ...(options.visual.artifactDir ? { artifactDir: evidenceDir } : {}),
          },
        }
      : {}),
  };
}

export class TestRunner {
  async executeTestSequence(
    test: Test,
    /** Null for a run nobody started (a schedule): the defaults stand in for user settings. */
    userId: number | null,
    screenshotBaseDir?: string, // Optional base directory for screenshots
    executionId?: string, // Optional execution ID for real-time logging
    // Resolved `{{name}}` values. Supplied by the caller that knows which environment
    // applies; falls back to the defaults so existing callers keep working.
    vars: Record<string, string> = requestVariables(),
    // The environment whose saved browser session to start from, when it has one. Without
    // it the run starts signed out, exactly as it always did.
    environment?: EnvironmentScope,
    // What the plan asked for beyond the test itself: which browser to run on, and whether
    // to compare each step against its visual baseline. Absent means what it has always
    // meant — the user's own browser setting, and no visual comparison.
    options?: ExecuteSequenceOptions,
  ): Promise<SequenceRun> {
    const startTime = Date.now();

    // A test with rows of input runs once per row, with that row's values layered over the
    // environment's. Each row gets its own browser rather than sharing one: a row is an
    // independent case, and one leaving a modal open or a session half-established would
    // otherwise decide the outcome of the next. It gets its own evidence directory too — its
    // screenshots, video, trace and HAR — so no row's evidence is written over by the next one.
    const rows = datasetRows(test);
    if (rows) {
      const merged = await runOverDataset(rows, (row, index) => {
        const rowDir = screenshotBaseDir
          ? path.join(screenshotBaseDir, datasetRowSegment(index))
          : undefined;
        return this.executeTestSequence(
          { ...test, dataset: null } as Test,
          userId,
          rowDir,
          executionId,
          { ...vars, ...row },
          environment,
          rowOptions(options, rowDir, index),
        );
      });
      return {
        success: merged.success,
        steps: merged.steps,
        ...(merged.error ? { error: merged.error } : {}),
        duration: Date.now() - startTime,
        rows: merged.rows.map(({ index, result }) => ({ index, ...result })),
      };
    }
    // This run's own copy. A `storeText` step writes into it, and the object passed in may be
    // shared with the plan's other tests, other browsers, or the process-wide defaults — a
    // value stored here must not be what the next test finds under the same name.
    vars = { ...vars };
    // {{locale}} for the steps that expect a translated text, when the run chose a language.
    if (options?.locale) vars[LOCALE_VARIABLE] = options.locale;
    // The object itself: the steps store into it, and the cleanup after the test reads what they stored.
    options?.onVariables?.(vars);
    const wsEmitter = getWsEmitter();
    resolvedLogger.http({
      message: 'PlaywrightService: executeTestSequence called',
      testName: test.name,
      testId: test.id,
      userId,
      testUrl: test.url,
      screenshotBaseDir,
    });

    // Calls to step groups become the steps those groups hold, custom actions the script they
    // run, and steps naming a repository element take its selector — before anything is
    // launched. A frozen definition (a plan run queued from R1 on) resolves all three from the
    // bundle it was queued with and reads nothing live; an ad-hoc run reads them now. A call that
    // cannot be expanded — a group deleted since the test was written — fails the test here
    // rather than running a shorter test that would report as a pass.
    const resolution = await prepareSequence(test.sequence, options?.dependencies);
    if (resolution.errors.length > 0) {
      const message = resolution.errors.join(' ');
      resolvedLogger.warn({
        message: `PS:executeTestSequence - ${message}`,
        testName: test.name,
        testId: test.id,
      });
      return { success: false, steps: [], error: message, duration: Date.now() - startTime };
    }
    const sequenceToRun = resolution.steps as unknown as TestStep[];
    // Blocks that do not close fail the test before a browser is launched, by step number.
    const flow = analyseFlow(sequenceToRun);
    if (!flow.ok) {
      const message = flow.errors.join(' ');
      resolvedLogger.warn({
        message: `PS:executeTestSequence - ${message}`,
        testName: test.name,
        testId: test.id,
      });
      return { success: false, steps: [], error: message, duration: Date.now() - startTime };
    }
    if (resolution.unresolved.length > 0) {
      const message =
        `${resolution.unresolved.length} step(s) name a shared element that is no longer in the ` +
        `repository; they ran on the selector saved with the test.`;
      resolvedLogger.warn({ message, testName: test.name, testId: test.id });
      if (executionId) {
        wsEmitter.emitExecutionLog(executionId, {
          level: 'warn',
          source: 'system',
          message,
          timestamp: new Date().toISOString(),
        });
      }
    }
    if (resolution.expanded && executionId) {
      wsEmitter.emitExecutionLog(executionId, {
        level: 'info',
        source: 'system',
        message: `Expanded step groups: this test runs ${sequenceToRun.length} steps.`,
        timestamp: new Date().toISOString(),
      });
    }

    const targetUrl = test.url ? substituteVariables(test.url, vars) : test.url;
    let session: BrowserSession | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    const stepResults: StepResult[] = [];
    let overallSuccess = true;
    /** The browser grid this test's browser came from, told the outcome before the page closes. */
    let gridProvider: BrowserGridProvider | null = null;
    /** Whether this run is being traced, which decides how its context has to be closed. */
    let tracing = false;
    let evidence: CapturedEvidence = {};
    let matrix: MatrixEvidence | undefined;
    // Worked out once: the scratch directory a recording goes into is named when the context
    // is created, and has to be the same one that is cleaned up afterwards.
    const videoOptions = await videoContextOptions(options?.evidence);
    // Same for the network: the HAR's path is fixed when the context is made.
    const harOptions = await harContextOptions(options?.evidence);

    const signal = options?.signal;
    /** Why the test was cut short, once it has been: nothing after that point starts. */
    let interrupted: StepInterruptedError | null = null;
    /**
     * Set by the teardown: the step in flight has been abandoned, and whatever it still does
     * until its calls reject (a retry, a log line) must not act as if it counted.
     */
    let abandoned = false;
    /** The teardown on a stop: this test's own session, never a browser anyone else uses. */
    const closeSession = async () => {
      abandoned = true;
      await session?.close();
    };
    const stoppedStep = (name: string, type: string, why: StepInterruptedError): StepResult => ({
      name,
      type,
      status: 'failed',
      error: `Stopped: ${why.message}`,
      details: `Stopped during this step: ${why.message}`,
    });

    /**
     * Ends the run's recording and closes what was recording it.
     *
     * Called on every path that returns rather than from `finally`, because `finally` runs
     * after the returned object has already been built: evidence assigned there would never
     * reach the caller. Nulling the handles afterwards keeps the defensive closes below from
     * closing a context twice.
     */
    const finishEvidence = async (passed: boolean) => {
      if (matrix) {
        if (!stepResults.length)
          stepResults.push({
            name: 'Runtime configuration',
            type: 'configuration',
            status: 'passed',
            details: matrix.verdict,
          });
        stepResults[0].matrixEvidence = matrix;
      }
      const [openPage, openContext] = [page, context];
      page = null;
      context = null;
      const capture = async () => {
        if (gridProvider && openPage) {
          await markGridSession(
            openPage,
            gridProvider,
            passed,
            stepResults.find((step) => step.status === 'failed')?.error ?? null,
          );
        }
        return captureRunEvidence({
          context: openContext,
          page: openPage,
          options: options?.evidence,
          tracing,
          passed,
          label: `${test.name ?? 'test'}_${options?.browser?.label ?? 'default'}`,
          scratchDir: videoOptions.recordVideo?.dir,
          harScratchPath: harOptions.recordHar?.path,
        });
      };
      // A stop that arrives while the evidence is being saved closes the session like any other:
      // the test is not kept, and its slot not held, for the sake of a video. A test that has
      // already stopped gets STEP_SETTLE_MS to save what it has.
      evidence = await runBounded(
        capture,
        signal?.aborted
          ? { deadlineMs: STEP_SETTLE_MS, teardown: closeSession }
          : { signal, teardown: closeSession },
      ).catch((error) => {
        if (error instanceof StepInterruptedError) return {};
        throw error;
      });
    };

    try {
      const userSettings = userId === null ? undefined : await storage.getUserSettings(userId);
      const headlessMode = userSettings?.playwrightHeadless ?? DEFAULT_HEADLESS;
      // The plan's element timeout when a plan is driving this, the user's own setting otherwise.
      const pageTimeout =
        options?.runtime?.elementTimeoutMs ??
        (userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT);
      // The plan's browser when a plan is driving this, the user's own setting otherwise —
      // which is what every run used before a plan's choice was honoured at all.
      const browserChoice =
        options?.browser ?? browserForSetting(userSettings?.playwrightBrowser, headlessMode);
      resolvedLogger.debug({
        message: `PS:executeTestSequence - Effective settings`,
        testName: test.name,
        browser: describeBrowser(browserChoice),
        pageTimeout,
      });
      matrix = matrixEvidence({
        route: browserChoice.grid ? 'grid' : browserChoice.agent ? 'agent' : 'local',
        ...(browserChoice.grid ? { provider: browserChoice.grid.provider } : {}),
        requested: {
          browser: browserChoice.name ?? browserChoice.grid?.browserName ?? browserChoice.label,
          ...browserChoice.machine,
          ...(browserChoice.device ? { device: browserChoice.device } : {}),
        },
        effective: {},
        source: 'unavailable',
      });

      // Start from the environment's saved session when there is one, so the test does not
      // spend its first thirty seconds logging in — and does not fail for a reason that has
      // nothing to do with what it checks.
      const savedLogin = environment ? await loadLoginState(environment) : undefined;
      const { acceptLanguage: savedAcceptLanguage, ...storageState } =
        savedLogin ?? ({} as Partial<LoginState>);
      // A plan's own locale wins: it is what the plan tests. Otherwise the recorder's header, so
      // a site that binds its session to it keeps the session.
      const replayHeaders =
        savedLogin && savedAcceptLanguage && !options?.locale
          ? { 'Accept-Language': savedAcceptLanguage }
          : undefined;
      if (savedLogin) {
        resolvedLogger.debug({
          message: 'PS:executeTestSequence - starting from the saved login state',
          testName: test.name,
          environmentId: environment?.environmentId,
        });
      }

      // A stop that came before the launch: no browser is opened at all. One that comes during
      // the launch closes the session the moment it exists; the launch itself (a grid's
      // connection above all) cannot be called back, so it gets STEP_SETTLE_MS to finish.
      let opening: Promise<BrowserSession> | undefined;
      session = await runBounded(
        () =>
          (opening = openBrowserSession({
            browser: browserChoice,
            gridSession: {
              name: test.name ?? 'test',
              build: executionId ? `WebFlowMaster run ${executionId}` : 'WebFlowMaster',
            },
            url: targetUrl,
            timeoutMs: pageTimeout,
            context: {
              // A phone or tablet: its screen, density, touch, mobile layout and user agent, in
              // place of the desktop window (shared/devices.ts).
              ...deviceContextOptions(browserChoice),
              ...(savedLogin ? { storageState: storageState as any } : {}),
              ...(replayHeaders ? { extraHTTPHeaders: replayHeaders } : {}),
              // HTTP Basic auth in front of the environment: the secrets http.username and http.password.
              ...(vars['http.username']
                ? {
                    httpCredentials: {
                      username: vars['http.username'],
                      password: vars['http.password'] ?? '',
                    },
                  }
                : {}),
              // Playwright sends it as Accept-Language and answers navigator.language with it.
              ...(options?.locale ? { locale: options.locale } : {}),
              // Recording has to be asked for when the context is made; whether the file is kept
              // is decided when the run ends. A plan that wants neither pays for neither.
              ...videoOptions,
              ...harOptions,
            },
            beforePage: async (opened) => {
              tracing = await startTrace(opened, options?.evidence);
            },
          })),
        {
          signal,
          teardown: async () => {
            void opening?.then(
              (opened) => opened.close(),
              () => {},
            );
          },
        },
      );
      gridProvider = browserChoice.grid?.provider ?? null;
      context = session.context;
      page = session.page;
      matrix = await browserMatrixEvidence(browserChoice, session.browser, page);
      if (options?.runtime) page.setDefaultNavigationTimeout(options.runtime.pageLoadTimeoutMs);

      // A run no plan drives keeps a picture of every step, as it always has.
      const screenshots = options?.runtime?.screenshots ?? 'always';
      const storeScreenshot = async (buffer: Buffer, label: string): Promise<string> => {
        if (!screenshotBaseDir) return `data:image/png;base64,${buffer.toString('base64')}`;
        await fs.ensureDir(screenshotBaseDir);
        const sanitized = label.replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50);
        const filePath = path.join(screenshotBaseDir, `step_${sanitized}_${Date.now()}.png`);
        await fs.writeFile(filePath, buffer);
        return filePath;
      };

      if (targetUrl) {
        try {
          const navMessage = `Navigating to ${targetUrl}`;
          resolvedLogger.debug({
            message: 'PS:executeTestSequence - ' + navMessage,
            testName: test.name,
            url: targetUrl,
          });
          if (executionId) {
            wsEmitter.emitExecutionLog(executionId, {
              level: 'step',
              source: 'playwright',
              message: navMessage,
              timestamp: new Date().toISOString(),
              metadata: { url: targetUrl },
            });
          }
          const loading = page;
          await runBounded(
            () => gotoWithinPolicy(loading, targetUrl, { waitUntil: 'domcontentloaded' }),
            { signal, teardown: closeSession },
          );
          const navBuffer = keepsScreenshot(screenshots, 'passed')
            ? await evidenceScreenshot(page, (reason) =>
                resolvedLogger.warn({
                  message: 'PS:executeTestSequence - No screenshot of the loaded page',
                  testName: test.name,
                  reason,
                }),
              )
            : undefined;
          const navScreenshotPath = navBuffer
            ? await storeScreenshot(navBuffer, 'navigation_load')
            : undefined;
          stepResults.push({
            name: 'Load Page',
            type: 'navigation',
            status: 'passed',
            screenshot: navScreenshotPath,
            details: `Successfully navigated to ${test.url}`,
          });
        } catch (e: any) {
          // Not a page that failed to load: the test was stopped. The outer catch reports it.
          if (e instanceof StepInterruptedError) throw e;
          overallSuccess = false;
          resolvedLogger.error({
            message: 'PS:executeTestSequence - Failed initial navigation',
            testName: test.name,
            url: test.url,
            error: e.message,
            stack: e.stack,
          });
          let errorNavScreenshotPath: string | undefined;
          if (page && !page.isClosed() && keepsScreenshot(screenshots, 'failed')) {
            if (screenshotBaseDir) {
              await fs.ensureDir(screenshotBaseDir);
              const errorScreenshotFilePath = path.join(
                screenshotBaseDir,
                `step_navigation_load_error_${Date.now()}.png`,
              );
              await page
                .screenshot({ type: 'png', path: errorScreenshotFilePath })
                .catch((err) =>
                  resolvedLogger.warn('Failed to save error screenshot to file', err),
                );
              errorNavScreenshotPath = errorScreenshotFilePath;
            } else {
              const errorScreenshotBuffer = await page
                .screenshot({ type: 'png' })
                .catch(() => null);
              errorNavScreenshotPath = errorScreenshotBuffer
                ? `data:image/png;base64,${errorScreenshotBuffer.toString('base64')}`
                : undefined;
            }
          }
          stepResults.push({
            name: 'Load Page',
            type: 'navigation',
            status: 'failed',
            error: e.message,
            screenshot: errorNavScreenshotPath,
            details: `Failed to navigate to ${test.url}`,
          });
          const duration = Date.now() - startTime;
          // A run that never got past the first navigation is exactly the run somebody will
          // want the video of.
          await finishEvidence(false);
          return { success: false, steps: stepResults, error: e.message, duration, evidence };
        }
      } else {
        stepResults.push({
          name: 'Initial State',
          type: 'setup',
          status: 'passed',
          details: 'No initial URL provided.',
        });
      }

      const reporter = new PlaywrightReporter(page); // Initialize reporter

      if (overallSuccess && sequenceToRun.length > 0) {
        resolvedLogger.debug({
          message: `PS:executeTestSequence - Starting execution of ${sequenceToRun.length} steps`,
          testName: test.name,
        });

        const cursor = new FlowCursor(sequenceToRun, flow.blocks, vars);
        while (!cursor.done) {
          // The step's position in the test, not how many steps have run: healing and visual
          // baselines are keyed by it, and a loop meets the same step more than once.
          const i = cursor.pc;
          const step = sequenceToRun[i];
          let flowOutcome: { condition?: boolean; iterations?: number } = {};
          if (signal?.aborted) {
            // The run is stopping between two steps. This one does not start, and the test says
            // why it is shorter than it should be.
            interrupted = stepInterruption(signal.reason);
            stepResults.push({
              ...stoppedStep(
                step.action?.name || 'Unnamed Action',
                step.action?.id || 'unknown',
                interrupted,
              ),
              details: `Stopped before this step: ${interrupted.message}`,
            });
            overallSuccess = false;
            break;
          }
          let stepStatus: 'passed' | 'failed' = 'passed';
          let stepError: string | undefined;
          let stepScreenshot: string | undefined;
          let stepDetail: string | undefined;
          let stepAccessibility: AccessibilityFinding | undefined;
          let stepPerformance: PerformanceFinding | undefined;
          let stepLighthouse: LighthouseFinding | undefined;
          let stepDownload: DownloadFinding | undefined;
          let stepVisual: StepResult['visual'];
          const actionId = step.action?.id;
          const actionName = step.action?.name || 'Unnamed Action';

          // Set context for AI Healing: where the step is written, never `i`. After a group is
          // expanded the runner's position is not the test's, and a repair keyed by it landed on
          // whichever step of the test was there (C05). The element id travels with it: a step
          // naming a shared element is repaired in the element, not in this one test's copy.
          reporter.setContext({
            testId: test.id,
            provenance: provenanceOf(step as unknown as SequenceStep),
            elementId: elementIdOfStep(step as unknown as SequenceStep),
            executionId: executionId ?? null,
            userId,
            attempt: options?.attempt ?? null,
            stepIndex: i,
            element: step.targetElement ?? null,
          });

          reporter.resetStepState();

          const stepLogMessage = `Executing step ${i + 1}: ${actionName}`;
          if (executionId) {
            wsEmitter.emitExecutionLog(executionId, {
              level: 'step',
              source: 'playwright',
              message: stepLogMessage,
              timestamp: new Date().toISOString(),
              metadata: {
                action: actionName,
                stepIndex: i,
                selector: step.targetElement?.selector,
              },
            });
          }

          try {
            if (!actionId) throw new Error('Step action ID is missing.');

            // The whole step is bounded — the action, its retry, its screenshot, its visual
            // check — by the run's signal and the step's deadline (runBounded).
            await runBounded(
              async () => {
                if (!page) throw new Error('The test has no page to run the step in.');
                let outcome: Awaited<ReturnType<typeof executeStep>>;
                try {
                  outcome = await executeStep(
                    { page, reporter, vars, startedAt: startTime, artifactDir: screenshotBaseDir },
                    step,
                  );
                } catch (firstError: any) {
                  // Retried below like a failed outcome; without the plan's retry it fails as it did.
                  // A step abandoned by a stop is not retried: its session is gone.
                  if (!options?.runtime?.retryFailedStep || abandoned) throw firstError;
                  outcome = {
                    status: 'failed',
                    error: firstError?.message ?? String(firstError),
                  } as typeof outcome;
                }
                if (abandoned) return;
                if (outcome.status === 'failed' && options?.runtime?.retryFailedStep) {
                  // "On Major Step Failure: Retry Step" — once. What the step reports is the second
                  // try: a step that passes on it passed, and one that fails again fails with its
                  // second error, which is the one closest to the state the test is now in.
                  if (executionId) {
                    wsEmitter.emitExecutionLog(executionId, {
                      level: 'warn',
                      source: 'playwright',
                      message: `Step ${i + 1} (${actionName}) failed: ${outcome.error ?? 'no reason given'}. Trying it once more.`,
                      timestamp: new Date().toISOString(),
                      metadata: { stepIndex: i, retry: true },
                    });
                  }
                  reporter.resetStepState();
                  outcome = await executeStep(
                    { page, reporter, vars, startedAt: startTime, artifactDir: screenshotBaseDir },
                    step,
                  );
                }
                // A step that moved the test to another tab: the steps after it, the healing pass
                // and this step's screenshot all belong to that tab.
                flowOutcome = outcome;
                if (outcome.page) {
                  page = outcome.page;
                  reporter.setPage(outcome.page);
                }
                if (outcome.status === 'failed') {
                  stepStatus = 'failed';
                  stepError = outcome.error;
                }
                // See the ad-hoc path: a setup step that found the state already correct and one
                // that changed it both pass, and the report has to tell them apart.
                stepDetail = outcome.detail;
                stepAccessibility = outcome.accessibility;
                stepPerformance = outcome.performance;
                stepLighthouse = outcome.lighthouse;
                stepDownload = outcome.download;

                // One screenshot, used twice: as the step's evidence when the plan keeps it, and —
                // when the plan asked for visual testing — as the image compared against this
                // step's baseline. Taken only when one of the two wants it.
                // A condition, a loop marker or a variable changes nothing on screen: its picture
                // would be the previous step's again, and comparing it would test that step twice.
                const capturesPage = !leavesPageAlone(actionId) || stepStatus === 'failed';
                const comparesVisually =
                  !!options?.visual && stepStatus === 'passed' && capturesPage;
                // For a comparison, a screenshot of the page once it has settled: one taken mid-load
                // differs from the baseline by whatever had loaded by then (see stableScreenshot).
                // An evidence picture that cannot be taken leaves the step's result as it is (see
                // evidenceScreenshot); a comparison without its image is an error (C09, P06).
                const noPicture = (reason: string) => {
                  resolvedLogger.warn({
                    message: 'PS:executeTestSequence - No screenshot for step',
                    testName: test.name,
                    step: i + 1,
                    reason,
                  });
                  if (executionId) {
                    wsEmitter.emitExecutionLog(executionId, {
                      level: 'warn',
                      source: 'playwright',
                      message: `Step ${i + 1} (${actionName}): no screenshot could be taken. The step's result stands.`,
                      timestamp: new Date().toISOString(),
                      metadata: { stepIndex: i },
                    });
                  }
                };
                let screenshotError: unknown;
                const screenshotBuffer = comparesVisually
                  ? await stableScreenshot(page).catch((error: any) => {
                      screenshotError = error;
                      return undefined;
                    })
                  : capturesPage && keepsScreenshot(screenshots, stepStatus)
                    ? await evidenceScreenshot(page, noPicture)
                    : undefined;
                if (screenshotBuffer && keepsScreenshot(screenshots, stepStatus)) {
                  stepScreenshot = await storeScreenshot(screenshotBuffer, actionName);
                }

                if (options?.visual && comparesVisually) {
                  // Only for a step that did what it was asked. A step that already failed is
                  // being reported for that reason, and the page it left behind says nothing
                  // about whether the application looks right.
                  // Inside a loop, each pass has its own baseline (see FlowCursor.iterationKey).
                  const iteration = cursor.iterationKey();
                  const visualContext = iteration
                    ? {
                        ...options.visual,
                        variant: [options.visual.variant, iteration].filter(Boolean).join('_'),
                      }
                    : options.visual;
                  const visualOutcome = screenshotBuffer
                    ? await compareStepScreenshot(visualContext, i, screenshotBuffer)
                    : visualError('screenshot-unavailable', screenshotError);
                  stepVisual = stepVisualOf(visualOutcome);
                  // A diff is a regression; an error is a comparison nobody made. Both stop the
                  // step, and the test's status tells them apart (sequenceStatus).
                  const stopsStep = isVisualFailure(visualOutcome) || isVisualError(visualOutcome);
                  if (stopsStep) {
                    stepStatus = 'failed';
                    stepError = visualOutcome.detail;
                    // Now a failed step: kept under "on failed steps" too.
                    if (
                      screenshotBuffer &&
                      !stepScreenshot &&
                      keepsScreenshot(screenshots, 'failed')
                    ) {
                      stepScreenshot = await storeScreenshot(screenshotBuffer, actionName);
                    }
                  }
                  if (executionId) {
                    wsEmitter.emitExecutionLog(executionId, {
                      level: stopsStep ? 'error' : 'info',
                      source: 'playwright',
                      message: `Visual check, step ${i + 1}: ${stepVisual.detail}`,
                      timestamp: new Date().toISOString(),
                      metadata: { stepIndex: i, visual: visualOutcome.kind },
                    });
                  }
                }
              },
              { signal, deadlineMs: stepDeadlineMs(vars), teardown: closeSession },
            );
          } catch (e: any) {
            if (e instanceof StepInterruptedError) {
              // Stopped where it was: the session is already closed, and the next step does
              // not start.
              interrupted = e;
              stepResults.push(stoppedStep(actionName, actionId || 'unknown', e));
              overallSuccess = false;
              break;
            }
            stepStatus = 'failed';
            stepError = e.message;
            overallSuccess = false;
            resolvedLogger.error({ message: `Error in step "${actionName}"`, error: e.message });

            // A step that threw is the step somebody will want the picture of. Only for a plan
            // run, which decides screenshots: the other callers never took one here.
            if (
              options?.runtime &&
              !stepScreenshot &&
              keepsScreenshot(screenshots, 'failed') &&
              !page.isClosed()
            ) {
              const buffer = await page.screenshot({ type: 'png' }).catch(() => null);
              if (buffer)
                stepScreenshot = await storeScreenshot(buffer, actionName).catch(() => undefined);
            }
          }

          if (stepStatus === 'failed') overallSuccess = false;
          const healing = reporter.lastHealing;
          if (healing && executionId) {
            // The step passed on the repair, for this run; its source keeps what it said until
            // somebody approves the proposal.
            wsEmitter.emitExecutionLog(executionId, {
              level: 'warn',
              source: 'playwright',
              message: `Step ${i + 1} (${actionName}): ${healing.detail}`,
              timestamp: new Date().toISOString(),
              metadata: {
                stepIndex: i,
                healing: healing.status,
                ...(healing.proposalId ? { proposalId: healing.proposalId } : {}),
              },
            });
          }
          stepResults.push({
            name: actionName,
            type: actionId || 'unknown',
            // Which of the test's steps this was, so a fix proposed from the report can be put
            // back into that step (client/src/components/reports/FailureAnalysisDialog.tsx).
            stepId: typeof step.id === 'string' ? step.id : undefined,
            calledFrom:
              typeof (step as { calledFrom?: unknown }).calledFrom === 'string'
                ? (step as { calledFrom?: string }).calledFrom
                : undefined,
            selector: step.targetElement?.selector ?? null,
            status: stepStatus,
            screenshot: stepScreenshot,
            error: stepError,
            // A pass on a repaired locator says so: it is not the pass the step was written for.
            details:
              stepStatus === 'passed'
                ? healing
                  ? [stepDetail, healing.detail].filter(Boolean).join(' ')
                  : (stepDetail ?? 'Success')
                : stepError || 'Failed',
            healed: reporter.lastActionHealed,
            ...(healing ? { healing } : {}),
            visual: stepVisual,
            accessibility: stepAccessibility,
            performance: stepPerformance,
            lighthouse: stepLighthouse,
            download: stepDownload,
          });

          if (!overallSuccess) break;
          const runaway = cursor.advance(flowOutcome);
          if (runaway) {
            overallSuccess = false;
            stepResults.push({
              name: actionName,
              type: actionId || 'unknown',
              status: 'failed',
              error: runaway,
              details: runaway,
            });
            break;
          }
        }
      }

      await finishEvidence(overallSuccess);
      const duration = Date.now() - startTime;
      if (interrupted) {
        return {
          success: false,
          steps: stepResults,
          error: `Stopped: ${interrupted.message}`,
          duration,
          evidence,
          interrupted: interrupted.kind,
        };
      }
      return { success: overallSuccess, steps: stepResults, duration, evidence };
    } catch (error: any) {
      if (error instanceof StepInterruptedError) {
        // Stopped before the first step: while the browser opened, or while the page loaded.
        stepResults.push(stoppedStep('Open the browser', 'setup', error));
      }
      await finishEvidence(false);
      const duration = Date.now() - startTime;
      return {
        success: false,
        steps: stepResults,
        error:
          error instanceof StepInterruptedError
            ? `Stopped: ${error.message}`
            : error.message || 'Unknown critical error',
        duration,
        evidence,
        ...(error instanceof StepInterruptedError ? { interrupted: error.kind } : {}),
      };
    } finally {
      // finishEvidence has normally closed the context already, since a video or a trace is only
      // complete once it is closed; this closes whatever is left, the browser included.
      await session?.close();
    }
  }
}
