import { createHash, randomUUID } from 'crypto';
import type { ReportModel, ReportResultModel } from './report-model';
import { describeCi } from '@shared/ci';
import type { ZipEntry } from './zip';

/**
 * A run as Allure results: the files `allure generate` and every Allure server read.
 *
 * Many QA teams already keep their history in Allure (Allure TestOps, a Jenkins or GitLab
 * plugin, an `allure serve` on someone's machine), and a run that could not be loaded there
 * was a run left out of it. What is written is Allure 2's result format. The historyId is stable
 * per test and browser, so Allure's own history, retries and flakiness work across runs.
 */

type AllureStatus = 'passed' | 'failed' | 'broken' | 'skipped' | 'unknown';

const ALLURE_SEVERITIES = new Set(['blocker', 'critical', 'normal', 'minor', 'trivial']);

/** Failed is the application disagreeing with the test; broken is the test never getting to ask. */
export function allureStatusFor(status: string): AllureStatus {
  switch (status) {
    case 'Passed':
      return 'passed';
    case 'Failed':
      return 'failed';
    case 'Skipped':
    case 'Pending':
      return 'skipped';
    case 'Error':
      return 'broken';
    default:
      return 'unknown';
  }
}

/** The same test on the same browser is the same Allure test from one run to the next. */
export function historyIdFor(planId: string, result: Pick<ReportResultModel, 'testName' | 'browser'>): string {
  return createHash('md5').update(`${planId}\u0000${result.testName}\u0000${result.browser ?? ''}`).digest('hex');
}

const time = (date: Date | null | undefined, fallback: number) => (date ? new Date(date).getTime() : fallback);

export interface AllureExportOptions {
  /** Screenshots to attach, by result id. */
  images?: Map<string, { bytes: Buffer; contentType: string }>;
  reportUrl?: string | null;
  /** For tests: fixed ids instead of random ones. */
  uuid?: () => string;
}

export function buildAllureResults(model: ReportModel, options: AllureExportOptions = {}): ZipEntry[] {
  const uuid = options.uuid ?? randomUUID;
  const files: ZipEntry[] = [];
  const runStart = time(model.startedAt, time(model.queuedAt, Date.now()));

  for (const result of model.results) {
    const id = uuid();
    const start = time(result.startedAt, runStart);
    const stop = time(result.completedAt, start + (result.durationMs ?? 0));
    const status = allureStatusFor(result.status);
    const labels = [
      { name: 'framework', value: 'webflowmaster' },
      { name: 'parentSuite', value: model.planName },
      { name: 'suite', value: result.module || model.planName },
      ...(result.component ? [{ name: 'subSuite', value: result.component }] : []),
      ...(result.module ? [{ name: 'feature', value: result.module }] : []),
      ...(result.component ? [{ name: 'story', value: result.component }] : []),
      ...(result.severity && ALLURE_SEVERITIES.has(result.severity.toLowerCase())
        ? [{ name: 'severity', value: result.severity.toLowerCase() }]
        : []),
      ...(model.runner ? [{ name: 'host', value: model.runner }] : []),
      { name: 'tag', value: result.testType === 'api' ? 'api' : 'ui' },
      ...(result.quarantined ? [{ name: 'tag', value: 'quarantined' }] : []),
    ];

    const attachments: Array<{ name: string; source: string; type: string }> = [];
    const image = options.images?.get(result.id);
    if (image) {
      const extension = image.contentType === 'image/jpeg' ? 'jpg' : 'png';
      const source = `${id}-attachment.${extension}`;
      files.push({ name: source, data: image.bytes });
      attachments.push({ name: 'Screenshot', source, type: image.contentType });
    }

    const failedStepIndex = result.steps.findIndex((step) => step.status === 'failed');
    const body = {
      uuid: id,
      historyId: historyIdFor(model.planId, result),
      testCaseId: historyIdFor(model.planId, { testName: result.testName, browser: null }),
      name: result.testName,
      fullName: `${model.planName} › ${result.testName}${result.browser ? ` [${result.browser}]` : ''}`,
      status,
      statusDetails: {
        ...(result.reason ? { message: result.reason } : {}),
        // Allure's own words for these two: a muted test's failure is shown and not counted,
        // which is what quarantine means; a flaky one passed only after being run again.
        ...(result.quarantined ? { muted: true } : {}),
        ...(result.attempts > 1 ? { flaky: true } : {}),
      },
      stage: 'finished',
      start,
      stop,
      labels,
      parameters: [
        ...(result.browser ? [{ name: 'browser', value: result.browser }] : []),
        ...(result.testVersion !== null ? [{ name: 'test version', value: String(result.testVersion) }] : []),
        ...(result.attempts > 1 ? [{ name: 'attempts', value: String(result.attempts) }] : []),
      ],
      links: options.reportUrl ? [{ name: 'WebFlowMaster report', url: options.reportUrl, type: 'link' }] : [],
      steps: result.steps.map((step, index) => ({
        name: step.name,
        status:
          step.status === 'failed'
            ? 'failed'
            : failedStepIndex !== -1 && index > failedStepIndex
              ? 'skipped'
              : 'passed',
        stage: 'finished',
        start,
        stop: start,
        ...(step.status === 'failed' && step.message ? { statusDetails: { message: step.message } } : {}),
        steps: [],
        attachments: [],
        parameters: [],
      })),
      attachments,
    };
    files.push({ name: `${id}-result.json`, data: Buffer.from(JSON.stringify(body, null, 2)) });
  }

  // Shown on the report's overview.
  const environment = [
    ['Plan', model.planName],
    ['Run', model.executionId],
    ['Status', model.status],
    ['Triggered by', model.trigger],
    ...(model.environment ? [['Environment', model.environment]] : []),
    ...(model.runner ? [['Runner', model.runner]] : []),
    ...(model.ci?.repository ? [['Repository', model.ci.repository]] : []),
    ...(model.ci?.commit ? [['Commit', model.ci.commit]] : []),
    ...(model.ci?.branch ? [['Branch', model.ci.branch]] : []),
  ]
    .map(([key, value]) => `${key.replace(/[=:\s]/g, '\\$&')}=${String(value).replace(/\n/g, ' ')}`)
    .join('\n');
  files.push({ name: 'environment.properties', data: Buffer.from(environment + '\n') });

  files.push({
    name: 'executor.json',
    data: Buffer.from(
      JSON.stringify({
        name: 'WebFlowMaster',
        type: 'webflowmaster',
        buildName: model.ci ? describeCi(model.ci) : `${model.planName} · ${model.executionId}`,
        ...(options.reportUrl ? { reportUrl: options.reportUrl } : {}),
        // The build that asked for the run when there was one; the report otherwise.
        ...(model.ci?.buildUrl ? { buildUrl: model.ci.buildUrl } : options.reportUrl ? { buildUrl: options.reportUrl } : {}),
      }),
    ),
  });

  // Allure groups failures by these, rather than lumping every red test together.
  files.push({
    name: 'categories.json',
    data: Buffer.from(
      JSON.stringify([
        { name: 'Accessibility violations', matchedStatuses: ['failed'], messageRegex: '.*accessibility violation.*' },
        { name: 'Visual differences', matchedStatuses: ['failed'], messageRegex: '.*[Vv]isual difference.*' },
        { name: 'Precondition failures', matchedStatuses: ['broken', 'skipped'], messageRegex: '.*[Pp]recondition.*' },
        { name: 'Test did not run', matchedStatuses: ['broken'] },
        { name: 'Application failures', matchedStatuses: ['failed'] },
      ]),
    ),
  });

  return files;
}
