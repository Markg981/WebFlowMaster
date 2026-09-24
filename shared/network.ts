/**
 * What a test's page asked the network for, as the report shows it.
 *
 * A test that failed because an API answered 500, because a request took twelve seconds, or
 * because a script never loaded looks, in a screenshot, exactly like a test with a wrong
 * selector. The trace has the network in it, but only for someone who downloads it and opens
 * Playwright's viewer. So the run keeps a HAR, the format every browser's DevTools opens, and the
 * report reads the part that answers most failures straight out of it: which requests failed and
 * which were slow.
 */

/** The failed requests kept in a summary: enough to see the pattern, not a log. */
export const MAX_FAILED_REQUESTS = 25;
/** The slowest requests kept. */
export const MAX_SLOW_REQUESTS = 10;

export interface NetworkRequestSummary {
  method: string;
  url: string;
  /** 0 when there was no response at all (DNS, refused, aborted, blocked). */
  status: number;
  /** The status text, or why there was no response. */
  statusText: string;
  timeMs: number;
  /** What kind of thing was asked for: document, xhr, fetch, script, image… when known. */
  resourceType: string | null;
}

export interface NetworkSummary {
  requests: number;
  /** A status of 400 or above, or no response at all. */
  failed: number;
  /** Bytes received, as far as the browser reported them. */
  transferredBytes: number;
  failures: NetworkRequestSummary[];
  slowest: NetworkRequestSummary[];
}

/** The part of a HAR 1.2 file this reads and rewrites. Playwright's extensions start with "_". */
export interface HarLike {
  log: {
    entries: Array<{
      startedDateTime?: string;
      time?: number;
      _resourceType?: string;
      request: {
        method: string;
        url: string;
        headers?: Array<{ name: string; value: string }>;
        cookies?: unknown[];
        queryString?: Array<{ name: string; value: string }>;
        postData?: { mimeType?: string; text?: string; params?: unknown[] };
      };
      response: {
        status: number;
        statusText?: string;
        headers?: Array<{ name: string; value: string }>;
        cookies?: unknown[];
        content?: { size?: number; text?: string };
        bodySize?: number;
        _transferSize?: number;
        _failureText?: string;
      };
    }>;
  };
}

const failedEntry = (status: number) => status === 0 || status >= 400;

function toSummary(entry: HarLike['log']['entries'][number]): NetworkRequestSummary {
  const status = Number(entry.response?.status) || 0;
  return {
    method: entry.request.method,
    url: entry.request.url,
    status,
    statusText: entry.response?._failureText || entry.response?.statusText || (status === 0 ? 'No response' : ''),
    timeMs: Math.max(0, Math.round(Number(entry.time) || 0)),
    resourceType: entry._resourceType ?? null,
  };
}

/** Reads a HAR into what the report shows. Pure: the tests hand it a HAR by hand. */
export function summariseHar(har: HarLike): NetworkSummary {
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];
  const all = entries.map(toSummary);
  const failures = all.filter((r) => failedEntry(r.status));
  const transferredBytes = entries.reduce((sum, entry) => {
    const size = entry.response?._transferSize ?? entry.response?.bodySize ?? 0;
    return sum + (Number.isFinite(size) && size > 0 ? size : 0);
  }, 0);
  return {
    requests: all.length,
    failed: failures.length,
    transferredBytes,
    // Server errors first: a 500 is more often the answer than a 404 for a favicon.
    failures: [...failures]
      .sort((a, b) => rankFailure(b.status) - rankFailure(a.status))
      .slice(0, MAX_FAILED_REQUESTS),
    slowest: [...all].sort((a, b) => b.timeMs - a.timeMs).slice(0, MAX_SLOW_REQUESTS),
  };
}

function rankFailure(status: number): number {
  if (status >= 500) return 3;
  if (status === 0) return 2;
  return 1;
}

/** Headers whose value is a credential. Matched case-insensitively. */
export const SENSITIVE_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
];

/** Query parameters whose value is a credential, e.g. an OAuth code or a signed link's token. */
const SENSITIVE_QUERY = /^(?:access_token|id_token|refresh_token|token|code|api_?key|key|secret|password|signature|sig|x-amz-signature|x-amz-security-token)$/i;

export const REDACTED = '[redacted]';

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let changed = false;
    for (const name of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY.test(name)) {
        parsed.searchParams.set(name, REDACTED);
        changed = true;
      }
    }
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      changed = true;
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
}

/**
 * The HAR as it may be kept: no credentials and no bodies.
 *
 * A HAR is everything the browser sent, and the browser sent the test user's session cookie, its
 * bearer token and the password typed into the login form. Kept as recorded, it would put those
 * in an artifact that anyone who can read the report can download, for as long as retention keeps
 * it. What stays is what diagnosing a failure needs: which request, when, what status, how long.
 */
export function sanitiseHar<T extends HarLike>(har: T): T {
  const scrubHeaders = (headers?: Array<{ name: string; value: string }>) =>
    headers?.map((h) => (SENSITIVE_HEADERS.includes(h.name.toLowerCase()) ? { ...h, value: REDACTED } : h));
  for (const entry of har.log.entries) {
    entry.request.url = redactUrl(entry.request.url);
    entry.request.headers = scrubHeaders(entry.request.headers);
    entry.request.cookies = [];
    if (entry.request.queryString) {
      entry.request.queryString = entry.request.queryString.map((q) => (SENSITIVE_QUERY.test(q.name) ? { ...q, value: REDACTED } : q));
    }
    if (entry.request.postData) {
      // A login form's body is the password. The size and type are still there.
      entry.request.postData = { mimeType: entry.request.postData.mimeType, text: REDACTED };
    }
    entry.response.headers = scrubHeaders(entry.response.headers);
    entry.response.cookies = [];
    if (entry.response.content?.text !== undefined) {
      entry.response.content = { ...entry.response.content, text: undefined };
    }
  }
  return har;
}

/** One line for the run's console and a failed test's reason: the requests most likely to be why. */
export function describeNetworkFailures(summary: NetworkSummary): string | null {
  const serious = summary.failures.filter((r) => r.status >= 500 || r.status === 0);
  if (serious.length === 0) return null;
  const shown = serious
    .slice(0, 3)
    .map((r) => `${r.method} ${pathOf(r.url)} → ${r.status === 0 ? r.statusText || 'no response' : r.status}`)
    .join('; ');
  return `${serious.length} request${serious.length === 1 ? '' : 's'} failed during this test: ${shown}` +
    (serious.length > 3 ? `; and ${serious.length - 3} more` : '') + '.';
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}
