import {
  PROVIDER_LABELS,
  TESTRAIL_STATUS,
  ZEPHYR_STATUS,
  xrayStatus,
  type PublishedOutcome,
  type TestManagementProvider,
} from '@shared/test-management';
import { call, describeFailure, normaliseBaseUrl, type ProviderDeps } from './issue-providers';

/**
 * Speaking to TestRail, Xray and Zephyr Scale: publishing a run's results, and telling whether
 * the credentials work. Only the wire format lives here; which results go where, and what is
 * recorded about it, is server/test-management.ts.
 *
 * Every failure comes back as a sentence that says what the tool said, because "400" is not
 * something a QA lead can fix and "Field :case_ids contains one or more invalid case IDs" is.
 */

export interface ConnectionConfig {
  provider: TestManagementProvider;
  baseUrl: string;
  username: string | null;
  token: string;
  /** TestRail's project id; the Jira project key of Xray and Zephyr. */
  projectKey: string;
  suiteId: string | null;
  testPlanKey: string | null;
}

export interface CaseResult {
  /** C123, SHOP-45, SHOP-T12, as shared/test-management.ts normalises them. */
  caseKey: string;
  outcome: PublishedOutcome;
  comment: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
}

export interface PublishRequest {
  /** "Nightly — run 3f2a…" */
  title: string;
  description: string;
  results: CaseResult[];
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface PublishOutcome {
  externalKey: string;
  externalUrl: string | null;
  /** How many results the tool took. */
  published: number;
  /** Results it would not take, said per case. */
  problems: string[];
}

const json = { 'Content-Type': 'application/json', Accept: 'application/json' };
const iso = (date: Date | null) => (date ? date.toISOString() : undefined);
const basic = (user: string, secret: string) => `Basic ${Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')}`;

// ─── TestRail ────────────────────────────────────────────────────────────────

function testRailApi(config: ConnectionConfig) {
  const base = normaliseBaseUrl(config.baseUrl);
  const headers = { ...json, Authorization: basic(config.username ?? '', config.token) };
  return { base, headers, url: (path: string) => `${base}/index.php?/api/v2/${path}` };
}

/** "3m 12s" as TestRail writes an elapsed time; at least a second, which is its smallest. */
export function testRailElapsed(ms: number | null): string | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  const seconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

async function publishToTestRail(config: ConnectionConfig, request: PublishRequest, deps: ProviderDeps): Promise<PublishOutcome> {
  const api = testRailApi(config);
  const caseIds = Array.from(new Set(request.results.map((r) => Number(r.caseKey.replace(/^C/i, '')))));
  const run = await call(
    api.url(`add_run/${encodeURIComponent(config.projectKey)}`),
    {
      method: 'POST',
      headers: api.headers,
      body: JSON.stringify({
        name: request.title,
        description: request.description,
        include_all: false,
        case_ids: caseIds,
        ...(config.suiteId ? { suite_id: Number(config.suiteId) } : {}),
      }),
    },
    deps,
  );
  if (!run.ok) throw describeFailure('Creating the TestRail run', run.status, run.body, run.text);
  const runId = run.body?.id;
  if (runId == null) throw new Error('TestRail created the run but did not say its id.');

  // Untested cannot be posted: those cases stay untested in the run, which is what they are.
  const results = request.results
    .filter((r) => TESTRAIL_STATUS[r.outcome] != null)
    .map((r) => ({
      case_id: Number(r.caseKey.replace(/^C/i, '')),
      status_id: TESTRAIL_STATUS[r.outcome],
      comment: r.comment,
      ...(testRailElapsed(r.durationMs) ? { elapsed: testRailElapsed(r.durationMs) } : {}),
    }));
  if (results.length) {
    const posted = await call(api.url(`add_results_for_cases/${runId}`), { method: 'POST', headers: api.headers, body: JSON.stringify({ results }) }, deps);
    if (!posted.ok) throw describeFailure(`Adding the results to TestRail run R${runId}`, posted.status, posted.body, posted.text);
  }
  return { externalKey: `R${runId}`, externalUrl: run.body?.url ?? `${api.base}/index.php?/runs/view/${runId}`, published: results.length, problems: [] };
}

// ─── Xray ────────────────────────────────────────────────────────────────────

/** Xray Cloud hands out a token for its client id and secret; it lasts a day. */
async function xrayCloudToken(config: ConnectionConfig, deps: ProviderDeps): Promise<string> {
  const base = normaliseBaseUrl(config.baseUrl);
  const result = await call(
    `${base}/api/v2/authenticate`,
    { method: 'POST', headers: json, body: JSON.stringify({ client_id: config.username ?? '', client_secret: config.token }) },
    deps,
  );
  if (result.status === 401 || result.status === 403 || result.status === 400) {
    throw new Error('Xray Cloud refused the client id and client secret. Create an API key in Jira → Apps → Xray → API Keys.');
  }
  if (!result.ok) throw describeFailure('Authenticating with Xray Cloud', result.status, result.body, result.text);
  const token = typeof result.body === 'string' ? result.body : result.text.replace(/^"|"$/g, '');
  if (!token) throw new Error('Xray Cloud answered without a token.');
  return token;
}

function xrayServerAuth(config: ConnectionConfig): string {
  // A personal access token (Jira 8.14 and later), or a user and password.
  return config.username ? basic(config.username, config.token) : `Bearer ${config.token}`;
}

/** Xray's own JSON format, the same for Cloud and Server but for how a status is spelt. */
export function xrayExecution(config: ConnectionConfig, request: PublishRequest) {
  const provider = config.provider as 'xray_cloud' | 'xray_server';
  return {
    info: {
      project: config.projectKey,
      summary: request.title,
      description: request.description,
      ...(request.startedAt ? { startDate: iso(request.startedAt) } : {}),
      ...(request.finishedAt ? { finishDate: iso(request.finishedAt) } : {}),
      ...(config.testPlanKey ? { testPlanKey: config.testPlanKey } : {}),
    },
    tests: request.results.map((r) => ({
      testKey: r.caseKey,
      status: xrayStatus(r.outcome, provider),
      comment: r.comment,
      ...(r.startedAt ? { start: iso(r.startedAt) } : {}),
      ...(r.finishedAt ? { finish: iso(r.finishedAt) } : {}),
    })),
  };
}

/** The Jira address of an issue, from the API address Xray answers with. */
function browseUrl(self: unknown, key: string, fallbackBase: string | null): string | null {
  if (typeof self === 'string') {
    const match = /^(https?:\/\/[^/]+(?:\/[^/]+)*?)\/rest\/api\//.exec(self);
    if (match) return `${match[1]}/browse/${key}`;
  }
  return fallbackBase ? `${fallbackBase}/browse/${key}` : null;
}

async function publishToXray(config: ConnectionConfig, request: PublishRequest, deps: ProviderDeps): Promise<PublishOutcome> {
  const base = normaliseBaseUrl(config.baseUrl);
  const body = JSON.stringify(xrayExecution(config, request));
  if (config.provider === 'xray_cloud') {
    const token = await xrayCloudToken(config, deps);
    const result = await call(`${base}/api/v2/import/execution`, { method: 'POST', headers: { ...json, Authorization: `Bearer ${token}` }, body }, deps);
    if (!result.ok) throw describeFailure('Importing the results into Xray', result.status, result.body, result.text);
    const key = result.body?.key;
    if (!key) throw new Error('Xray took the results but did not say which Test Execution holds them.');
    return { externalKey: key, externalUrl: browseUrl(result.body?.self, key, null), published: request.results.length, problems: [] };
  }

  // Server and Data Center: the 2.0 endpoint, and 1.0 on versions before it existed.
  const headers = { ...json, Authorization: xrayServerAuth(config) };
  let result = await call(`${base}/rest/raven/2.0/import/execution`, { method: 'POST', headers, body }, deps);
  if (result.status === 404) result = await call(`${base}/rest/raven/1.0/import/execution`, { method: 'POST', headers, body }, deps);
  if (!result.ok) throw describeFailure('Importing the results into Xray', result.status, result.body, result.text);
  const issue = result.body?.testExecIssue ?? result.body;
  const key = issue?.key;
  if (!key) throw new Error('Xray took the results but did not say which Test Execution holds them.');
  return { externalKey: key, externalUrl: `${base}/browse/${key}`, published: request.results.length, problems: [] };
}

// ─── Zephyr Scale ────────────────────────────────────────────────────────────

function zephyrApi(config: ConnectionConfig) {
  const base = normaliseBaseUrl(config.baseUrl);
  return { base, headers: { ...json, Authorization: `Bearer ${config.token}` } };
}

/**
 * The status names this project uses. Zephyr ships Pass, Fail, Blocked and Not Executed, and a
 * project may rename them; a name it does not have makes every execution fail, so they are read
 * first and the closest one is used.
 */
export function zephyrStatusName(outcome: PublishedOutcome, available: string[]): string | null {
  const wanted = ZEPHYR_STATUS[outcome];
  const exact = available.find((name) => name.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact;
  const pattern = { passed: /pass/i, failed: /fail/i, skipped: /block/i, pending: /not ?exec|to ?do|untested/i, notRun: /not ?exec|to ?do|untested/i }[outcome];
  return available.find((name) => pattern.test(name)) ?? null;
}

async function publishToZephyr(config: ConnectionConfig, request: PublishRequest, deps: ProviderDeps): Promise<PublishOutcome> {
  const api = zephyrApi(config);
  const statusesAnswer = await call(
    `${api.base}/statuses?projectKey=${encodeURIComponent(config.projectKey)}&statusType=TEST_EXECUTION&maxResults=100`,
    { method: 'GET', headers: api.headers },
    deps,
  );
  if (!statusesAnswer.ok) throw describeFailure('Reading the Zephyr Scale statuses', statusesAnswer.status, statusesAnswer.body, statusesAnswer.text);
  const available: string[] = (statusesAnswer.body?.values ?? []).filter((s: any) => !s.archived).map((s: any) => String(s.name));

  const cycle = await call(
    `${api.base}/testcycles`,
    { method: 'POST', headers: api.headers, body: JSON.stringify({ projectKey: config.projectKey, name: request.title, description: request.description }) },
    deps,
  );
  if (!cycle.ok) throw describeFailure('Creating the Zephyr Scale test cycle', cycle.status, cycle.body, cycle.text);
  const cycleKey = cycle.body?.key;
  if (!cycleKey) throw new Error('Zephyr Scale created the test cycle but did not say its key.');

  // One execution per case: Zephyr's API has no batch for them outside its framework imports.
  let published = 0;
  const problems: string[] = [];
  for (const result of request.results) {
    const statusName = zephyrStatusName(result.outcome, available);
    if (!statusName) {
      problems.push(`${result.caseKey}: the project has no status for "${ZEPHYR_STATUS[result.outcome]}" (it has ${available.join(', ') || 'none'}).`);
      continue;
    }
    const answer = await call(
      `${api.base}/testexecutions`,
      {
        method: 'POST',
        headers: api.headers,
        body: JSON.stringify({
          projectKey: config.projectKey,
          testCaseKey: result.caseKey,
          testCycleKey: cycleKey,
          statusName,
          comment: result.comment.replace(/\n/g, '<br>'),
          ...(result.durationMs != null ? { executionTime: result.durationMs } : {}),
          ...(result.finishedAt ? { actualEndDate: iso(result.finishedAt) } : {}),
        }),
      },
      deps,
    );
    if (answer.ok) published++;
    else problems.push(`${result.caseKey}: ${describeFailure('Zephyr Scale', answer.status, answer.body, answer.text).message}`);
  }
  return { externalKey: cycleKey, externalUrl: null, published, problems };
}

// ─── Both ────────────────────────────────────────────────────────────────────

export async function publishResults(config: ConnectionConfig, request: PublishRequest, deps: ProviderDeps = {}): Promise<PublishOutcome> {
  switch (config.provider) {
    case 'testrail':
      return publishToTestRail(config, request, deps);
    case 'xray_cloud':
    case 'xray_server':
      return publishToXray(config, request, deps);
    case 'zephyr_scale':
      return publishToZephyr(config, request, deps);
  }
}

/**
 * Whether these credentials reach that project, asked before a run depends on it. A read only:
 * the other way to find out would be creating an empty run in somebody's TestRail.
 */
export async function checkTestManagement(config: ConnectionConfig, deps: ProviderDeps = {}): Promise<{ ok: boolean; detail: string }> {
  const label = PROVIDER_LABELS[config.provider];
  try {
    if (config.provider === 'xray_cloud') {
      await xrayCloudToken(config, deps);
      return { ok: true, detail: `Authenticated with ${label}.` };
    }
    let url: string;
    let headers: Record<string, string>;
    if (config.provider === 'testrail') {
      const api = testRailApi(config);
      url = api.url(`get_project/${encodeURIComponent(config.projectKey)}`);
      headers = api.headers;
    } else if (config.provider === 'xray_server') {
      url = `${normaliseBaseUrl(config.baseUrl)}/rest/api/2/project/${encodeURIComponent(config.projectKey)}`;
      headers = { ...json, Authorization: xrayServerAuth(config) };
    } else {
      const api = zephyrApi(config);
      url = `${api.base}/projects/${encodeURIComponent(config.projectKey)}`;
      headers = api.headers;
    }
    const result = await call(url, { method: 'GET', headers }, deps);
    if (result.status === 401 || result.status === 403) return { ok: false, detail: `${label} refused those credentials.` };
    if (result.status === 404 || (config.provider === 'testrail' && result.status === 400)) {
      return { ok: false, detail: `${label} has no project "${config.projectKey}", or this account cannot see it.` };
    }
    if (!result.ok) return { ok: false, detail: describeFailure(`Reading the ${label} project`, result.status, result.body, result.text).message };
    const name = result.body?.name ?? result.body?.key ?? config.projectKey;
    return { ok: true, detail: `Connected to ${name}.` };
  } catch (error: any) {
    return { ok: false, detail: error?.message ?? String(error) };
  }
}
