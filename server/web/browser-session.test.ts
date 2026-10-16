import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  launchBrowser: vi.fn(),
  guardBrowserContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../runtime/browsers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runtime/browsers')>()),
  launchBrowser: mocks.launchBrowser,
}));
vi.mock('../platform/egress-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/egress-policy')>()),
  guardBrowserContext: mocks.guardBrowserContext,
}));

const {
  BrowserSessionError,
  DESKTOP_VIEWPORT,
  browserForSetting,
  contextOptionsFor,
  openBrowserSession,
} = await import('./browser-session');

function fakeBrowser(overrides: { newPage?: () => Promise<unknown> } = {}) {
  const page = { setDefaultTimeout: vi.fn() };
  const context = {
    newPage: vi.fn(overrides.newPage ?? (async () => page)),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    isConnected: vi.fn().mockReturnValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, context, page };
}

const chromium = browserForSetting('chromium', true);

beforeEach(() => {
  mocks.launchBrowser.mockReset();
  mocks.guardBrowserContext.mockClear();
});

describe('browserForSetting', () => {
  it('maps a known name and falls back to Chromium for anything else', () => {
    expect(browserForSetting('msedge', false)).toMatchObject({
      engine: 'chromium',
      channel: 'msedge',
      headless: false,
    });
    expect(browserForSetting('netscape', true)).toMatchObject({ engine: 'chromium' });
    expect(browserForSetting(undefined, true)).toMatchObject({ engine: 'chromium' });
  });
});

describe('contextOptionsFor', () => {
  it('pins the desktop window unless the session follows the window', () => {
    expect(contextOptionsFor({ browser: chromium }).viewport).toEqual(DESKTOP_VIEWPORT);
    expect(contextOptionsFor({ browser: chromium, viewport: 'window' }).viewport).toBeNull();
  });

  it('lets a session-specific option, such as a device, override the defaults', () => {
    const options = contextOptionsFor({
      browser: chromium,
      context: { viewport: { width: 390, height: 844 }, locale: 'it-IT' },
    });
    expect(options.viewport).toEqual({ width: 390, height: 844 });
    expect(options.locale).toBe('it-IT');
  });
});

describe('openBrowserSession', () => {
  it('guards a local browser, runs beforePage before the page, and closes everything once', async () => {
    const { browser, context, page } = fakeBrowser();
    mocks.launchBrowser.mockResolvedValue(browser);
    const order: string[] = [];
    context.newPage.mockImplementation(async () => {
      order.push('page');
      return page;
    });

    const session = await openBrowserSession({
      browser: chromium,
      url: 'https://example.test',
      timeoutMs: 1234,
      launchArgs: ['--start-maximized'],
      beforePage: async () => {
        order.push('beforePage');
      },
    });

    expect(mocks.launchBrowser).toHaveBeenCalledWith(chromium, undefined, ['--start-maximized']);
    expect(mocks.guardBrowserContext).toHaveBeenCalledWith(context);
    expect(order).toEqual(['beforePage', 'page']);
    expect(page.setDefaultTimeout).toHaveBeenCalledWith(1234);

    await session.close();
    await session[Symbol.asyncDispose]();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('leaves the egress guard off for a grid browser', async () => {
    const { browser } = fakeBrowser();
    mocks.launchBrowser.mockResolvedValue(browser);
    await openBrowserSession({
      browser: { ...chromium, grid: { id: 1, name: 'g', provider: 'browserstack' } as any },
    });
    expect(mocks.guardBrowserContext).not.toHaveBeenCalled();
  });

  it("leaves it off for an agent's browser too: its network is its owner's", async () => {
    const { browser } = fakeBrowser();
    mocks.launchBrowser.mockResolvedValue(browser);
    await openBrowserSession({ browser: { ...chromium, agent: { pool: 'p' } as any } });
    expect(mocks.guardBrowserContext).not.toHaveBeenCalled();
  });

  it('reports the stage that failed and closes the browser it launched', async () => {
    const { browser } = fakeBrowser({
      newPage: async () => {
        throw new Error('no page for you');
      },
    });
    mocks.launchBrowser.mockResolvedValue(browser);

    const error = await openBrowserSession({ browser: chromium }).catch((e) => e);
    expect(error).toBeInstanceOf(BrowserSessionError);
    expect(error.stage).toBe('page');
    expect(error.message).toBe('no page for you');
    expect(browser.close).toHaveBeenCalled();
  });

  it('keeps the launch failure message as it was', async () => {
    mocks.launchBrowser.mockRejectedValue(new Error('Could not start msedge on this runner'));
    const error = await openBrowserSession({ browser: chromium }).catch((e) => e);
    expect(error.stage).toBe('launch');
    expect(error.message).toBe('Could not start msedge on this runner');
  });
});

/**
 * The egress guard holds only if nothing goes round it: the recorder, detection, the preview
 * and the run share this session, and every navigation goes through gotoWithinPolicy, which
 * refuses file:// before the browser is asked. A new call site that opens its own context,
 * launches its own browser or calls page.goto directly fails here rather than in an audit.
 */
describe('no way round the browser egress guard', () => {
  const serverRoot = path.resolve(__dirname, '..');
  const sources = (): { file: string; text: string }[] => {
    const out: { file: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name))
          out.push({
            file: path.relative(serverRoot, full).split(path.sep).join('/'),
            text: readFileSync(full, 'utf8'),
          });
      }
    };
    walk(serverRoot);
    return out;
  };
  const filesMatching = (pattern: RegExp) =>
    sources()
      .filter(({ text }) => pattern.test(text))
      .map(({ file }) => file)
      .sort();

  it('navigates only through gotoWithinPolicy', () => {
    // playwright-export.ts writes `p.goto(` into the code it exports; it navigates nothing.
    expect(filesMatching(/\.goto\(/)).toEqual([
      'integrations/playwright-export.ts',
      'platform/egress-policy.ts',
    ]);
  });

  it("opens browser contexts only in the shared session (the agent's own side apart)", () => {
    expect(filesMatching(/\.newContext\(/)).toEqual([
      'runtime/agents/agent-fetch.ts',
      'web/browser-session.ts',
    ]);
  });

  it('launches local browsers only behind the egress options', () => {
    // report-export.ts renders the server's own report HTML to PDF, behind WFM_EGRESS_PROXY.
    expect(filesMatching(/\.launch\(\{/)).toEqual([
      'reporting/report-export.ts',
      'runtime/browsers.ts',
    ]);
  });
});
