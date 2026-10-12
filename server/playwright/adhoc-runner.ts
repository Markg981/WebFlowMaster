import type { AccessibilityFinding } from '@shared/accessibility';
import type { DownloadFinding } from '@shared/downloads';
import { analyseFlow, leavesPageAlone } from '@shared/flow';
import type { LighthouseFinding, PerformanceFinding } from '@shared/web-performance';
import { Page } from 'playwright';
import { cleanupReportStep, runCleanups } from '../cleanup-runner';
import type { DebugHooks } from '../debug-session';
import { throwIfEgressDenied } from '../egress-policy';
import { FlowCursor } from '../flow-cursor';
import { recordRunnerFailure } from '../observability/taps/runner';
import { requestVariables, substituteVariables } from '../outbound-http';
import { runPreconditions } from '../precondition-runner';
import { resolveSequenceForRun } from '../step-elements';
import { executeStep } from '../step-executor';
import { expandSequenceForRun } from '../step-groups';
import { storage } from '../storage';
import { resolveVariables } from '../variables';

import {
  AUTHORING_USER_AGENT,
  browserForSetting,
  openBrowserSession,
  type BrowserSession,
} from '../browser-session';
import { describeBrowser } from '../browsers';
import type { ElementDetectionService } from './element-detection-service';
import { resolvedLogger } from './log';
import { datasetRows, evidenceScreenshot, runOverDataset } from './run-helpers';
import {
  DEFAULT_HEADLESS,
  DEFAULT_TIMEOUT,
  type AdhocSequencePayload,
  type DetectionResult,
  type StepResult,
  type TestStep,
} from './types';

export class AdhocRunner {
  constructor(private readonly detection: ElementDetectionService) {}

  async executeAdhocSequence(
    payload: AdhocSequencePayload,
    userId: number,
    debug?: DebugHooks,
  ): Promise<{
    success: boolean;
    steps?: StepResult[];
    error?: string;
    duration?: number;
    detection?: DetectionResult;
  }> {
    if (!payload.cleanups || payload.cleanups.length === 0)
      return this.runAdhocSequence(payload, userId, debug);
    // The cleanup runs once the steps are over — after every row, as a saved run does it — with
    // the variables each row ended with.
    const variableSets: Array<Record<string, string>> = [];
    const result = await this.runAdhocSequence(
      { ...payload, cleanups: null },
      userId,
      debug,
      variableSets,
    );
    const cleanup = await runCleanups(payload.cleanups, variableSets);
    return { ...result, steps: [...(result.steps ?? []), cleanupReportStep(cleanup)] };
  }

  private async runAdhocSequence(
    payload: AdhocSequencePayload,
    userId: number,
    debug?: DebugHooks,
    variableSets?: Array<Record<string, string>>,
  ): Promise<{
    success: boolean;
    steps?: StepResult[];
    error?: string;
    duration?: number;
    detection?: DetectionResult;
  }> {
    const testName = payload.name || 'Ad-hoc Test';
    resolvedLogger.http({
      message: 'PlaywrightService: executeAdhocSequence called',
      testName,
      userId,
      url: payload.url,
    });

    // Same rows, same loop, same labels as a saved run. A preview that runs once while the
    // saved test runs twenty is the same class of divergence as the two step executors:
    // it passes where the real thing fails.
    const adhocRows = datasetRows(payload);
    if (adhocRows) {
      const adhocStart = Date.now();
      const merged = await runOverDataset(adhocRows, (row) =>
        this.runAdhocSequence(
          { ...payload, dataset: null, rowVariables: row },
          userId,
          undefined,
          variableSets,
        ),
      );
      return { ...merged, duration: Date.now() - adhocStart };
    }
    // The preview resolves variables the same way a scheduled run does, so a test that
    // works here is not relying on something only this path provides.
    const vars = {
      ...(payload.organizationId
        ? await resolveVariables({
            userId,
            organizationId: payload.organizationId,
            environmentId: payload.environmentId,
          })
        : requestVariables()),
      // The dataset row for this pass, layered over the environment's values.
      ...(payload.rowVariables ?? {}),
    };
    variableSets?.push(vars);
    debug?.watch(vars);
    const targetUrl = payload.url ? substituteVariables(payload.url, vars) : payload.url;
    const startTime = Date.now();
    let session: BrowserSession | null = null;
    let page: Page | null = null;
    resolvedLogger.debug({ message: 'PS:executeAdhocSequence - Initial state', testName, userId });
    const stepResults: StepResult[] = [];
    let overallSuccess = true;
    /** Why a debug session ended the run early, when it did. */
    let debugStopped: string | undefined;

    // The preview expands step groups and custom actions exactly as a saved run does, and
    // like it before a browser is launched or a page loaded: a custom action called with a
    // missing or unknown argument, or a block that does not close, fails the test without
    // opening anything (collaudo WEB-36).
    const adhocExpansion = await expandSequenceForRun(payload.sequence);
    if (adhocExpansion.errors.length > 0) {
      return {
        success: false,
        steps: [],
        error: adhocExpansion.errors.join(' '),
        duration: Date.now() - startTime,
      };
    }
    const adhocSequence = (await resolveSequenceForRun(adhocExpansion.steps))
      .steps as unknown as TestStep[];
    // After expansion, so a block that opens in a group and closes in the test is judged
    // as the run will meet it.
    const adhocFlow = analyseFlow(adhocSequence);
    if (!adhocFlow.ok) {
      return {
        success: false,
        steps: [],
        error: adhocFlow.errors.join(' '),
        duration: Date.now() - startTime,
      };
    }

    try {
      // Preconditions run before the browser is even launched, exactly as the scheduled
      // runner does it (see test-execution-service). Fail-fast: a broken setup call makes
      // the run blocked, never a misleading pass or a confusing mid-sequence failure.
      if (payload.preconditions && payload.preconditions.length > 0) {
        const preResult = await runPreconditions(payload.preconditions, requestVariables());
        if (!preResult.ok) {
          const reason = `Precondition failed at "${preResult.failedAt}": ${preResult.reason}`;
          resolvedLogger.warn({
            message: 'PS:executeAdhocSequence - Blocked by precondition',
            testName,
            userId,
            failedAt: preResult.failedAt,
            reason: preResult.reason,
          });
          return {
            success: false,
            error: reason,
            duration: Date.now() - startTime,
            detection: undefined,
            steps: [
              {
                name: `Precondition: ${preResult.failedAt ?? 'setup'}`,
                type: 'precondition',
                status: 'failed',
                error: preResult.reason,
                details: reason,
              },
            ],
          };
        }
        // Counted separately on purpose. "3 setup calls completed" and "1 call made, 2 were
        // already in place" describe very different runs, and the second is the one that
        // explains why a test passed against a system somebody had already configured.
        const applied = preResult.ranCount;
        const already = preResult.satisfiedCount;
        const summary =
          already === 0
            ? `${applied} setup call(s) completed.`
            : `${applied} setup call(s) completed, ${already} already satisfied.`;
        stepResults.push({
          name: 'Preconditions',
          type: 'precondition',
          status: 'passed',
          details: preResult.steps.length
            ? `${summary} ${preResult.steps
                .map((s) => `${s.name}: ${s.status}${s.detail ? ` (${s.detail})` : ''}`)
                .join('; ')}`
            : summary,
        });
      }

      const userSettings = await storage.getUserSettings(userId);
      const headlessMode = userSettings?.playwrightHeadless ?? DEFAULT_HEADLESS;
      const pageTimeout = userSettings?.playwrightDefaultTimeout || DEFAULT_TIMEOUT;
      const browser = browserForSetting(userSettings?.playwrightBrowser, headlessMode);
      resolvedLogger.debug({
        message: 'PS:executeAdhocSequence - Effective settings',
        testName,
        browser: describeBrowser(browser),
        pageTimeout,
      });

      session = await openBrowserSession({
        browser,
        url: targetUrl,
        userAgent: AUTHORING_USER_AGENT,
        timeoutMs: pageTimeout,
      });
      page = session.page;
      resolvedLogger.debug({ message: 'PS:executeAdhocSequence - Browser session open', testName });

      if (targetUrl) {
        const gotoOptions = { waitUntil: 'domcontentloaded' as const };
        resolvedLogger.debug({
          message: `PS:executeAdhocSequence - Navigating to URL`,
          testName,
          url: targetUrl,
          options: gotoOptions,
          pageClosed: page?.isClosed(),
        });
        try {
          throwIfEgressDenied(await page.goto(targetUrl, gotoOptions));
          resolvedLogger.debug({
            message: 'PS:executeAdhocSequence - Navigation complete. Attempting screenshot...',
            testName,
          });
          const screenshotBuffer = await page.screenshot({ type: 'png' });
          const screenshot = screenshotBuffer.toString('base64');
          stepResults.push({
            name: 'Load Page',
            type: 'navigation',
            status: 'passed',
            screenshot: `data:image/png;base64,${screenshot}`,
            details: `Successfully navigated to ${payload.url}`,
          });
        } catch (e: any) {
          overallSuccess = false;
          resolvedLogger.error({
            message: `PS:executeAdhocSequence - ERROR during initial navigation`,
            testName,
            url: payload.url,
            error: e.message,
            stack: e.stack,
            pageClosed: page?.isClosed(),
          });
          const errorScreenshotBuffer = await page?.screenshot({ type: 'png' }).catch(() => null);
          const errorScreenshot = errorScreenshotBuffer?.toString('base64');
          stepResults.push({
            name: 'Load Page',
            type: 'navigation',
            status: 'failed',
            error: e.message,
            screenshot: errorScreenshot ? `data:image/png;base64,${errorScreenshot}` : undefined,
            details: `Failed to navigate to ${payload.url}: ${e.message}`,
          });
          const duration = Date.now() - startTime;
          let finalDetectionNavFail: DetectionResult | undefined;
          if (page && !page.isClosed()) {
            resolvedLogger.debug({
              message:
                'PS:executeAdhocSequence - Attempting element detection (due to navigation failure)',
              testName,
              pageClosed: page?.isClosed(),
            });
            try {
              finalDetectionNavFail = await this.detection.surveyPage(page);
            } catch (detectionError: any) {
              resolvedLogger.warn({
                message: `PS:executeAdhocSequence - Error during element detection (navigation fail path)`,
                testName,
                error: detectionError.message,
                stack: detectionError.stack,
              });
            }
          }
          return {
            success: false,
            steps: stepResults,
            error: `Initial navigation failed: ${e.message}`,
            duration,
            detection: finalDetectionNavFail,
          };
        }
      } else {
        stepResults.push({
          name: 'Initial State',
          type: 'setup',
          status: 'passed',
          details: 'No initial URL provided for ad-hoc sequence.',
        });
      }

      if (overallSuccess && adhocSequence.length > 0) {
        resolvedLogger.debug({
          message: `PS:executeAdhocSequence - Starting execution of ${adhocSequence.length} steps.`,
          testName,
        });
        const cursor = new FlowCursor(adhocSequence, adhocFlow.blocks, vars);
        // Debugging (server/debug-session.ts): a step corrected where it failed runs again as
        // corrected, and is not stopped at again on its way back in.
        const corrections = new Map<number, TestStep>();
        let retrying = false;
        const pageNow = {
          screenshot: async () => {
            if (!page || page.isClosed()) return null;
            const shot = await page.screenshot({ type: 'jpeg', quality: 60 });
            return `data:image/jpeg;base64,${shot.toString('base64')}`;
          },
          url: () => (page && !page.isClosed() ? page.url() : null),
        };
        while (!cursor.done) {
          let step = corrections.get(cursor.pc) ?? adhocSequence[cursor.pc];
          let corrected = corrections.has(cursor.pc);
          if (debug && !retrying) {
            const decision = await debug.beforeStep({ pc: cursor.pc, step, ...pageNow });
            if (decision.kind === 'stop') {
              overallSuccess = false;
              debugStopped = decision.reason;
              break;
            }
            if (decision.kind === 'skip') {
              await debug.record({
                name: step.action?.name || 'Unnamed Action',
                type: step.action?.id || 'unknown',
                stepId: step.id ?? null,
                status: 'skipped',
                detail: 'Passed over while debugging.',
                corrected: false,
              });
              cursor.advance({});
              continue;
            }
            step = decision.step;
            corrected = corrected || decision.corrected;
          }
          retrying = false;
          let flowOutcome: { condition?: boolean; iterations?: number } = {};
          let stepStatus: 'passed' | 'failed' = 'passed';
          let stepError: string | undefined;
          let stepScreenshot: string | undefined;
          let stepDetail: string | undefined;
          let stepAccessibility: AccessibilityFinding | undefined;
          let stepPerformance: PerformanceFinding | undefined;
          let stepLighthouse: LighthouseFinding | undefined;
          let stepDownload: DownloadFinding | undefined;
          const actionId = step.action?.id;
          const actionName = step.action?.name || 'Unnamed Action';
          resolvedLogger.verbose({
            message: `PS:executeAdhocSequence - LOOP START for step`,
            testName,
            actionName,
            actionId,
            pageClosed: page?.isClosed(),
          });

          try {
            if (!actionId) throw new Error('Step action ID is missing.');
            if (!page) throw new Error('Page is not available.');
            if (page.isClosed())
              throw new Error('Page was closed unexpectedly before step execution.');

            resolvedLogger.verbose({
              message: `PS:executeAdhocSequence - Executing step`,
              testName,
              actionName,
              actionId,
              selector: step.targetElement?.selector,
              value: step.value,
            });

            const outcome = await executeStep({ page, vars, startedAt: startTime }, step);
            flowOutcome = outcome;
            // A step that moved the test to another tab: every step after it, and this step's
            // screenshot, belong to that tab.
            if (outcome.page) page = outcome.page;
            if (outcome.status === 'failed') {
              stepStatus = 'failed';
              stepError = outcome.error;
            }
            // What the step did, when it is not the same as having succeeded. A setup step
            // that found the system already in the required state and one that changed it
            // both pass, and a report that renders them identically cannot answer the
            // question anyone asks of a precondition afterwards.
            stepDetail = outcome.detail;
            stepAccessibility = outcome.accessibility;
            stepPerformance = outcome.performance;
            stepLighthouse = outcome.lighthouse;
            stepDownload = outcome.download;
            if (!leavesPageAlone(actionId)) {
              // Let the UI settle before capturing: a click often dismisses a menu and opens a
              // dialog with an animation, and may fire XHRs. Without this the screenshot catches a
              // mid-transition frame (old menu overlapping a half-open dialog).
              await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
              await page.waitForTimeout(600);
              resolvedLogger.verbose({
                message: `PS:executeAdhocSequence - Taking screenshot for step`,
                testName,
                actionName,
                actionId,
              });
              const screenshotBuffer = await evidenceScreenshot(page, (reason) =>
                resolvedLogger.warn({
                  message: 'PS:executeAdhocSequence - No screenshot for step',
                  testName,
                  actionName,
                  reason,
                }),
              );
              stepScreenshot = screenshotBuffer
                ? `data:image/png;base64,${screenshotBuffer.toString('base64')}`
                : undefined;
              resolvedLogger.verbose({
                message: 'PS:executeAdhocSequence - Step screenshot taken',
                testName,
                actionName,
              });
            }
          } catch (e: any) {
            stepStatus = 'failed';
            stepError = e.message;
            overallSuccess = false;
            resolvedLogger.error({
              message: `PS:executeAdhocSequence - ERROR during step execution`,
              testName,
              actionName,
              actionId,
              error: e.message,
              stack: e.stack,
              pageClosed: page?.isClosed(),
            });
            if (page && !page.isClosed()) {
              resolvedLogger.debug({
                message: 'PS:executeAdhocSequence - Attempting error screenshot for failed step...',
                testName,
                actionName,
              });
              try {
                const errorScreenshotBuffer = await page.screenshot({ type: 'png' });
                stepScreenshot = `data:image/png;base64,${errorScreenshotBuffer.toString('base64')}`;
              } catch (screenError: any) {
                resolvedLogger.warn({
                  message: 'PS:executeAdhocSequence - Failed to take error screenshot for step',
                  testName,
                  actionName,
                  error: screenError.message,
                  stack: screenError.stack,
                });
              }
            }
          }
          if (stepStatus === 'failed') overallSuccess = false;

          if (debug && stepStatus === 'failed') {
            const decision = await debug.afterFailure({
              pc: cursor.pc,
              step,
              error: stepError || 'Unknown error',
              ...pageNow,
            });
            if (decision.kind === 'run') {
              // Tried again in the same place, corrected or not: the failure is no longer the
              // step's result, the next attempt is.
              corrections.set(cursor.pc, decision.step);
              retrying = true;
              overallSuccess = true;
              continue;
            }
            if (decision.kind === 'skip') {
              await debug.record({
                name: actionName,
                type: actionId || 'unknown',
                stepId: step.id ?? null,
                status: 'skipped',
                detail: `Failed, then passed over while debugging: ${stepError || 'Unknown error'}`,
                corrected,
              });
              overallSuccess = true;
              cursor.advance({});
              continue;
            }
            debugStopped = decision.reason;
          }
          await debug?.record({
            name: actionName,
            type: actionId || 'unknown',
            stepId: step.id ?? null,
            status: stepStatus,
            detail:
              stepStatus === 'passed'
                ? (stepDetail ?? 'Action executed successfully.')
                : stepError || 'Unknown error',
            corrected,
          });

          stepResults.push({
            name: actionName,
            type: actionId || 'unknown',
            selector: step.targetElement?.selector,
            value: step.value,
            status: stepStatus,
            screenshot: stepScreenshot,
            error: stepError,
            details:
              stepStatus === 'passed'
                ? (stepDetail ?? 'Action executed successfully.')
                : `Action failed: ${stepError || 'Unknown error'}`,
            accessibility: stepAccessibility,
            performance: stepPerformance,
            lighthouse: stepLighthouse,
            download: stepDownload,
          });
          if (!overallSuccess) {
            resolvedLogger.info({
              message: `PS:executeAdhocSequence - Step failed. Stopping sequence execution.`,
              testName,
              failedStep: actionName,
            });
            break;
          }
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

      const duration = Date.now() - startTime;
      resolvedLogger.info({
        message: `PS:executeAdhocSequence - Test completed.`,
        testName,
        overallSuccess,
        durationMs: duration,
        stepsExecuted: stepResults.length,
      });

      let finalDetection: DetectionResult | undefined;
      if (page && !page.isClosed()) {
        resolvedLogger.debug({
          message: 'PS:executeAdhocSequence - Attempting final element detection (success path)',
          testName,
          pageClosed: page?.isClosed(),
        });
        try {
          finalDetection = await this.detection.surveyPage(page);
        } catch (detectionError: any) {
          resolvedLogger.warn({
            message: `PS:executeAdhocSequence - Error during final element detection (success path)`,
            testName,
            error: detectionError.message,
            stack: detectionError.stack,
          });
        }
      }
      return {
        success: overallSuccess,
        steps: stepResults,
        duration,
        detection: finalDetection,
        ...(debugStopped ? { error: debugStopped } : {}),
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      resolvedLogger.error({
        message: `PS:executeAdhocSequence - CRITICAL ERROR in executeAdhocSequence`,
        testName,
        userId,
        error: error.message,
        stack: error.stack,
        sessionOpen: !!session,
        pageClosed: page?.isClosed(),
      });

      // A step that fails its assertion is a normal product outcome and never lands here;
      // this catch is reached only when the run itself could not be carried out.
      recordRunnerFailure({
        phase: 'adhoc-execution',
        error,
        context: { testName, url: payload.url, stepCount: payload.sequence?.length ?? 0 },
        userId,
      });
      let finalDetectionCriticalError: DetectionResult | undefined;
      if (page && !page.isClosed()) {
        resolvedLogger.debug({
          message: 'PS:executeAdhocSequence - Attempting element detection after critical error',
          testName,
          pageClosed: page?.isClosed(),
        });
        try {
          finalDetectionCriticalError = await this.detection.surveyPage(page);
        } catch (detectionError: any) {
          resolvedLogger.warn({
            message: `PS:executeAdhocSequence - Error during element detection (critical error path)`,
            testName,
            error: detectionError.message,
            stack: detectionError.stack,
          });
        }
      }
      return {
        success: false,
        steps: stepResults,
        error: error.message || 'Unknown critical error during ad-hoc execution',
        duration,
        detection: finalDetectionCriticalError,
      };
    } finally {
      await session?.close();
    }
  }
}
