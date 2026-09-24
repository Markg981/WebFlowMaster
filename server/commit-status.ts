import { eq } from 'drizzle-orm';
import { sourceHosts, type SourceHost, type SourceHostProvider, type TestPlanExecution } from '@shared/schema';
import type { CiContext } from '@shared/ci';
import { decryptSecret } from './crypto';
import { fetchTarget } from './outbound-http';
import { onExecutionTransition } from './execution-state';
import { readExecutionSnapshot } from './execution-snapshot';
import { reportUrlFor } from './report-links';
import { runDetachedForOrganization, withTenantTransaction } from './middleware/tenancy';

/**
 * The run's result on the commit it tested, in GitHub or GitLab.
 *
 * A pipeline that started a run with the CLI and waited already failed its own job. One that did
 * not wait (`--no-wait`), a run started by a webhook, or anyone looking at the pull request rather
 * than the build log saw nothing. Now the commit says it: "WebFlowMaster / Checkout — pending",
 * then "3 of 40 failed", with the link to the report, next to the other checks.
 *
 * It follows the run through its states (server/execution-state.ts announces every move), and only
 * for runs that name a repository and a full commit and came from a provider the organization has
 * connected. Nothing here can fail a run: a GitHub that is down costs the check, and the source
 * host records why.
 */

const REQUEST_TIMEOUT_MS = 10_000;

export const DEFAULT_API_URLS: Record<SourceHostProvider, string> = {
  github: 'https://api.github.com',
  gitlab: 'https://gitlab.com/api/v4',
};

export interface HostConfig {
  provider: SourceHostProvider;
  apiUrl: string;
  token: string;
}

/** Where the status goes: which repository, which commit, under which name. */
export interface CommitTarget {
  repository: string;
  commit: string;
}

export type CommitState = 'pending' | 'running' | 'success' | 'failure' | 'error' | 'cancelled';

export interface CommitStatus {
  state: CommitState;
  /** What the check says next to its name, at most 140 characters (GitHub's limit). */
  description: string;
  /** The check's name; the same one for every state of every run of the plan, so it updates in place. */
  context: string;
  targetUrl?: string;
}

/** Which provider a run's CI context points at, and where on it — or null when it points at none. */
export function commitTargetOf(ci: CiContext | null | undefined): (CommitTarget & { provider: SourceHostProvider }) | null {
  if (!ci || (ci.provider !== 'github' && ci.provider !== 'gitlab')) return null;
  if (!ci.repository || !ci.commit) return null;
  // Both APIs want the full hash; a short one would set a status on nothing, or be refused.
  if (!/^[0-9a-f]{40}$/i.test(ci.commit)) return null;
  return { provider: ci.provider, repository: ci.repository, commit: ci.commit.toLowerCase() };
}

const count = (n: number | null | undefined) => n ?? 0;

function clip(text: string): string {
  return text.length <= 140 ? text : `${text.slice(0, 139)}…`;
}

/** What a run in this state says on its commit, or null for a state that says nothing new. */
export function commitStatusFor(execution: TestPlanExecution, planName: string, reportUrl?: string): CommitStatus | null {
  const base = { context: `WebFlowMaster / ${planName}`, ...(reportUrl ? { targetUrl: reportUrl } : {}) };
  const total = count(execution.totalTests);
  const failed = count(execution.failedTests);
  const passed = count(execution.passedTests);
  const quarantined = count(execution.quarantinedFailures);
  const attempt = execution.maxAttempts > 1 ? ` (attempt ${execution.attempt} of ${execution.maxAttempts})` : '';

  switch (execution.status) {
    case 'queued':
      return { ...base, state: 'pending', description: clip(`Queued${attempt}`) };
    case 'running':
      return { ...base, state: 'running', description: clip(`Running${attempt}`) };
    case 'completed': {
      const aside = quarantined > 0 ? `, ${quarantined} quarantined failure${quarantined === 1 ? '' : 's'} ignored` : '';
      return { ...base, state: 'success', description: clip(`${passed} of ${total} passed${aside}`) };
    }
    case 'failed':
      return { ...base, state: 'failure', description: clip(`${failed} of ${total} failed${attempt}`) };
    case 'timed_out':
      return { ...base, state: 'error', description: clip(`Timed out after ${passed + failed} of ${total} tests`) };
    case 'cancelled':
      return { ...base, state: 'cancelled', description: 'Cancelled' };
    case 'error':
      return { ...base, state: 'error', description: clip(execution.failureMessage || 'The run could not finish') };
    default:
      // `cancelling` is on its way to `cancelled`, which will say so.
      return null;
  }
}

/** GitHub has four states and GitLab six; each is told in its own words. */
const GITHUB_STATE: Record<CommitState, string> = {
  pending: 'pending',
  running: 'pending',
  success: 'success',
  failure: 'failure',
  error: 'error',
  cancelled: 'error',
};
const GITLAB_STATE: Record<CommitState, string> = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  failure: 'failed',
  error: 'failed',
  cancelled: 'canceled',
};

function base(apiUrl: string) {
  return apiUrl.trim().replace(/\/+$/, '');
}

function headersFor(host: HostConfig): Record<string, string> {
  return host.provider === 'github'
    ? { Authorization: `Bearer ${host.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    : { 'PRIVATE-TOKEN': host.token };
}

async function call(host: HostConfig, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(`${base(host.apiUrl)}${path}`, {
      ...init,
      headers: { ...headersFor(host), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** A refusal in a sentence: what the host said, and what that usually means. */
async function refusal(host: HostConfig, response: Response, target?: CommitTarget): Promise<string> {
  const body = await response.text().catch(() => '');
  let message = '';
  try {
    message = JSON.parse(body).message ?? '';
  } catch {
    message = body.slice(0, 200);
  }
  const name = host.provider === 'github' ? 'GitHub' : 'GitLab';
  const hint =
    response.status === 401
      ? 'the token is not valid'
      : response.status === 403 || response.status === 404
        ? `the token cannot set statuses${target ? ` on ${target.repository}` : ''}, or the repository is not there`
        : response.status === 422
          ? 'the commit is not in that repository'
          : '';
  return `${name} answered ${response.status}${message ? ` (${message})` : ''}${hint ? `: ${hint}.` : '.'}`;
}

/** Sets the status. Returns null when it was set, or why it was not. Never throws. */
export async function postCommitStatus(
  host: HostConfig,
  target: CommitTarget,
  status: CommitStatus,
  fetchImpl: typeof fetch = fetchTarget,
): Promise<string | null> {
  try {
    const response =
      host.provider === 'github'
        ? await call(
            host,
            `/repos/${target.repository.split('/').map(encodeURIComponent).join('/')}/statuses/${target.commit}`,
            {
              method: 'POST',
              body: JSON.stringify({ state: GITHUB_STATE[status.state], description: status.description, context: status.context, target_url: status.targetUrl }),
            },
            fetchImpl,
          )
        : await call(
            host,
            `/projects/${encodeURIComponent(target.repository)}/statuses/${target.commit}`,
            {
              method: 'POST',
              body: JSON.stringify({ state: GITLAB_STATE[status.state], description: status.description, name: status.context, target_url: status.targetUrl }),
            },
            fetchImpl,
          );
    if (response.ok) return null;
    // GitLab refuses to set a state a commit already has ("Cannot transition status via :run from
    // :running"): the commit already says what this would say.
    if (host.provider === 'gitlab' && response.status === 400) {
      const text = await response.clone().text().catch(() => '');
      if (/Cannot transition status/i.test(text)) return null;
    }
    return await refusal(host, response, target);
  } catch (error) {
    const reason = (error as Error)?.name === 'AbortError' ? `no answer within ${REQUEST_TIMEOUT_MS / 1000} seconds` : (error as Error)?.message ?? String(error);
    return `Could not reach ${base(host.apiUrl)}: ${reason}.`;
  }
}

/** Whether the token works, and whose it is. A read: nothing is set anywhere. */
export async function checkSourceHost(
  host: HostConfig,
  fetchImpl: typeof fetch = fetchTarget,
): Promise<{ ok: true; account: string } | { ok: false; error: string }> {
  try {
    const response = await call(host, '/user', { method: 'GET' }, fetchImpl);
    if (!response.ok) return { ok: false, error: await refusal(host, response) };
    const user = await response.json();
    return { ok: true, account: String(user.login ?? user.username ?? 'unknown') };
  } catch (error) {
    return { ok: false, error: `Could not reach ${base(host.apiUrl)}: ${(error as Error).message}.` };
  }
}

export function hostConfig(row: SourceHost): HostConfig {
  return { provider: row.provider, apiUrl: row.apiUrl, token: decryptSecret(row.encryptedToken, row.tokenIv, row.tokenAuthTag) };
}

/**
 * Statuses of one run are sent one after the other: "running" overtaking "failed" on the way to
 * GitHub would leave the pull request saying the run is still going.
 */
const inFlight = new Map<string, Promise<void>>();

export interface ReportDeps {
  fetchImpl?: typeof fetch;
}

/** Reports a run's current state on its commit, if it has one and the organization has the host. */
export function reportCommitStatus(execution: TestPlanExecution, deps: ReportDeps = {}): Promise<void> {
  const target = commitTargetOf(execution.ciContext);
  if (!target) return Promise.resolve();
  const planName = readExecutionSnapshot(execution.configurationSnapshot)?.plan.name || execution.testPlanId;
  const status = commitStatusFor(execution, planName, reportUrlFor(execution.testPlanId, execution.id));
  if (!status) return Promise.resolve();

  const previous = inFlight.get(execution.id) ?? Promise.resolve();
  const next = previous.then(() =>
    runDetachedForOrganization(execution.organizationId, async () => {
      const [host] = await withTenantTransaction((tx) =>
        tx.select().from(sourceHosts).where(eq(sourceHosts.provider, target.provider)).limit(1),
      );
      if (!host) return;
      const error = await postCommitStatus(hostConfig(host), target, status, deps.fetchImpl);
      await withTenantTransaction(async (tx) => {
        await tx.update(sourceHosts).set({ lastDeliveryAt: new Date(), lastDeliveryError: error }).where(eq(sourceHosts.id, host.id));
      });
    }).catch(() => {}),
  );
  inFlight.set(execution.id, next);
  void next.finally(() => {
    if (inFlight.get(execution.id) === next) inFlight.delete(execution.id);
  });
  return next;
}

let registered: (() => void) | null = null;

/** Turns it on for this process: the web server and the worker both move runs. */
export function registerCommitStatus(deps: ReportDeps = {}): () => void {
  registered?.();
  const off = onExecutionTransition((execution) => reportCommitStatus(execution, deps));
  registered = () => {
    off();
    registered = null;
  };
  return registered;
}
