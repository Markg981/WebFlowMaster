import { fetchTarget } from '../platform/outbound-http';
import { reportPathFor, reportUrlFor } from '../platform/report-links';
import { describeCi, type CiContext } from '@shared/ci';

/**
 * Telling somebody the run finished.
 *
 * `test_plans.notification_settings` and `test_plan_schedules.notification_config_override`
 * have been written by the plan wizard and the schedule form since they existed, and read by
 * nothing: a nightly plan configured to notify on failure failed quietly, and the only way to
 * learn that was to go and look — which is the thing a scheduled run exists to avoid.
 *
 * The channel is an outgoing webhook, which Slack and Microsoft Teams both accept in the
 * shape below (with their native card format added when the address is theirs, see
 * `nativeFormat`), and so does anything else that can receive a POST. The wizard's existing
 * switches say *when*; the URL says *where*, and was the part nothing ever collected.
 */

/** How long to wait for the receiving end before giving up on it. */
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * The plan's stored settings, plus the schedule's override.
 *
 * `passed`/`failed`/`notExecuted`/`stopped` are the wizard's four switches.
 * `onSuccess`/`onFailure` are the names the schedule form's own tooltip has always
 * suggested, so a schedule written to that example keeps working.
 */
export interface NotificationSettings {
  passed?: boolean;
  failed?: boolean;
  notExecuted?: boolean;
  stopped?: boolean;
  onSuccess?: boolean;
  onFailure?: boolean;
  webhookUrl?: string | null;
  /** Mailed when the installation has SMTP (server/integrations/run-mail.ts); otherwise reported — see `describeUnsupported`. */
  emails?: string[] | null;
}

export type RunStatus =
  'completed' | 'failed' | 'error' | 'queued' | 'running' | 'timed_out' | string;

export interface RunSummary {
  planId: string;
  planName: string;
  executionId: string;
  status: RunStatus;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  /** Of the failures, those of tests in quarantine: they did not decide the verdict. */
  quarantinedFailures?: number;
  durationMs: number;
  triggeredBy: string;
  /** The browsers this run covered, so a notification says which matrix produced the number. */
  browsers?: string[];
  /** The build that asked for the run, when a pipeline did: which commit broke is the first question. */
  ci?: CiContext | null;
}

export interface NotificationResult {
  delivered: boolean;
  /** Why nothing was sent, when nothing was sent. Not an error: usually it is a choice. */
  reason?: string;
  error?: string;
}

/**
 * The schedule's word over the plan's, key by key.
 *
 * A schedule that overrides only the destination keeps the plan's choice of when, which is
 * what "override" means to the person filling in the form — not "replace everything".
 */
export function mergeNotificationSettings(
  planSettings: unknown,
  scheduleOverride?: unknown,
): NotificationSettings {
  const plan = isRecord(planSettings) ? (planSettings as NotificationSettings) : {};
  const override = isRecord(scheduleOverride) ? (scheduleOverride as NotificationSettings) : {};
  return { ...plan, ...override };
}

/**
 * Which of the wizard's four switches a finished run answers to.
 *
 * `error` is a run that could not produce results — a browser that would not start, a
 * results directory that could not be written — which is what "not executed" names.
 */
export function switchForStatus(
  status: RunStatus,
): 'passed' | 'failed' | 'notExecuted' | 'stopped' | null {
  switch (status) {
    case 'completed':
      return 'passed';
    // A run that ran out of time did not pass, and somebody who asked to hear about failures
    // wants to hear about this one — it is the failure that took longest to notice.
    case 'failed':
    case 'timed_out':
      return 'failed';
    case 'error':
      return 'notExecuted';
    case 'stopped':
    case 'cancelled':
      return 'stopped';
    default:
      return null;
  }
}

/**
 * Whether this outcome is one the configuration asked to hear about.
 *
 * Silence is the default for a status nobody expressed a view on: a run that is still
 * pending has not finished, and a plan whose settings are empty was never configured to
 * notify at all.
 */
export function shouldNotify(settings: NotificationSettings, status: RunStatus): boolean {
  const which = switchForStatus(status);
  if (!which) return false;
  if (which === 'passed' && settings.onSuccess !== undefined) return settings.onSuccess === true;
  if (which === 'failed' && settings.onFailure !== undefined) return settings.onFailure === true;
  return settings[which] === true;
}

/** What the run is called in one line — the first thing a reader sees in Slack or Teams. */
export function summaryLine(summary: RunSummary): string {
  const verdict =
    summary.status === 'completed'
      ? 'passed'
      : summary.status === 'failed'
        ? 'FAILED'
        : summary.status === 'error'
          ? 'could not run'
          : summary.status;
  const counts =
    summary.totalTests > 0
      ? `${summary.passedTests}/${summary.totalTests} passed` +
        (summary.failedTests > 0 ? `, ${summary.failedTests} failed` : '') +
        // "passed — 2 failed" reads as a contradiction without this.
        (summary.quarantinedFailures ? ` (${summary.quarantinedFailures} in quarantine)` : '') +
        (summary.skippedTests > 0 ? `, ${summary.skippedTests} skipped` : '')
      : 'no tests ran';
  const browsers = summary.browsers?.length ? ` on ${summary.browsers.join(', ')}` : '';
  const trigger = summary.ci ? describeCi(summary.ci) : summary.triggeredBy;
  return `${summary.planName}: ${verdict} — ${counts}${browsers} (${formatDuration(summary.durationMs)}, ${trigger}).`;
}

/**
 * The POST body.
 *
 * `text` is there because that single field is what Slack and Teams both render; everything
 * else is there for a receiver that wants the numbers rather than the sentence.
 */
export function buildPayload(summary: RunSummary, webhookUrl?: string): Record<string, unknown> {
  const url = reportUrl(summary.planId, summary.executionId);
  const native = nativeFormat(webhookUrl);
  return {
    ...(native === 'slack' ? slackMessage(summary, url) : {}),
    ...(native === 'teams' ? teamsMessage(summary, url) : {}),
    text: summaryLine(summary) + (url ? ` ${url}` : ''),
    event: 'test_plan_execution.completed',
    status: summary.status,
    testPlan: { id: summary.planId, name: summary.planName },
    execution: {
      id: summary.executionId,
      status: summary.status,
      totalTests: summary.totalTests,
      passedTests: summary.passedTests,
      failedTests: summary.failedTests,
      skippedTests: summary.skippedTests,
      quarantinedFailures: summary.quarantinedFailures ?? 0,
      durationMs: summary.durationMs,
      triggeredBy: summary.triggeredBy,
      browsers: summary.browsers ?? [],
      ci: summary.ci ?? null,
      url,
      // The page's path, there even when the installation has not been told its address.
      reportPath: reportPathFor(summary.planId, summary.executionId) ?? null,
    },
    report: { url: url ?? null, path: reportPathFor(summary.planId, summary.executionId) ?? null },
  };
}

/**
 * Which native message format the receiving end understands, from its address.
 *
 * `text` alone renders as one grey line in both apps. Slack's incoming webhooks and Teams'
 * (the Workflows/Power Automate ones and the older Office 365 connectors) each have a richer
 * format: a coloured verdict, the numbers laid out, a button to the report. Anything else gets
 * the plain payload, unchanged.
 */
export function nativeFormat(webhookUrl: string | undefined): 'slack' | 'teams' | null {
  let host: string;
  try {
    host = new URL(webhookUrl ?? '').hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === 'hooks.slack.com') return 'slack';
  if (
    host.endsWith('.webhook.office.com') ||
    host === 'outlook.office.com' ||
    host.endsWith('.logic.azure.com') ||
    host.endsWith('.powerplatform.com') ||
    host.endsWith('.powerautomate.com')
  )
    return 'teams';
  return null;
}

type Tone = 'good' | 'bad' | 'neutral';

function toneOf(status: RunStatus): Tone {
  const which = switchForStatus(status);
  return which === 'passed'
    ? 'good'
    : which === 'failed' || which === 'notExecuted'
      ? 'bad'
      : 'neutral';
}

/** The numbers both formats lay out, as label/value pairs. */
function facts(summary: RunSummary): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Passed', `${summary.passedTests}/${summary.totalTests}`],
    ['Failed', String(summary.failedTests)],
  ];
  if (summary.quarantinedFailures)
    rows.push(['In quarantine', String(summary.quarantinedFailures)]);
  if (summary.skippedTests) rows.push(['Skipped', String(summary.skippedTests)]);
  rows.push(['Duration', formatDuration(summary.durationMs)]);
  if (summary.browsers?.length) rows.push(['Browsers', summary.browsers.join(', ')]);
  rows.push(['Triggered by', summary.ci ? describeCi(summary.ci) : summary.triggeredBy]);
  return rows;
}

/** Slack Block Kit inside an attachment, which is what draws the coloured bar. */
function slackMessage(summary: RunSummary, url: string | undefined): Record<string, unknown> {
  const color = { good: '#2eb67d', bad: '#e01e5a', neutral: '#868686' }[toneOf(summary.status)];
  // Slack's mrkdwn treats &, < and > as markup; a plan name is the user's text.
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${escape(summaryLine(summary))}*` } },
    {
      type: 'section',
      fields: facts(summary).map(([label, value]) => ({
        type: 'mrkdwn',
        text: `*${label}*\n${escape(value)}`,
      })),
    },
  ];
  if (url) {
    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open report' }, url }],
    });
  }
  return { attachments: [{ color, blocks }] };
}

/** A Teams message carrying an Adaptive Card, the format Workflows webhooks expect. */
function teamsMessage(summary: RunSummary, url: string | undefined): Record<string, unknown> {
  const color = { good: 'Good', bad: 'Attention', neutral: 'Default' }[toneOf(summary.status)];
  const card: Record<string, unknown> = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: summaryLine(summary),
        weight: 'Bolder',
        color,
        wrap: true,
      },
      {
        type: 'FactSet',
        facts: facts(summary).map(([title, value]) => ({ title, value })),
      },
    ],
    ...(url ? { actions: [{ type: 'Action.OpenUrl', title: 'Open report', url }] } : {}),
  };
  return {
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }],
  };
}

/**
 * A link back to the run, when this installation has been told its own address.
 *
 * Built by server/platform/report-links.ts, which owns the one path the client actually serves. This
 * used to compose `/test-plan-executions/{id}` here, which no route has ever matched: every
 * notification sent since has carried a link to a page that does not exist.
 */
function reportUrl(planId: string, executionId: string): string | undefined {
  return reportUrlFor(planId, executionId);
}

/** Settings that name a channel this build cannot deliver on, for the run's console. */
export function describeUnsupported(settings: NotificationSettings, canEmail = false): string[] {
  const notes: string[] = [];
  if (!canEmail && settings.emails && settings.emails.length > 0) {
    notes.push(
      `Notification settings list ${settings.emails.length} email address(es), but this installation ` +
        `has no SMTP configured (SMTP_URL), so no email was sent.`,
    );
  }
  return notes;
}

export interface SendDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Posts the notification, and never lets the attempt affect the run.
 *
 * A webhook that 500s, or a URL nobody updated when a Slack channel was archived, must not
 * turn a passing plan into a failed one: the run already happened, and its verdict is not
 * the notifier's to change.
 */
export async function sendRunNotification(
  settings: NotificationSettings,
  summary: RunSummary,
  deps: SendDeps = {},
): Promise<NotificationResult> {
  if (!shouldNotify(settings, summary.status)) {
    return { delivered: false, reason: `Notifications are off for a run that ${summary.status}.` };
  }

  const url = settings.webhookUrl?.trim();
  if (!url) {
    return { delivered: false, reason: 'No notification webhook URL is configured for this plan.' };
  }
  if (!/^https?:\/\//i.test(url)) {
    return {
      delivered: false,
      error: `Notification webhook URL must start with http:// or https:// (got "${url}").`,
    };
  }

  const send = deps.fetchImpl ?? fetchTarget;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const body = JSON.stringify(buildPayload(summary, url));
  // Up to three attempts on a network error, 429 or 5xx: a webhook that blinked is not a lost one.
  let result: NotificationResult = { delivered: false, error: 'Notification was not sent.' };
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await sleep(500 * 2 ** (attempt - 2));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const response = await send(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (response.ok) return { delivered: true };
      result = {
        delivered: false,
        error: `Notification webhook answered ${response.status} ${response.statusText}.`,
      };
      if (response.status !== 429 && response.status < 500) return result;
    } catch (error: any) {
      const reason =
        error?.name === 'AbortError'
          ? `no answer within ${WEBHOOK_TIMEOUT_MS / 1000}s`
          : (error?.message ?? String(error));
      result = { delivered: false, error: `Notification webhook could not be reached: ${reason}.` };
    } finally {
      clearTimeout(timer);
    }
  }
  return result;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown duration';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
