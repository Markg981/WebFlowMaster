import { fetchTarget } from './outbound-http';
import type { IssueProvider } from '@shared/schema';

/**
 * Speaking to Jira and to Azure DevOps.
 *
 * Only the wire format lives here: how an issue is created, how a comment is added, and how to
 * tell whether the credentials work at all. What a failure is, whether it has been filed
 * before, and whether filing is wanted are decided in server/issue-tracking.ts, which has no
 * network in it and can be tested without one.
 *
 * Every call has a timeout and every failure comes back as a readable sentence. The callers
 * are a run that has already produced its verdict and a report page: neither may be turned
 * into an error because somebody's Jira is down.
 */

const REQUEST_TIMEOUT_MS = 15_000;

export interface TrackerConfig {
  provider: IssueProvider;
  /** https://acme.atlassian.net, or https://dev.azure.com/acme. */
  baseUrl: string;
  projectKey: string;
  issueType: string;
  /** Jira authenticates the token against this account; Azure DevOps ignores it. */
  userEmail?: string | null;
  token: string;
}

export interface IssueDraft {
  title: string;
  /** Plain text with newlines. Each provider is handed the shape it wants. */
  body: string;
}

export interface CreatedIssue {
  key: string;
  url: string;
}

export interface ProviderDeps {
  fetchImpl?: typeof fetch;
}

/** The URL with any trailing slashes removed, so joining a path never doubles one. */
export function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/**
 * Basic auth, which is what both of them take.
 *
 * Jira pairs the API token with the account's email. Azure DevOps takes a personal access
 * token as the password with an empty username — the colon is not a typo.
 */
export function authHeader(config: TrackerConfig): string {
  const pair = config.provider === 'jira' ? `${config.userEmail ?? ''}:${config.token}` : `:${config.token}`;
  return `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`;
}

/**
 * Jira's API v3 takes a document, not a string.
 *
 * One paragraph per line, blank lines dropped. Anything richer would be guessing at markup the
 * caller never asked for — and a body that fails to render is worse than a plain one.
 */
export function toAdf(body: string): Record<string, unknown> {
  const paragraphs = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }));

  return {
    type: 'doc',
    version: 1,
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph', content: [] }],
  };
}

/** Azure DevOps renders the description as HTML, so the text has to survive being HTML. */
export function toHtml(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'),
    )
    .join('<br/>');
}

async function call(
  url: string,
  init: RequestInit,
  deps: ProviderDeps,
): Promise<{ status: number; ok: boolean; body: any; text: string }> {
  const send = deps.fetchImpl ?? fetchTarget;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await send(url, { ...init, signal: controller.signal });
    const text = await response.text().catch(() => '');
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, ok: response.ok, body, text };
  } catch (error: any) {
    const reason = error?.name === 'AbortError' ? `no answer within ${REQUEST_TIMEOUT_MS / 1000}s` : (error?.message ?? String(error));
    throw new Error(`Could not reach ${new URL(url).host}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the tracker said went wrong, rather than a status code.
 *
 * Both of them answer a rejected field with a message that names it — "issuetype: is required",
 * "The field 'Area Path' contains an invalid value" — and that sentence is the difference
 * between a misconfiguration somebody can fix and one they can only guess at.
 */
function describeFailure(action: string, status: number, body: any, text: string): Error {
  const fromJira = Array.isArray(body?.errorMessages) && body.errorMessages.length > 0
    ? body.errorMessages.join('; ')
    : body?.errors && typeof body.errors === 'object'
      ? Object.entries(body.errors).map(([field, message]) => `${field}: ${message}`).join('; ')
      : '';
  const fromAzure = typeof body?.message === 'string' ? body.message : '';
  const detail = fromJira || fromAzure || text.slice(0, 300);
  return new Error(`${action} failed (${status})${detail ? `: ${detail}` : '.'}`);
}

export async function createIssue(
  config: TrackerConfig,
  draft: IssueDraft,
  deps: ProviderDeps = {},
): Promise<CreatedIssue> {
  const base = normaliseBaseUrl(config.baseUrl);

  if (config.provider === 'jira') {
    const result = await call(
      `${base}/rest/api/3/issue`,
      {
        method: 'POST',
        headers: { Authorization: authHeader(config), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          fields: {
            project: { key: config.projectKey },
            summary: draft.title,
            description: toAdf(draft.body),
            issuetype: { name: config.issueType },
          },
        }),
      },
      deps,
    );
    if (!result.ok) throw describeFailure('Creating the Jira issue', result.status, result.body, result.text);
    const key = result.body?.key;
    if (!key) throw new Error('Jira accepted the issue but did not say what it is called.');
    return { key, url: `${base}/browse/${key}` };
  }

  const result = await call(
    // The $ before the type is Azure DevOps' own syntax for "create one of these".
    `${base}/${encodeURIComponent(config.projectKey)}/_apis/wit/workitems/$${encodeURIComponent(config.issueType)}?api-version=7.0`,
    {
      method: 'POST',
      headers: { Authorization: authHeader(config), 'Content-Type': 'application/json-patch+json', Accept: 'application/json' },
      body: JSON.stringify([
        { op: 'add', path: '/fields/System.Title', value: draft.title },
        { op: 'add', path: '/fields/System.Description', value: toHtml(draft.body) },
      ]),
    },
    deps,
  );
  if (!result.ok) throw describeFailure('Creating the Azure DevOps work item', result.status, result.body, result.text);
  const id = result.body?.id;
  if (!id) throw new Error('Azure DevOps accepted the work item but did not say what it is called.');
  return {
    key: String(id),
    url: result.body?._links?.html?.href ?? `${base}/${encodeURIComponent(config.projectKey)}/_workitems/edit/${id}`,
  };
}

/**
 * Says it happened again, on the issue that already exists.
 *
 * This is the half that makes the whole thing bearable: without it, a plan that fails for a
 * week opens seven identical issues, and by the eighth morning nobody reads any of them.
 */
export async function addComment(
  config: TrackerConfig,
  issueKey: string,
  text: string,
  deps: ProviderDeps = {},
): Promise<void> {
  const base = normaliseBaseUrl(config.baseUrl);

  if (config.provider === 'jira') {
    const result = await call(
      `${base}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        method: 'POST',
        headers: { Authorization: authHeader(config), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ body: toAdf(text) }),
      },
      deps,
    );
    if (!result.ok) throw describeFailure('Commenting on the Jira issue', result.status, result.body, result.text);
    return;
  }

  const result = await call(
    `${base}/${encodeURIComponent(config.projectKey)}/_apis/wit/workItems/${encodeURIComponent(issueKey)}/comments?api-version=7.0-preview.3`,
    {
      method: 'POST',
      headers: { Authorization: authHeader(config), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ text: toHtml(text) }),
    },
    deps,
  );
  if (!result.ok) throw describeFailure('Commenting on the Azure DevOps work item', result.status, result.body, result.text);
}

export interface ConnectionCheck {
  ok: boolean;
  /** What was found, or what was wrong — either way, something a person can act on. */
  detail: string;
}

/**
 * Whether these credentials can reach that project, asked before anything is filed.
 *
 * Deliberately a read: the alternative way to find out is a failed run discovering it at two in
 * the morning, and the alternative to that is creating a throwaway issue in somebody's board.
 */
export async function checkConnection(config: TrackerConfig, deps: ProviderDeps = {}): Promise<ConnectionCheck> {
  const base = normaliseBaseUrl(config.baseUrl);
  try {
    if (config.provider === 'jira') {
      const result = await call(
        `${base}/rest/api/3/project/${encodeURIComponent(config.projectKey)}`,
        { method: 'GET', headers: { Authorization: authHeader(config), Accept: 'application/json' } },
        deps,
      );
      if (result.status === 401 || result.status === 403) {
        return { ok: false, detail: 'Jira refused those credentials. Check the email address and the API token.' };
      }
      if (result.status === 404) {
        return { ok: false, detail: `Jira has no project "${config.projectKey}", or this account cannot see it.` };
      }
      if (!result.ok) return { ok: false, detail: describeFailure('Reading the Jira project', result.status, result.body, result.text).message };
      return { ok: true, detail: `Connected to ${result.body?.name ?? config.projectKey}.` };
    }

    const result = await call(
      `${base}/_apis/projects/${encodeURIComponent(config.projectKey)}?api-version=7.0`,
      { method: 'GET', headers: { Authorization: authHeader(config), Accept: 'application/json' } },
      deps,
    );
    if (result.status === 401 || result.status === 403) {
      return { ok: false, detail: 'Azure DevOps refused that token. Check that it grants work item read and write.' };
    }
    if (result.status === 404) {
      return { ok: false, detail: `Azure DevOps has no project "${config.projectKey}" at ${base}.` };
    }
    if (!result.ok) return { ok: false, detail: describeFailure('Reading the Azure DevOps project', result.status, result.body, result.text).message };
    return { ok: true, detail: `Connected to ${result.body?.name ?? config.projectKey}.` };
  } catch (error: any) {
    return { ok: false, detail: error?.message ?? String(error) };
  }
}
