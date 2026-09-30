import type { MobileLocator } from '@shared/mobile';

/**
 * The part of the W3C WebDriver protocol an Appium test needs, over fetch.
 *
 * A client of a dozen calls rather than webdriverio: everything a mobile step does is a request
 * and an answer, the cloud grids speak plain W3C WebDriver, and a small client is one whose every
 * request can be read here and stood in for in a test.
 */

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

export class WebDriverError extends Error {
  constructor(
    message: string,
    /** The W3C error code: "no such element", "invalid session id"… */
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface SessionRequest {
  hubUrl: string;
  /** Basic authentication for the hub, when the credentials do not travel in the capabilities. */
  authorization?: string;
  capabilities: Record<string, unknown>;
  /** A cloud session takes a while to find a device and install the app. */
  timeoutMs?: number;
  fetch?: Fetch;
}

export class AppiumSession {
  private constructor(
    private readonly base: string,
    readonly id: string,
    private readonly headers: Record<string, string>,
    private readonly doFetch: Fetch,
    /** What the grid answered it opened: the device, the OS, the platform. */
    readonly capabilities: Record<string, unknown>,
  ) {}

  static async open(request: SessionRequest): Promise<AppiumSession> {
    const base = request.hubUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (request.authorization) headers.Authorization = request.authorization;
    const doFetch = request.fetch ?? ((url, init) => fetch(url, init));
    const answer = await call(doFetch, `${base}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ capabilities: { alwaysMatch: request.capabilities, firstMatch: [{}] } }),
      signal: AbortSignal.timeout(request.timeoutMs ?? 300_000),
    });
    const id = answer?.sessionId ?? answer?.value?.sessionId;
    if (!id) throw new WebDriverError('The grid opened no session.', null, 500);
    return new AppiumSession(base, String(id), headers, doFetch, answer?.value?.capabilities ?? {});
  }

  private request(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    return call(this.doFetch, `${this.base}/session/${this.id}${path}`, {
      method,
      headers: this.headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : method === 'POST' ? { body: '{}' } : {}),
      signal: AbortSignal.timeout(120_000),
    });
  }

  /** The element, or null when there is none now. */
  async find(locator: MobileLocator): Promise<string | null> {
    try {
      const answer = await this.request('POST', '/element', locator);
      return answer?.value?.[ELEMENT_KEY] ?? answer?.value?.ELEMENT ?? null;
    } catch (error) {
      if (error instanceof WebDriverError && error.code === 'no such element') return null;
      throw error;
    }
  }

  click(element: string) {
    return this.request('POST', `/element/${element}/click`);
  }

  type(element: string, text: string) {
    return this.request('POST', `/element/${element}/value`, { text });
  }

  clear(element: string) {
    return this.request('POST', `/element/${element}/clear`);
  }

  async text(element: string): Promise<string> {
    return String((await this.request('GET', `/element/${element}/text`))?.value ?? '');
  }

  async displayed(element: string): Promise<boolean> {
    return (await this.request('GET', `/element/${element}/displayed`))?.value === true;
  }

  back() {
    return this.request('POST', '/back');
  }

  /** Appium's own command; a keyboard that is not shown is not an error. */
  async hideKeyboard() {
    try {
      await this.request('POST', '/appium/device/hide_keyboard');
    } catch {
      // Nothing to hide.
    }
  }

  async windowSize(): Promise<{ width: number; height: number }> {
    const value = (await this.request('GET', '/window/rect'))?.value ?? {};
    return { width: Number(value.width) || 0, height: Number(value.height) || 0 };
  }

  /** A finger from one point to another, as W3C pointer actions. */
  drag(from: { x: number; y: number }, to: { x: number; y: number }, durationMs = 400) {
    return this.request('POST', '/actions', {
      actions: [
        {
          type: 'pointer',
          id: 'finger',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: Math.round(from.x), y: Math.round(from.y) },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerMove', duration: durationMs, x: Math.round(to.x), y: Math.round(to.y) },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
  }

  /** The app's view tree as XML (shared/mobile-inspector.ts reads it). */
  async source(): Promise<string> {
    return String((await this.request('GET', '/source'))?.value ?? '');
  }

  /** A finger down and up on one point of the screen, in the window's coordinates. */
  tapAt(point: { x: number; y: number }) {
    return this.request('POST', '/actions', {
      actions: [
        {
          type: 'pointer',
          id: 'finger',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: Math.round(point.x), y: Math.round(point.y) },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 80 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
  }

  async screenshot(): Promise<string | null> {
    try {
      return String((await this.request('GET', '/screenshot'))?.value ?? '') || null;
    } catch {
      return null;
    }
  }

  execute(script: string, args: unknown[] = []) {
    return this.request('POST', '/execute/sync', { script, args });
  }

  async close() {
    try {
      await this.request('DELETE', '');
    } catch {
      // Already gone: a grid ends an idle session on its own.
    }
  }
}

async function call(doFetch: Fetch, url: string, init: RequestInit): Promise<any> {
  let response: Response;
  try {
    response = await doFetch(url, init);
  } catch (error: any) {
    const reason = error?.name === 'TimeoutError' ? 'no answer in time' : error?.message ?? String(error);
    throw new WebDriverError(`The grid could not be reached: ${reason}.`, null, 0);
  }
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok || body?.value?.error) {
    const code = body?.value?.error ?? null;
    const message = body?.value?.message ?? (text.slice(0, 300) || `HTTP ${response.status}`);
    throw new WebDriverError(String(message).split('\n')[0], code, response.status);
  }
  return body;
}
