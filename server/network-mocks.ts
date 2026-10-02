import type { BrowserContext, Route } from 'playwright';

/**
 * Answering the page's requests in a test, instead of the application's servers (the steps
 * mockRequest, blockRequests and clearMocks).
 *
 * What a test cannot otherwise do: show the screen for an error the backend rarely gives (a 500,
 * an empty list, a slow answer), run against a backend that is not ready, or keep a third party —
 * analytics, chat, payments — out of the run. Routes are set on the browser context, so they hold
 * for the rest of the test and in every tab it opens; a later one for the same address wins, which
 * is how a test changes its mind halfway ("now the order list is empty").
 *
 * Only what the page itself requests is affected: preconditions, cleanup and API tests are sent by
 * the runner, not the browser.
 */

export interface MockSpec {
  /** Upper case; null for any method. */
  method: string | null;
  /** A URL, or a glob in Playwright's syntax: `**` any characters, `*` any but `/`. */
  pattern: string;
  status: number;
  /** Milliseconds before answering, to see a loading state. */
  delayMs: number;
  body: string;
  contentType: string;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
/** Long enough for any spinner, short enough that a typo does not hold the run. */
export const MAX_MOCK_DELAY_MS = 30_000;

/**
 * `[METHOD ]pattern | status[ after <n>ms] | body`. The body is everything after the second `|`,
 * so it may contain `|` itself; JSON is answered as application/json, anything else as text.
 * Status and body may be left out: `**\/api/orders | 500` answers an empty 500; a bare pattern
 * answers an empty 200.
 */
export function parseMockSpec(value: string): MockSpec | { error: string } {
  const [target = '', statusPart = '', ...rest] = value.split('|');
  const body = rest.join('|').trim();
  let pattern = target.trim();
  let method: string | null = null;
  const methodMatch = /^([A-Za-z]+)\s+(\S.*)$/.exec(pattern);
  if (methodMatch && METHODS.includes(methodMatch[1].toUpperCase())) {
    method = methodMatch[1].toUpperCase();
    pattern = methodMatch[2].trim();
  }
  if (!pattern) return { error: 'Name the address to answer: a URL or a pattern such as **/api/orders*.' };

  let status = 200;
  let delayMs = 0;
  const statusText = statusPart.trim();
  if (statusText) {
    const match = /^(\d{3})(?:\s+after\s+(\d+)\s*(ms|s))?$/i.exec(statusText);
    if (!match) return { error: `"${statusText}" is not a status: write 200, 404, or 200 after 1500ms.` };
    status = Number(match[1]);
    if (status < 100 || status > 599) return { error: `${status} is not an HTTP status.` };
    if (match[2]) delayMs = Number(match[2]) * (match[3].toLowerCase() === 's' ? 1000 : 1);
    if (delayMs > MAX_MOCK_DELAY_MS) return { error: `A delay of at most ${MAX_MOCK_DELAY_MS / 1000} s.` };
  }
  return { method, pattern, status, delayMs, body, contentType: looksLikeJson(body) ? 'application/json' : 'text/plain; charset=utf-8' };
}

function looksLikeJson(body: string): boolean {
  if (!/^[[{"]/.test(body) && !/^(true|false|null|-?\d)/.test(body)) return false;
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

/** Mocks and blocks a run has set, so clearMocks can take them all back. */
const installed = new WeakMap<BrowserContext, Array<{ pattern: string; handler: (route: Route) => Promise<void> }>>();

function remember(context: BrowserContext, pattern: string, handler: (route: Route) => Promise<void>) {
  const list = installed.get(context) ?? [];
  list.push({ pattern, handler });
  installed.set(context, list);
}

export async function installMock(context: BrowserContext, spec: MockSpec): Promise<void> {
  const handler = async (route: Route) => {
    // A route for another method passes the request on, to an earlier route or the network.
    if (spec.method && route.request().method() !== spec.method) return route.fallback();
    if (spec.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, spec.delayMs));
    await route.fulfill({
      status: spec.status,
      contentType: spec.contentType,
      body: spec.body,
      // A page on another origin than the API would otherwise refuse the answer.
      headers: { 'access-control-allow-origin': '*' },
    }).catch(() => undefined);
  };
  await context.route(spec.pattern, handler);
  remember(context, spec.pattern, handler);
}

/** Every request matching the pattern fails as if the network were down. */
export async function installBlock(context: BrowserContext, pattern: string): Promise<void> {
  const handler = (route: Route) => route.abort('blockedbyclient').catch(() => undefined);
  await context.route(pattern, handler);
  remember(context, pattern, handler);
}

/** Takes back every mock and block the test set: the page talks to the real servers again. */
export async function clearMocks(context: BrowserContext): Promise<number> {
  const list = installed.get(context) ?? [];
  for (const { pattern, handler } of list) await context.unroute(pattern, handler).catch(() => undefined);
  installed.delete(context);
  return list.length;
}
