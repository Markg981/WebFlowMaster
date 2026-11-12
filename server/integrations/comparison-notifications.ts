import { eq } from 'drizzle-orm';
import { testPlans, type ComparisonRun } from '@shared/schema';
import { COMPARISON_RESULT_VERDICTS } from '@shared/comparison';
import logger from '../platform/logger';
import { withTenantTransaction } from '../platform/middleware/tenancy';
import { comparisonPathFor, comparisonUrlFor } from '../platform/report-links';
import { comparisonFinishedMail } from '../messaging/mail-messages';
import { mailRunFinished } from './run-mail';
import { attemptDelivery, recordDelivery } from './deliveries';
import {
  mergeNotificationSettings,
  nativeMessage,
  shouldNotify,
  type RunStatus,
  type Tone,
} from './notifications';

/**
 * One notification per comparison, when it ends: its two runs say nothing themselves
 * (`asComparisonRun` in server/execution/execution-snapshot.ts), so a comparison is announced
 * once, with its verdict, instead of twice with two numbers nobody can put side by side.
 *
 * It answers to the plan's notification settings like a run does. Parity is a pass, regressions
 * and an inconclusive comparison are a failure, an error is "not executed". A cancelled comparison
 * is not announced, as a stopped run is not unless somebody asked.
 */

/** The run status whose switches a comparison's end answers to. */
export function comparisonRunStatus(
  comparison: Pick<ComparisonRun, 'status' | 'verdict'>,
): RunStatus | null {
  if (comparison.status === 'error') return 'error';
  if (comparison.status === 'cancelled') return 'cancelled';
  if (comparison.status !== 'completed') return null;
  return comparison.verdict === 'parity' || comparison.verdict === 'parity_with_accepted'
    ? 'completed'
    : 'failed';
}

const OUTCOME_WORDS: Record<string, string> = {
  parity: 'parity',
  parity_with_accepted: 'parity with accepted differences',
  regressions: 'REGRESSIONS',
  inconclusive: 'inconclusive',
};

function outcomeOf(comparison: ComparisonRun): string {
  if (comparison.status === 'error') return 'could not compare';
  return (comparison.verdict && OUTCOME_WORDS[comparison.verdict]) ?? comparison.status;
}

/** What the comparison is called in one line: the plan, the two sides, the verdict, the counts. */
export function comparisonLine(comparison: ComparisonRun, planName: string): string {
  const name = comparison.name ? ` (${comparison.name})` : '';
  const sides = `${comparison.baselineEnvironmentName} → ${comparison.candidateEnvironmentName}`;
  const counts = COMPARISON_RESULT_VERDICTS.map(
    (verdict) => [verdict, comparison.summary?.byVerdict?.[verdict] ?? 0] as const,
  )
    .filter(([, n]) => n > 0)
    .map(([verdict, n]) => `${n} ${verdict.replace(/_/g, ' ')}`)
    .join(', ');
  const failure =
    comparison.status === 'error' && comparison.failureMessage
      ? ` — ${comparison.failureMessage.slice(0, 300)}`
      : '';
  const tail = comparison.status === 'completed' ? ` — ${counts || 'no tests compared'}` : failure;
  return `${planName}${name}, ${sides}: ${outcomeOf(comparison)}${tail}.`;
}

/** The POST body: `text` for Slack and Teams, the numbers for a receiver that wants them. */
export function buildComparisonPayload(
  comparison: ComparisonRun,
  planName: string,
  webhookUrl?: string,
): Record<string, unknown> {
  const url = comparisonUrlFor(comparison.id);
  const line = comparisonLine(comparison, planName);
  const status = comparisonRunStatus(comparison);
  const tone: Tone = status === 'completed' ? 'good' : 'bad';
  const facts: Array<[string, string]> = [
    ['Baseline', comparison.baselineEnvironmentName],
    ['Candidate', comparison.candidateEnvironmentName],
  ];
  if (comparison.summary) {
    facts.push(['Tests compared', String(comparison.summary.total)]);
    for (const verdict of COMPARISON_RESULT_VERDICTS) {
      const n = comparison.summary.byVerdict?.[verdict] ?? 0;
      if (n > 0) facts.push([verdict.replace(/_/g, ' '), String(n)]);
    }
  }
  return {
    ...nativeMessage(webhookUrl, { line, facts, tone, url, action: 'Open parity report' }),
    text: line + (url ? ` ${url}` : ''),
    event: 'comparison.completed',
    status: comparison.status,
    testPlan: { id: comparison.testPlanId, name: planName },
    comparison: {
      id: comparison.id,
      name: comparison.name ?? null,
      status: comparison.status,
      verdict: comparison.verdict ?? null,
      baseline: {
        environmentName: comparison.baselineEnvironmentName,
        runId: comparison.baselineExecutionId ?? null,
      },
      candidate: {
        environmentName: comparison.candidateEnvironmentName,
        runId: comparison.candidateExecutionId ?? null,
      },
      summary: comparison.summary
        ? { total: comparison.summary.total, byVerdict: comparison.summary.byVerdict }
        : null,
      failure:
        comparison.status === 'error'
          ? { code: comparison.failureCode ?? null, message: comparison.failureMessage ?? null }
          : null,
      url: url ?? null,
      reportPath: comparisonPathFor(comparison.id),
    },
    report: { url: url ?? null, path: comparisonPathFor(comparison.id) },
  };
}

/**
 * Tells whoever the plan named that the comparison is over. Never throws: the verdict is written,
 * and a mail server or an endpoint that refuses must not turn it into a failed step.
 */
export async function notifyComparisonFinished(comparison: ComparisonRun): Promise<void> {
  const context = { comparisonId: comparison.id };
  try {
    const status = comparisonRunStatus(comparison);
    if (status !== 'completed' && status !== 'failed' && status !== 'error') return;

    const [plan] = await withTenantTransaction((tx) =>
      tx
        .select({ name: testPlans.name, notificationSettings: testPlans.notificationSettings })
        .from(testPlans)
        .where(eq(testPlans.id, comparison.testPlanId))
        .limit(1),
    );
    if (!plan) return;
    const settings = mergeNotificationSettings(plan.notificationSettings);
    const line = comparisonLine(comparison, plan.name);
    const url = comparisonUrlFor(comparison.id);

    try {
      const outcomes = await mailRunFinished(
        settings,
        comparison.requestedByUserId,
        {
          planId: comparison.testPlanId,
          planName: plan.name,
          // Which run the organization is read from; the plan when neither side started.
          executionId: comparison.candidateExecutionId ?? comparison.baselineExecutionId ?? '',
          status,
          totalTests: comparison.summary?.total ?? 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          durationMs: 0,
          triggeredBy: 'comparison',
        },
        (to, organizationId) =>
          comparisonFinishedMail(
            to,
            { planName: plan.name, outcome: outcomeOf(comparison), line, url },
            organizationId,
          ),
      );
      for (const outcome of outcomes)
        if (!outcome.sent)
          logger.warn({
            message: `Comparison notification not e-mailed to ${outcome.to}: ${outcome.error}`,
            ...context,
          });
    } catch (error: any) {
      logger.warn({
        message: `Comparison notification e-mail could not be attempted: ${error?.message ?? error}`,
        ...context,
      });
    }

    const webhookUrl = settings.webhookUrl?.trim();
    if (!shouldNotify(settings, status) || !webhookUrl) return;
    if (!/^https?:\/\//i.test(webhookUrl)) {
      logger.warn({
        message: 'Notification webhook URL must start with http:// or https://.',
        ...context,
      });
      return;
    }
    // A delivery belongs to a run, which is where its state is shown and what a retention sweep
    // removes it with: the candidate's, or the baseline's when the candidate never started.
    const executionId = comparison.candidateExecutionId ?? comparison.baselineExecutionId;
    if (!executionId) {
      logger.warn({
        message: 'The comparison ended before either run started: no webhook to record it on.',
        ...context,
      });
      return;
    }
    const deliveryId = await recordDelivery({
      organizationId: comparison.organizationId,
      executionId,
      kind: 'webhook',
      endpoint: webhookUrl,
      payload: buildComparisonPayload(comparison, plan.name, webhookUrl),
    });
    const outcome = await attemptDelivery(deliveryId);
    if (outcome !== 'sent')
      logger.warn({
        message:
          outcome === 'failed'
            ? 'Comparison notification could not be delivered.'
            : 'Comparison notification not delivered yet: it will be retried.',
        ...context,
      });
  } catch (error: any) {
    logger.warn({
      message: `Comparison notification could not be attempted: ${error?.message ?? error}`,
      ...context,
    });
  }
}
