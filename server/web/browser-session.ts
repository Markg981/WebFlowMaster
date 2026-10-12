import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { allowsSelfSignedCertificate } from '../outbound-http';
import { guardBrowserContext } from '../egress-policy';
import { launchBrowser, resolveBrowser, type BrowserChoice, type BrowserEngine } from '../browsers';

/**
 * The one way the server opens a browser: launch, context, page.
 *
 * Recording, element detection, the builder's preview and the real run each used to launch
 * and configure their own browser. The context options — the egress proxy, self-signed
 * certificates, the window size — were copied four times and had already started to differ,
 * with no test that would notice: a preview could pass on settings the run never used.
 * Whatever a session needs that the others do not is now an option here, by name.
 */

export const DEFAULT_ENGINE: BrowserEngine = 'chromium';

/** The window every non-device session renders in, so detection boxes and run screenshots agree. */
export const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

/**
 * The user agent the authoring tools (recorder, detection, preview) present.
 *
 * A fixed desktop Chrome, so a site that serves a different page to "HeadlessChrome" shows the
 * tester the page they will write the test against. Scheduled runs do not set it.
 */
export const AUTHORING_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** The browser a user's setting names, or Chromium when it names none this server knows. */
export function browserForSetting(
  name: string | null | undefined,
  headless: boolean,
): BrowserChoice {
  return (
    resolveBrowser(name || DEFAULT_ENGINE, headless) ?? {
      label: DEFAULT_ENGINE,
      engine: DEFAULT_ENGINE,
      headless,
    }
  );
}

export interface BrowserSessionOptions {
  browser: BrowserChoice;
  /** The address the session opens first: decides whether a self-signed certificate is accepted. */
  url?: string | null;
  /**
   * 'desktop' pins the page to DESKTOP_VIEWPORT; 'window' lets it follow a headed window (the
   * recorder, which a person works in). A device in `context` brings its own screen.
   */
  viewport?: 'desktop' | 'window';
  userAgent?: string;
  /** The page's default timeout for actions. */
  timeoutMs?: number;
  /** Command-line switches for a locally launched browser. */
  launchArgs?: string[];
  /** How a grid's dashboard names the session. */
  gridSession?: { name: string; build: string };
  /** What only this session needs: a saved login, a locale, a device, video, HAR. */
  context?: BrowserContextOptions;
  /** Runs on the context before its first page exists: bindings, init scripts, tracing. */
  beforePage?: (context: BrowserContext) => Promise<void>;
}

/** Which step of opening a session failed, for callers that report infrastructure failures. */
export type BrowserSessionStage = 'launch' | 'context' | 'page';

export class BrowserSessionError extends Error {
  constructor(
    readonly stage: BrowserSessionStage,
    cause: unknown,
  ) {
    super((cause as any)?.message ?? String(cause), { cause });
    this.name = 'BrowserSessionError';
    if ((cause as any)?.stack) this.stack = (cause as any).stack;
  }
}

export interface BrowserSession extends AsyncDisposable {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Closes the context and the browser. Never throws, and is safe to call twice. */
  close(): Promise<void>;
}

export function contextOptionsFor(opts: BrowserSessionOptions): BrowserContextOptions {
  return {
    ignoreHTTPSErrors: allowsSelfSignedCertificate(opts.url ?? ''),
    viewport: opts.viewport === 'window' ? null : DESKTOP_VIEWPORT,
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    ...opts.context,
  };
}

async function closeAll(browser: Browser, context: BrowserContext | null): Promise<void> {
  if (context) await context.close().catch(() => {});
  if (browser.isConnected()) await browser.close().catch(() => {});
}

export async function openBrowserSession(opts: BrowserSessionOptions): Promise<BrowserSession> {
  let browser: Browser;
  try {
    browser = await launchBrowser(opts.browser, opts.gridSession, opts.launchArgs);
  } catch (error) {
    throw new BrowserSessionError('launch', error);
  }

  let context: BrowserContext | null = null;
  let stage: BrowserSessionStage = 'context';
  try {
    context = await browser.newContext(contextOptionsFor(opts));
    // The runner's own browser is on the runner's network, which the policy protects. A
    // grid's or an agent's browser is on its owner's, where the policy has no say.
    if (!opts.browser.grid && !opts.browser.agent) await guardBrowserContext(context);
    await opts.beforePage?.(context);
    stage = 'page';
    const page = await context.newPage();
    if (opts.timeoutMs) page.setDefaultTimeout(opts.timeoutMs);

    const opened = context;
    let closing: Promise<void> | null = null;
    const close = () => (closing ??= closeAll(browser, opened));
    return { browser, context, page, close, [Symbol.asyncDispose]: close };
  } catch (error) {
    await closeAll(browser, context);
    throw new BrowserSessionError(stage, error);
  }
}
