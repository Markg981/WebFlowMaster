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

export async function call(
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
export function describeFailure(action: string, status: number, body: any, text: string): Error {
  const fromJira = Array.isArray(body?.errorMessages) && body.errorMessages.length > 0
    ? body.errorMessages.join('; ')
    : body?.errors && typeof body.errors === 'object'
      ? Object.entries(body.errors).map(([field, message]) => `${field}: ${message}`).join('; ')
      : '';
  // Azure DevOps and Zephyr Scale say `message`; TestRail says `error`.
  const fromAzure = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : '';
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

/**
 * An epic, a story or a requirement as the tracker has it, for requirements traceability
 * (shared/requirements.ts). Read-only: nothing is written back to the tracker.
 */
export interface TrackedItem {
  key: string;
  title: string;
  /** The tracker's issue or work item type: "Story", "Epic", "User Story", "Feature". */
  type: string;
  status: string | null;
  url: string;
  parentKey: string | null;
}

export interface FetchItemsRequest {
  /** These issues: SHOP-142, or Azure DevOps ids. */
  keys?: string[];
  /** Or those a query finds: JQL for Jira, WIQL for Azure DevOps. */
  query?: string;
}

/** More than this in one import is a query that should be narrowed, not a page of requirements. */
export const MAX_IMPORTED_ITEMS = 500;

/** The query used when neither keys nor a query are given: the project's epics and stories. */
export function defaultItemQuery(config: TrackerConfig): string {
  return config.provider === 'jira'
    ? `project = "${config.projectKey.replace(/"/g, '\\"')}" AND issuetype in (Epic, Story) ORDER BY key`
    : "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] IN ('Epic', 'Feature', 'User Story', 'Product Backlog Item', 'Requirement') ORDER BY [System.Id]";
}

async function fetchJiraItems(config: TrackerConfig, jql: string, deps: ProviderDeps): Promise<TrackedItem[]> {
  const base = normaliseBaseUrl(config.baseUrl);
  const headers = { Authorization: authHeader(config), Accept: 'application/json' };
  const fields = 'summary,issuetype,status,parent';
  const items: TrackedItem[] = [];
  const toItem = (issue: any): TrackedItem => ({
    key: String(issue.key),
    title: String(issue.fields?.summary ?? issue.key),
    type: String(issue.fields?.issuetype?.name ?? ''),
    status: issue.fields?.status?.name ?? null,
    url: `${base}/browse/${issue.key}`,
    parentKey: issue.fields?.parent?.key ?? null,
  });

  // Jira Cloud's search, paged by token. Jira Data Center has only the older one, paged by offset.
  let token: string | undefined;
  for (;;) {
    const params = new URLSearchParams({ jql, fields, maxResults: '100' });
    if (token) params.set('nextPageToken', token);
    const result = await call(`${base}/rest/api/3/search/jql?${params}`, { method: 'GET', headers }, deps);
    if (result.status === 404 && items.length === 0) break;
    if (!result.ok) throw describeFailure('Searching Jira', result.status, result.body, result.text);
    for (const issue of result.body?.issues ?? []) items.push(toItem(issue));
    token = result.body?.nextPageToken;
    if (!token || result.body?.isLast || items.length >= MAX_IMPORTED_ITEMS) return items.slice(0, MAX_IMPORTED_ITEMS);
  }

  for (let startAt = 0; ; ) {
    const params = new URLSearchParams({ jql, fields, maxResults: '100', startAt: String(startAt) });
    const result = await call(`${base}/rest/api/2/search?${params}`, { method: 'GET', headers }, deps);
    if (!result.ok) throw describeFailure('Searching Jira', result.status, result.body, result.text);
    const page = result.body?.issues ?? [];
    for (const issue of page) items.push(toItem(issue));
    startAt += page.length;
    if (page.length === 0 || startAt >= (result.body?.total ?? 0) || items.length >= MAX_IMPORTED_ITEMS) return items.slice(0, MAX_IMPORTED_ITEMS);
  }
}

async function fetchAzureItems(config: TrackerConfig, request: FetchItemsRequest, deps: ProviderDeps): Promise<TrackedItem[]> {
  const base = normaliseBaseUrl(config.baseUrl);
  const project = encodeURIComponent(config.projectKey);
  const headers = { Authorization: authHeader(config), Accept: 'application/json' };

  let ids: number[];
  if (request.keys?.length) {
    ids = request.keys.map((key) => Number(key)).filter((id) => Number.isInteger(id) && id > 0);
  } else {
    const result = await call(
      `${base}/${project}/_apis/wit/wiql?api-version=7.0&$top=${MAX_IMPORTED_ITEMS}`,
      { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: request.query || defaultItemQuery(config) }) },
      deps,
    );
    if (!result.ok) throw describeFailure('Querying Azure DevOps', result.status, result.body, result.text);
    ids = (result.body?.workItems ?? []).map((item: any) => Number(item.id));
  }
  ids = Array.from(new Set(ids)).slice(0, MAX_IMPORTED_ITEMS);

  const items: TrackedItem[] = [];
  // Two hundred ids per call is Azure DevOps' limit.
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const params = new URLSearchParams({
      ids: batch.join(','),
      fields: 'System.Title,System.WorkItemType,System.State,System.Parent',
      errorPolicy: 'omit',
      'api-version': '7.0',
    });
    const result = await call(`${base}/${project}/_apis/wit/workitems?${params}`, { method: 'GET', headers }, deps);
    if (!result.ok) throw describeFailure('Reading Azure DevOps work items', result.status, result.body, result.text);
    for (const item of result.body?.value ?? []) {
      if (!item) continue; // an id that does not exist, omitted
      const fields = item.fields ?? {};
      items.push({
        key: String(item.id),
        title: String(fields['System.Title'] ?? item.id),
        type: String(fields['System.WorkItemType'] ?? ''),
        status: fields['System.State'] ?? null,
        url: `${base}/${project}/_workitems/edit/${item.id}`,
        parentKey: fields['System.Parent'] != null ? String(fields['System.Parent']) : null,
      });
    }
  }
  return items;
}

/**
 * The epics and stories the keys name, or the query finds (the project's epics and stories when
 * neither is given). Keys the tracker does not know are simply absent from the answer.
 */
export async function fetchItems(config: TrackerConfig, request: FetchItemsRequest, deps: ProviderDeps = {}): Promise<TrackedItem[]> {
  if (config.provider === 'jira') {
    const jql = request.keys?.length
      ? `key in (${request.keys.map((key) => `"${key.replace(/"/g, '')}"`).join(', ')})`
      : request.query || defaultItemQuery(config);
    return fetchJiraItems(config, jql, deps);
  }
  return fetchAzureItems(config, request, deps);
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
