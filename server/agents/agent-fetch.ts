import type { Browser, BrowserContext } from 'playwright';
import { allowsSelfSignedCertificate } from '../outbound-http';
import { connectToAgentBrowser, type AgentTarget } from './agent-browser';

/**
 * HTTP requests sent from a local agent's machine, for the API tests, API preconditions and
 * OAuth token requests of a run whose plan runs on an agent pool.
 *
 * No new protocol: a browser borrowed from the agent already carries Playwright's request API,
 * and Playwright executes those requests where the browser lives. So the agent that lends
 * browsers also sends requests, including agents installed before this existed.
 *
 * What goes in and comes out is `fetch`, so the API runners take it as they take the server's
 * own transport and cannot tell the difference. Each request gets a fresh browser context,
 * because a context keeps cookies and `fetch` does not: one API test's session cookie must not
 * reach the next test, which on the server it never did.
 */

/** Where a request could not be made at all, worded like the server's own `fetch` errors. */
function abortError(): Error {
  return new DOMException('This operation was aborted', 'AbortError');
}

/** A body `fetch` accepts, as Playwright wants it. The API runners send text; others are refused. */
function requestData(body: BodyInit | null | undefined): string | Buffer | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new TypeError('Requests sent from an agent carry text or bytes as their body.');
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  new Headers(headers ?? {}).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

/** Statuses whose response has no body, which the Response constructor insists on. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** `fetch`, sent from whatever machine `browser` runs on. */
export function fetchThroughBrowser(browser: () => Promise<Browser>): typeof fetch {
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const signal = init.signal ?? undefined;
    if (signal?.aborted) throw abortError();

    // The caller hears of the abort at once, whether it comes while the browser is still being
    // borrowed or while the request is out. Closing the context does end the request on the
    // agent's side, but only when the agent gets to it, and a caller's timeout means now.
    let onAbort = () => {};
    const abandoned = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(abortError());
    });
    abandoned.catch(() => {});
    signal?.addEventListener('abort', onAbort, { once: true });
    const opening = browser().then((borrowed) => borrowed.newContext());
    let context: BrowserContext;
    try {
      context = await Promise.race([opening, abandoned]);
    } catch (error) {
      signal?.removeEventListener('abort', onAbort);
      void opening.then((late) => late.close()).catch(() => {});
      throw error;
    }
    try {
      const sent = context.request.fetch(url, {
        method,
        headers: headerRecord(init.headers),
        data: requestData(init.body),
        maxRedirects: init.redirect === 'manual' || init.redirect === 'error' ? 0 : 20,
        // The same per-host exemption the server applies (INSECURE_TLS_HOSTS), decided here.
        ignoreHTTPSErrors: allowsSelfSignedCertificate(url),
        // The callers own the timeout, through `signal`, as they do with the server's fetch.
        timeout: 0,
      });
      sent.catch(() => {}); // abandoned requests end in an error nobody is waiting for
      const response = await Promise.race([sent, abandoned]);
      const body =
        method === 'HEAD' || NULL_BODY_STATUSES.has(response.status())
          ? null
          : await Promise.race([response.body(), abandoned]);
      const headers = new Headers();
      for (const { name, value } of response.headersArray()) headers.append(name, value);
      return new Response(body, { status: response.status(), statusText: response.statusText(), headers });
    } finally {
      signal?.removeEventListener('abort', onAbort);
      void context.close().catch(() => {});
    }
  };
}

/**
 * The transport one run's API requests use when its plan runs on a pool.
 *
 * The browser is borrowed on the first request, not before: a plan with no API tests and no
 * preconditions never asks the pool for one. It is kept for the run and borrowed again if the
 * agent went away in between, then given back by `close`.
 */
export class AgentHttp {
  private borrowed: Promise<Browser> | null = null;
  readonly fetch: typeof fetch;

  constructor(
    readonly agent: AgentTarget,
    private readonly connect: (agent: AgentTarget) => Promise<Browser> = (target) =>
      connectToAgentBrowser({ engine: 'chromium', headless: true, agent: target }),
  ) {
    this.fetch = fetchThroughBrowser(() => this.browser());
  }

  private async browser(): Promise<Browser> {
    const existing = this.borrowed;
    if (existing) {
      const current = await existing.catch(() => null);
      if (current?.isConnected()) return current;
      // Another request already borrowed a replacement while this one waited.
      if (this.borrowed !== existing) return this.browser();
    }
    const attempt = this.connect(this.agent).catch((error: Error) => {
      throw new Error(`Could not send the request from agent pool "${this.agent.pool}": ${error.message}`);
    });
    this.borrowed = attempt;
    return attempt;
  }

  async close(): Promise<void> {
    const browser = await this.borrowed?.catch(() => null);
    this.borrowed = null;
    await browser?.close().catch(() => {});
  }
}
