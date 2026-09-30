import { describe, it, expect, afterAll } from 'vitest';
import { chromium, devices, webkit, type Browser } from 'playwright';
import { MOBILE_DEVICES } from '@shared/devices';
import { insertTestPlanSchema } from '@shared/schema';
import { browsersForRun, deviceContextOptions, onGrid } from './browsers';

/**
 * Phones and tablets in a plan's browser matrix: each row may emulate a device, which changes the
 * page's screen, touch, layout and user agent, and the label the report shows.
 */

describe('the devices offered', () => {
  it('are all devices Playwright knows', () => {
    for (const device of MOBILE_DEVICES) expect(devices[device.name], device.name).toBeDefined();
  });
});

describe('a plan that names a device', () => {
  const plan = (machines: unknown[]) => insertTestPlanSchema.safeParse({ name: 'Mobile', testMachinesConfig: machines, userId: 1, organizationId: 1 });

  it('is accepted for Chromium and WebKit, refused for Firefox and for a device nobody knows', () => {
    expect(plan([{ browserName: 'chromium', headless: true, device: 'Pixel 7' }]).success).toBe(true);
    expect(plan([{ browserName: 'webkit', headless: true, device: 'iPhone 15' }, { browserName: 'chromium', headless: true, device: null }]).success).toBe(true);
    const firefox = plan([{ browserName: 'firefox', headless: true, device: 'Pixel 7' }]);
    expect(firefox.success).toBe(false);
    expect(JSON.stringify(firefox.error!.issues)).toContain('Firefox cannot emulate');
    expect(plan([{ browserName: 'chromium', headless: true, device: 'Nokia 3310' }]).success).toBe(false);
  });

  it('runs one pass per device, labelled with it', () => {
    const { browsers, warnings } = browsersForRun({
      testMachines: [
        { browserName: 'chromium', headless: true },
        { browserName: 'chromium', headless: true, device: 'Pixel 7' },
        { browserName: 'safari', headless: true, device: 'iPhone 15' },
        { browserName: 'firefox', headless: true, device: 'iPhone 15' },
        { browserName: 'chromium', headless: true, device: 'Nokia 3310' },
      ],
    });
    expect(browsers.map((b) => b.label)).toEqual(['chromium', 'chromium · Pixel 7', 'safari · iPhone 15', 'firefox']);
    expect(browsers[2]).toMatchObject({ name: 'safari', engine: 'webkit', device: 'iPhone 15' });
    expect(warnings).toContain('Firefox cannot emulate iPhone 15: it ran as a desktop browser.');
    expect(warnings).toContain('Unknown device "Nokia 3310" for chromium: it ran as a desktop browser.');
    // Chromium as a desktop and as a Pixel 7 are two passes; the Nokia row is the same desktop pass again.
    expect(browsers.filter((b) => b.label === 'chromium')).toHaveLength(1);
  });

  it('keeps the browser name the grid maps, whatever the label says', () => {
    const { browsers } = browsersForRun({ testMachines: [{ browserName: 'chrome', headless: true, device: 'Galaxy S24', os: 'Windows', osVersion: '11' }], onGrid: true });
    const [pass] = onGrid(browsers, { id: 'g1', provider: 'browserstack', name: 'Cloud' });
    expect(pass.grid!.browserName).toBe('chrome');
    expect(pass.label).toBe('chrome · Galaxy S24 · Windows 11');
    expect(pass.device).toBe('Galaxy S24');
  });

  it('gives the device the context options, without choosing the engine', () => {
    const options = deviceContextOptions({ device: 'iPhone 15', engine: 'chromium' })!;
    expect(options).toMatchObject({ isMobile: true, hasTouch: true, viewport: devices['iPhone 15'].viewport });
    expect('defaultBrowserType' in options).toBe(false);
    expect(deviceContextOptions({ device: 'iPhone 15', engine: 'firefox' })).toBeUndefined();
    expect(deviceContextOptions({ engine: 'chromium' })).toBeUndefined();
  });
});

describe('in a real browser', () => {
  const opened: Browser[] = [];
  afterAll(async () => {
    for (const browser of opened) await browser.close();
  });

  const measure = async (browser: Browser, device: string, engine: 'chromium' | 'webkit') => {
    opened.push(browser);
    const context = await browser.newContext(deviceContextOptions({ device, engine }));
    const page = await context.newPage();
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><p>hi</p>');
    return page.evaluate(() => ({
      width: window.innerWidth,
      touch: navigator.maxTouchPoints > 0,
      agent: navigator.userAgent,
      coarse: matchMedia('(pointer: coarse)').matches,
    }));
  };

  it('is a phone to the page: its width, touch and user agent', async () => {
    const pixel = await measure(await chromium.launch(), 'Pixel 7', 'chromium');
    expect(pixel.width).toBe(devices['Pixel 7'].viewport.width);
    expect(pixel.touch).toBe(true);
    expect(pixel.coarse).toBe(true);
    expect(pixel.agent).toContain('Android');
  }, 60_000);

  it('works the same in WebKit for an iPhone', async () => {
    let browser: Browser;
    try {
      browser = await webkit.launch();
    } catch {
      // WebKit is not installed on every machine the suite runs on.
      return;
    }
    const iphone = await measure(browser, 'iPhone 15', 'webkit');
    expect(iphone.width).toBe(devices['iPhone 15'].viewport.width);
    expect(iphone.agent).toContain('iPhone');
  }, 60_000);
});
