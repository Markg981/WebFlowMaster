import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  launchBrowser: vi.fn(),
  guardBrowserContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../runtime/browsers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runtime/browsers')>()),
  launchBrowser: mocks.launchBrowser,
}));
vi.mock('../egress-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../egress-policy')>()),
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
