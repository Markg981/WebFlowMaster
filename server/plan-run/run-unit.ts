/**
 * One test, on one browser: the unit lanes are made of (server/plan-run/lanes.ts).
 *
 * It takes its pass's captured variables rather than reaching for a shared object: two browsers
 * running the same flow each create their own records, and one pass reading the id the other
 * captured is how a parallel run quietly tests the wrong thing.
 */
import fs from 'fs-extra';
import path from 'path';
import type { ApiTest, Test } from '@shared/schema';
import { isManualSequence, manualStepsOf, type ManualResultLog } from '@shared/manual-tests';
import type { MobileResultLog } from '@shared/mobile';
import { describeNetworkFailures } from '@shared/network';
import { failedStepReason } from '../failed-step-reason';
import { toGridConfig } from '../browser-grids';
import { describeBrowser } from '../browsers';
import { mobileDeviceLabel, performMobileTest, type MobileOutcome } from '../mobile-runner';
import { stopReasonAfter } from '../run-policies';
import { refKey } from '../test-quarantine';
import { runTest, type IndividualTestRunResult } from '../run-test';
import type { AgentHttp } from '../agents/agent-fetch';
import { asResultsUrl, publishArtifacts } from './artifacts';
import { emit, report, type PlanRun } from './context';
import { referencedId, type FrozenTests, type MobileEntry, type Quarantined } from './definitions';
import type { RunInputs, RunVariables } from './inputs';
import type { RunUnit } from './lanes';
import { buildReportEntry, saveReportEntry, type UnitOutcome } from './report-entry';
import type { RunSettings } from './settings';

/** Everything a unit reads: what the phases before execution produced. */
export interface UnitScope {
  run: PlanRun;
  inputs: RunInputs;
  settings: RunSettings;
  variables: RunVariables;
  tests: FrozenTests;
  quarantined: Quarantined;
  agentHttp: AgentHttp | null;
}

/** Runs one unit and records its result. `sink` collects its entry of the legacy results list. */
export async function runUnit(
  scope: UnitScope,
  unit: RunUnit,
  captured: Record<string, string>,
  sink: IndividualTestRunResult[],
): Promise<void> {
  const { run, tests } = scope;
  const { browserChoice, locale, link, mobileTarget } = unit;
  const mobileBase =
    link.testType === 'mobile' && link.mobileTestId
      ? tests.mobile.get(link.mobileTestId)
      : undefined;
  const mobile = mobileBase
    ? { ...mobileBase, test: { ...mobileBase.test, ...mobileTarget } }
    : undefined;
  const definition = definitionFor(tests, unit);

  const startedAt = Date.now();
  const testName =
    definition?.name ||
    mobile?.test.name ||
    `Unknown Test (ID: ${link.testId || link.apiTestId || link.mobileTestId})`;
  const onBrowser =
    (browserChoice ? ` on ${describeBrowser(browserChoice)}` : '') +
    (locale ? ` in ${locale}` : '');
  const id = referencedId(link);
  // A plan policy, a cancellation or the time limit: either way this test does not start. Nor
  // does a test with no published version where the organization requires review.
  const notPublished = id ? tests.unpublished.get(`${link.testType}:${id}`) : undefined;
  const inQuarantine = !!id && scope.quarantined.has(refKey({ type: link.testType, id }));
  const haltedBy = run.stop.reason ?? run.watch.stopReason ?? notPublished;
  const datasetError =
    link.testType === 'ui' && link.testId ? tests.datasetErrors.get(link.testId) : undefined;
  if (!haltedBy)
    emit(run, {
      level: 'info',
      message: `Starting test: ${testName} (${link.testType})${onBrowser}`,
      timestamp: new Date(startedAt).toISOString(),
      metadata: {
        testId: link.testId || link.apiTestId || link.mobileTestId,
        testType: link.testType,
        browser: browserChoice?.label,
        locale,
      },
    });

  const context: UnitContext = {
    scope,
    unit,
    captured,
    sink,
    testName,
    onBrowser,
    inQuarantine,
    startedAt,
  };
  const outcome = await outcomeOf(context, { haltedBy, datasetError, definition, mobile });

  await saveReportEntry(
    run.logger,
    scope.inputs.snapshot,
    buildReportEntry({
      organizationId: scope.inputs.organizationId,
      executionId: run.executionId,
      unit,
      testName,
      definition,
      mobile,
      versions: tests.versions,
      inQuarantine,
      outcome,
      startedAt,
      completedAt: Date.now(),
    }),
  );
}

interface UnitContext {
  scope: UnitScope;
  unit: RunUnit;
  captured: Record<string, string>;
  sink: IndividualTestRunResult[];
  testName: string;
  onBrowser: string;
  inQuarantine: boolean;
  startedAt: number;
}

/** Runs the unit, or says why it does not run. */
async function outcomeOf(
  context: UnitContext,
  found: {
    haltedBy: string | undefined;
    datasetError: string | undefined;
    definition: Test | ApiTest | undefined;
    mobile: MobileEntry | undefined;
  },
): Promise<UnitOutcome> {
  const { link } = context.unit;
  const { haltedBy, datasetError, definition } = found;
  // Stopped before it started; recorded with the reason.
  if (haltedBy) return { status: 'Skipped', failureReason: haltedBy };
  if (datasetError !== undefined) return { status: 'Error', failureReason: datasetError };
  if (link.testType === 'mobile') return runMobile(context, found.mobile);
  if (!definition) return missingDefinition(context);
  if (
    link.testType === 'ui' &&
    (definition as Test).bdd?.mode !== 'cucumber' &&
    isManualSequence((definition as Test).sequence)
  )
    return manualOutcome(context.scope.run, definition as Test, context.testName, link.testId);
  return runDefinition(context, definition, link.testType);
}

/** The UI or API definition a unit runs; for one row of a cucumber dataset, that row alone. */
function definitionFor(
  tests: FrozenTests,
  { link, bddRowIndex }: RunUnit,
): Test | ApiTest | undefined {
  if (link.testId && link.testType === 'ui') {
    const test = tests.ui.get(link.testId);
    if (!test || bddRowIndex === undefined) return test;
    const dataset = test.dataset;
    if (
      test.bdd?.mode !== 'cucumber' ||
      !Array.isArray(dataset) ||
      !Number.isInteger(bddRowIndex) ||
      bddRowIndex < 0 ||
      bddRowIndex >= dataset.length
    )
      throw new Error('The selected BDD dataset row is unavailable.');
    return {
      ...test,
      dataset: [dataset[bddRowIndex]],
      name: `${test.name} — Row ${bddRowIndex + 1}`,
    };
  }
  if (link.apiTestId && link.testType === 'api') return tests.api.get(link.apiTestId);
  return undefined;
}

/**
 * A manual test: no browser. It waits in the report for somebody's verdict, with the steps of
 * the version that ran, so a later edit does not change what was asked.
 */
function manualOutcome(
  run: PlanRun,
  test: Test,
  testName: string,
  testId: number | null,
): UnitOutcome {
  const log: ManualResultLog = { manual: true, steps: manualStepsOf(test.sequence) };
  emit(run, {
    level: 'info',
    message: `Manual test: ${testName} is waiting for its result in the run report.`,
    metadata: { testId, manual: true },
  });
  return { status: 'Pending', detailedLog: JSON.stringify(log) };
}

/** A mobile app test: once per run, on a device of the grid it names (server/mobile-runner.ts). */
async function runMobile(
  context: UnitContext,
  mobile: MobileEntry | undefined,
): Promise<UnitOutcome> {
  const { scope, unit, captured, testName, inQuarantine, startedAt } = context;
  const { run, settings, variables } = scope;
  if (!mobile)
    return {
      status: 'Error',
      failureReason: 'Mobile test not found: it was deleted after the run was planned.',
    };
  if ('preparationError' in mobile.test && mobile.test.preparationError)
    return { status: 'Error', failureReason: String(mobile.test.preparationError) };
  if (!mobile.grid)
    return {
      status: 'Error',
      failureReason: `${mobile.test.name} names no grid to run on. Choose a BrowserStack or LambdaTest grid in the test's settings.`,
    };

  const grid = await toGridConfig(mobile.grid);
  const attemptOnce = () =>
    performMobileTest(
      mobile.test,
      grid,
      variables.forPass(captured),
      `WebFlowMaster · ${run.planId} · ${run.executionId.slice(0, 8)}`,
    );
  let attempts = 1;
  let outcome: MobileOutcome = await attemptOnce();
  while (
    outcome.status !== 'passed' &&
    attempts <= settings.policies.testReruns &&
    !run.watch.stopReason
  ) {
    attempts += 1;
    emit(run, {
      level: 'warn',
      message: `${testName} ${outcome.status}; running it again (attempt ${attempts} of ${settings.policies.testReruns + 1}).`,
      metadata: { attempt: attempts },
    });
    outcome = await attemptOnce();
  }
  const status =
    outcome.status === 'passed' ? 'Passed' : outcome.status === 'failed' ? 'Failed' : 'Error';
  const log: MobileResultLog = {
    mobile: true,
    device: mobileDeviceLabel(mobile.test),
    platform: mobile.test.platform,
    sessionUrl: outcome.sessionUrl,
    matrixEvidence: outcome.matrixEvidence,
    steps: outcome.steps,
  };
  let screenshotUrl: string | undefined;
  if (outcome.screenshot) {
    const dir = path.join(
      './results',
      run.planId,
      run.executionId,
      `mobile_${mobile.test.id}`,
      mobile.test.deviceMatrix?.length ? (unit.mobileTarget?.key ?? 'device-0') : '',
    );
    try {
      await fs.ensureDir(dir);
      const file = path.join(dir, 'final.png');
      await fs.writeFile(file, Buffer.from(outcome.screenshot, 'base64'));
      await publishArtifacts(dir, run.executionId);
      screenshotUrl = asResultsUrl(file);
    } catch (error: unknown) {
      run.logger.warn({
        message: 'Could not store a mobile test screenshot',
        error: (error as Error)?.message ?? String(error),
      });
    }
  }
  const reasonToStop = inQuarantine
    ? null
    : stopReasonAfter(
        {
          testName,
          status: outcome.status,
          cause: outcome.steps.some((step) => step.status === 'failed') ? 'step' : 'other',
        },
        settings.policies,
      );
  if (reasonToStop) await run.stop.stop(reasonToStop);
  emit(run, {
    level: status === 'Passed' ? 'info' : 'error',
    message: `Finished test: ${testName} on ${log.device}. Status: ${status} (${Date.now() - startedAt}ms)`,
    metadata: { status, device: log.device },
  });
  return {
    status,
    failureReason: outcome.error ?? undefined,
    attempts,
    screenshotUrl,
    detailedLog: JSON.stringify(log),
  };
}

/** A UI or API test, through runTest, re-run on failure as the plan says. */
async function runDefinition(
  context: UnitContext,
  definition: Test | ApiTest,
  testType: 'ui' | 'api',
): Promise<UnitOutcome> {
  const { scope, unit, captured, sink, testName, onBrowser, inQuarantine, startedAt } = context;
  const { run, inputs, settings, variables, agentHttp } = scope;
  const { policies } = settings;
  if (testType === 'ui') parseTextColumns(run, definition as Test);

  // API tests still have their `{{KEY}}` placeholders substituted into the request
  // object up front: the API runner has no per-field resolution step to hand a variable
  // map to. UI tests no longer need it — the shared step executor resolves them from the
  // same map — and doing both would hide an unresolved name instead of reporting it.
  const test =
    testType === 'api' && Object.keys(variables.secrets).length > 0
      ? (injectSecretsIntoTest(definition, variables.secrets) as ApiTest)
      : definition;

  const attemptOnce = () =>
    runTest(
      test,
      run.userId,
      run.planId,
      run.executionId,
      testType,
      variables.forPass(captured),
      variables.environment,
      {
        browser: unit.browserChoice,
        locale: unit.locale,
        visual:
          settings.visual.enabled && testType === 'ui'
            ? {
                organizationId: inputs.organizationId,
                updateBaselines: settings.visual.updateBaselines,
              }
            : undefined,
        evidence: settings.evidence,
        runtime: policies.step,
        onPreconditionFailure: policies.onPreconditionFailure,
        signal: run.watch.signal,
        http: agentHttp?.fetch,
      },
    );
  let attempts = 1;
  let result = await attemptOnce();
  // "Re-Run On Failure": a test that failed or errored is run again, up to the plan's
  // number, and the last attempt is its result. A skip is a decision, not a failure, and is
  // not re-run. The attempts are recorded on the result, so a test that needed two to pass
  // is visibly flaky rather than indistinguishable from one that passed first time.
  while (
    (result.status === 'failed' || result.status === 'error') &&
    attempts <= policies.testReruns &&
    // A test cut short because the run is stopping is not a failure to try again.
    !run.watch.stopReason
  ) {
    attempts += 1;
    emit(run, {
      level: 'warn',
      message: `${testName}${onBrowser} ${result.status}; running it again (attempt ${attempts} of ${policies.testReruns + 1}).`,
      metadata: { attempt: attempts },
    });
    result = await attemptOnce();
  }
  // Live captures below remain available to subsequent requests.
  sink.push(result.protocol ? { ...result, extracted: result.protocol.extracted } : result);

  // Once its last attempt is over, the test's evidence goes where the report is served
  // from. Per test rather than at the end, so a report opened while the run goes on shows
  // the pictures of what has finished.
  if (result.artifactDir) await publishArtifacts(result.artifactDir, run.executionId);

  // A quarantined test's failure does not stop the plan: stopping on it would be failing
  // the run by another route.
  const reasonToStop = inQuarantine
    ? null
    : stopReasonAfter(
        {
          testName,
          status: result.status,
          cause: result.blockedByPrecondition
            ? 'precondition'
            : // The cleanup's line is not one of the test's steps: it never decides why a test stopped.
              result.steps?.some((step) => step.status === 'failed' && step.type !== 'cleanup')
              ? 'step'
              : 'other',
        },
        policies,
      );
  if (reasonToStop) await run.stop.stop(reasonToStop);

  if (result.extracted) Object.assign(captured, result.extracted);
  // Surfaced on the run's console rather than only in the result blob: an extraction
  // that found nothing is the reason the *next* test fails, and reading that in the
  // right order is the difference between a five-minute diagnosis and an hour's.
  for (const failure of result.extractionErrors ?? []) {
    report(run, {
      level: 'warn',
      message:
        `Could not capture "${failure.name}" from ${testName}: ${failure.reason}. ` +
        `Later requests using {{${failure.name}}} will fail.`,
      metadata: { testId: result.testId, variable: failure.name },
    });
  }

  const status = REPORT_STATUS[result.status];
  const durationMs = Date.now() - startedAt;
  emit(run, {
    level: status === 'Passed' ? 'info' : 'error',
    message: `Finished test: ${testName}. Status: ${status} (${durationMs}ms)`,
    metadata: { durationMs, status },
  });
  // A failed test whose page saw server errors: said next to the failure, because it is
  // the likeliest reason and the screenshot cannot show it.
  const networkNote =
    status !== 'Passed' && result.network ? describeNetworkFailures(result.network) : null;
  if (networkNote) {
    emit(run, {
      level: 'warn',
      message: `${testName}${onBrowser}: ${networkNote}`,
      metadata: { failedRequests: result.network!.failed },
    });
  }

  return {
    status,
    failureReason: result.error || failedStepReason(result.status, result.steps),
    attempts,
    screenshotUrl: asResultsUrl(result.screenshotPath),
    videoUrl: asResultsUrl(result.videoPath),
    traceUrl: asResultsUrl(result.tracePath),
    harUrl: asResultsUrl(result.harPath),
    network: result.network,
    detailedLog: detailedLogOf(result),
  };
}

const REPORT_STATUS = {
  passed: 'Passed',
  failed: 'Failed',
  error: 'Error',
  skipped: 'Skipped',
} as const satisfies Record<IndividualTestRunResult['status'], UnitOutcome['status']>;

/** What the report shows for a UI or API result: its steps, or its protocol and performance. */
function detailedLogOf(result: IndividualTestRunResult): string | undefined {
  if (result.bdd) return JSON.stringify({ bdd: result.bdd, steps: result.steps ?? [] });
  if (result.steps) return JSON.stringify(result.steps);
  if (result.performance || result.protocol)
    return JSON.stringify({
      api: true,
      ...(result.performance ? { performance: result.performance } : {}),
      ...(result.protocol ? { protocol: result.protocol } : {}),
    });
  return undefined;
}

/** A UI test's sequence and elements, when they came back from the database as text. */
function parseTextColumns(run: PlanRun, test: Test): void {
  if (typeof test.sequence === 'string') {
    try {
      test.sequence = JSON.parse(test.sequence);
    } catch {
      run.logger.warn('Failed to parse UI test sequence');
    }
  }
  if (typeof test.elements === 'string') {
    try {
      test.elements = JSON.parse(test.elements);
    } catch {
      run.logger.warn('Failed to parse UI test elements');
    }
  }
}

/** A unit whose test is gone, or whose kind does not match its link. */
function missingDefinition({ scope, unit, sink }: UnitContext): UnitOutcome {
  const { link } = unit;
  scope.run.logger.warn({
    message: `Test object not found or type mismatch for link`,
    testType: link.testType,
    testId: link.testId ?? link.apiTestId,
  });
  const failureReason = 'Test definition not found or type mismatch during plan execution.';
  sink.push({
    testId: link.testId || link.apiTestId || -1,
    testType: link.testType as 'ui' | 'api',
    name: `Unknown Test (ID: ${link.testId || link.apiTestId})`,
    success: false,
    status: 'error',
    error: failureReason,
    durationMs: 0,
  });
  return { status: 'Error', failureReason };
}

/** Replaces `{{SECRET_KEY}}` in every string of a test, on a deep copy. */
function injectSecretsIntoTest(value: unknown, secrets: Record<string, string>): unknown {
  if (typeof value === 'string')
    return value.replace(/\{\{([^}]+)\}\}/g, (match, keyName: string) =>
      secrets[keyName] !== undefined ? secrets[keyName] : match,
    );
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => injectSecretsIntoTest(item, secrets));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, injectSecretsIntoTest(item, secrets)]),
  );
}
