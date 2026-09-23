import { fetchTarget } from './outbound-http';
import { reportUrlFor } from './report-links';

/**
 * Telling somebody the run finished.
 *
 * `test_plans.notification_settings` and `test_plan_schedules.notification_config_override`
 * have been written by the plan wizard and the schedule form since they existed, and read by
 * nothing: a nightly plan configured to notify on failure failed quietly, and the only way to
 * learn that was to go and look — which is the thing a scheduled run exists to avoid.
 *
 * The channel is an outgoing webhook, which Slack and Microsoft Teams both accept in the
 * shape below, and so does anything else that can receive a POST. The wizard's existing
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
  /** Recognised, and reported as not yet a channel — see `describeUnsupported`. */
  emails?: string[] | null;
}

export type RunStatus = 'completed' | 'failed' | 'error' | 'pending' | 'running' | string;

export interface RunSummary {
  planId: string;
  planName: string;
  executionId: string;
  status: RunStatus;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  durationMs: number;
  triggeredBy: string;
  /** The browsers this run covered, so a notification says which matrix produced the number. */
  browsers?: string[];
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
export function switchForStatus(status: RunStatus): 'passed' | 'failed' | 'notExecuted' | 'stopped' | null {
  switch (status) {
    case 'completed':
      return 'passed';
    case 'failed':
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
        (summary.skippedTests > 0 ? `, ${summary.skippedTests} skipped` : '')
      : 'no tests ran';
  const browsers = summary.browsers?.length ? ` on ${summary.browsers.join(', ')}` : '';
  return `${summary.planName}: ${verdict} — ${counts}${browsers} (${formatDuration(summary.durationMs)}, ${summary.triggeredBy}).`;
}

/**
 * The POST body.
 *
 * `text` is there because that single field is what Slack and Teams both render; everything
 * else is there for a receiver that wants the numbers rather than the sentence.
 */
export function buildPayload(summary: RunSummary): Record<string, unknown> {
  const url = reportUrl(summary.planId, summary.executionId);
  return {
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
      durationMs: summary.durationMs,
      triggeredBy: summary.triggeredBy,
      browsers: summary.browsers ?? [],
      url,
    },
  };
}

/**
 * A link back to the run, when this installation has been told its own address.
 *
 * Built by server/report-links.ts, which owns the one path the client actually serves. This
 * used to compose `/test-plan-executions/{id}` here, which no route has ever matched: every
 * notification sent since has carried a link to a page that does not exist.
 */
function reportUrl(planId: string, executionId: string): string | undefined {
  return reportUrlFor(planId, executionId);
}

/** Settings that name a channel this build cannot deliver on, for the run's console. */
export function describeUnsupported(settings: NotificationSettings): string[] {
  const notes: string[] = [];
  if (settings.emails && settings.emails.length > 0) {
    notes.push(
      `Notification settings list ${settings.emails.length} email address(es); this build ` +
        `delivers over a webhook only, so no email was sent.`,
    );
  }
  return notes;
}

export interface SendDeps {
  fetchImpl?: typeof fetch;
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
    return { delivered: false, error: `Notification webhook URL must start with http:// or https:// (got "${url}").` };
  }

  const send = deps.fetchImpl ?? fetchTarget;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(summary)),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { delivered: false, error: `Notification webhook answered ${response.status} ${response.statusText}.` };
    }
    return { delivered: true };
  } catch (error: any) {
    const reason = error?.name === 'AbortError' ? `no answer within ${WEBHOOK_TIMEOUT_MS / 1000}s` : (error?.message ?? String(error));
    return { delivered: false, error: `Notification webhook could not be reached: ${reason}.` };
  } finally {
    clearTimeout(timer);
  }
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
