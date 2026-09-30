import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chromium, type BrowserServer } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from './db';
import { browserGrids, updateTestPlanApiPayloadSchema } from '@shared/schema';
import { encryptSecret } from './crypto';
import { checkRunOn, gridConnection, gridWarnings, type GridConfig, type GridMachine } from './browser-grids';
import { browsersForRun, describeBrowser, launchBrowser, onGrid } from './browsers';
import { runWithTenant } from './middleware/tenancy';
import { createTestOrganization } from './tests/factories';

vi.mock('./logger', () => ({
  default: Promise.resolve({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn() }),
  updateLogLevel: vi.fn(),
}));

/**
 * Running a plan's browsers on a grid: what each provider is asked for, what the report calls
 * each pass, and a real connection to a Playwright server.
 */

const grid = (provider: GridConfig['provider'], overrides: Partial<GridConfig> = {}): GridConfig => ({
  id: 'g', name: 'Cloud', provider, username: 'acme', endpoint: null, key: 's3cret', ...overrides,
});
const machine = (overrides: Partial<GridMachine> = {}): GridMachine => ({
  label: 'chrome', engine: 'chromium', sessionName: 'Login', buildName: 'Run 1', ...overrides,
});
const capsOf = (endpoint: string, param: string) => JSON.parse(decodeURIComponent(new URL(endpoint).searchParams.get(param)!));

describe('what a grid is asked for', () => {
  it('BrowserStack: the browser, OS and version of the plan, with the account in the capabilities', () => {
    const { wsEndpoint, engine } = gridConnection(grid('browserstack'), machine({ os: 'Windows', osVersion: '10', browserVersion: '120' }));
    expect(wsEndpoint.startsWith('wss://cdp.browserstack.com/playwright?caps=')).toBe(true);
    expect(engine).toBe('chromium');
    expect(capsOf(wsEndpoint, 'caps')).toMatchObject({
      browser: 'chrome', browser_version: '120', os: 'Windows', os_version: '10', name: 'Login', build: 'Run 1',
      'browserstack.username': 'acme', 'browserstack.accessKey': 's3cret', 'client.playwrightVersion': expect.any(String),
    });
  });

  it('BrowserStack: Playwright engines by their names there, WebKit on macOS unless told otherwise', () => {
    const webkit = capsOf(gridConnection(grid('browserstack'), machine({ label: 'safari', engine: 'webkit' })).wsEndpoint, 'caps');
    expect(webkit).toMatchObject({ browser: 'playwright-webkit', os: 'OS X', os_version: 'Sonoma', browser_version: 'latest' });
    const firefox = capsOf(gridConnection(grid('browserstack'), machine({ label: 'firefox', engine: 'firefox', os: 'macOS', osVersion: 'Ventura' })).wsEndpoint, 'caps');
    expect(firefox).toMatchObject({ browser: 'playwright-firefox', os: 'OS X', os_version: 'Ventura' });
    expect(capsOf(gridConnection(grid('browserstack'), machine({ label: 'edge' })).wsEndpoint, 'caps').browser).toBe('edge');
  });

  it('LambdaTest: its names, and the platform as one string', () => {
    const { wsEndpoint } = gridConnection(grid('lambdatest'), machine({ label: 'edge', os: 'Windows', osVersion: '11' }));
    expect(wsEndpoint.startsWith('wss://cdp.lambdatest.com/playwright?capabilities=')).toBe(true);
    expect(capsOf(wsEndpoint, 'capabilities')).toMatchObject({
      browserName: 'MicrosoftEdge', browserVersion: 'latest',
      'LT:Options': { platform: 'Windows 11', user: 'acme', accessKey: 's3cret', name: 'Login', build: 'Run 1' },
    });
    expect(capsOf(gridConnection(grid('lambdatest'), machine({ label: 'webkit', engine: 'webkit' })).wsEndpoint, 'capabilities'))
      .toMatchObject({ browserName: 'pw-webkit', 'LT:Options': { platform: 'MacOS Sonoma' } });
  });

  it('a Playwright server: its own address, with the token where it asks for it or as a bearer', () => {
    expect(gridConnection(grid('playwright_server', { endpoint: 'wss://bl.example/playwright?token={token}', key: 'a b' }), machine()))
      .toEqual({ engine: 'chromium', wsEndpoint: 'wss://bl.example/playwright?token=a%20b' });
    expect(gridConnection(grid('playwright_server', { endpoint: 'ws://grid:3000/', key: 'k' }), machine({ engine: 'firefox' })))
      .toEqual({ engine: 'firefox', wsEndpoint: 'ws://grid:3000/', headers: { Authorization: 'Bearer k' } });
    expect(gridConnection(grid('playwright_server', { endpoint: 'ws://grid:3000/', key: null }), machine()))
      .toEqual({ engine: 'chromium', wsEndpoint: 'ws://grid:3000/' });
  });

  it('says what a grid cannot deliver', () => {
    expect(gridWarnings('browserstack', { label: 'chrome', os: 'Windows', browserVersion: '118' })).toEqual([]);
    expect(gridWarnings('lambdatest', { label: 'safari' })[0]).toMatch(/WebKit/);
    expect(gridWarnings('playwright_server', { label: 'chrome', os: 'Windows', osVersion: '11', browserVersion: '118' })[0])
      .toMatch(/Windows, 11, chrome 118 not applied/);
  });
});

describe('a plan on a grid', () => {
  it('keeps machines that differ only by OS apart, and labels each pass with its machine', () => {
    const { browsers, warnings } = browsersForRun({
      testMachines: [
        { browserName: 'chrome', os: 'Windows', osVersion: '11', headless: true },
        { browserName: 'chrome', os: 'macOS', osVersion: 'Sonoma', headless: true },
        { browserName: 'firefox', browserVersion: '125', headless: false },
      ],
      onGrid: true,
    });
    expect(warnings).toEqual([]);
    const passes = onGrid(browsers, { id: 'g', provider: 'browserstack', name: 'Cloud' });
    expect(passes.map((pass) => pass.label)).toEqual(['chrome · Windows 11', 'chrome · macOS Sonoma', 'firefox 125']);
    expect(passes.every((pass) => pass.headless && pass.grid?.provider === 'browserstack')).toBe(true);
    expect(passes[0].grid?.browserName).toBe('chrome');
    expect(describeBrowser(passes[0])).toBe('chrome · Windows 11 (chromium/chrome) on BrowserStack "Cloud"');
  });

  it('accepts a machine that names only its browser, as the plan settings dialog saves it', () => {
    // OS and versions were required, so every save of the dialog's browser list was a 400.
    expect(updateTestPlanApiPayloadSchema.safeParse({ testMachinesConfig: [{ browserName: 'firefox', headless: true }] }).success).toBe(true);
    expect(updateTestPlanApiPayloadSchema.safeParse({ testMachinesConfig: [{ browserName: 'chrome', headless: true, os: 'Windows', osVersion: '11', browserVersion: null }], browserGridId: 'g' }).success).toBe(true);
  });

  it('on the runners, still warns that OS and versions are not theirs to choose', () => {
    const { warnings } = browsersForRun({ testMachines: [{ browserName: 'chrome', os: 'Windows', osVersion: '11', headless: true }] });
    expect(warnings.join(' ')).toMatch(/not applied/);
  });
});

describe('a grid in the database', () => {
  let server: BrowserServer;
  let organizationId: number;
  let otherOrganizationId: number;
  let gridId: string;

  beforeAll(async () => {
    server = await chromium.launchServer({ headless: true });
    organizationId = await createTestOrganization('Grid Org');
    otherOrganizationId = await createTestOrganization('Other Grid Org');
    gridId = uuidv4();
    const token = encryptSecret('unused-token');
    await privilegedDb.insert(browserGrids).values({
      id: gridId, organizationId, name: 'Own server', provider: 'playwright_server', endpoint: server.wsEndpoint(),
      encryptedKey: token.encryptedValue, keyIv: token.iv, keyAuthTag: token.authTag,
    });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it('opens the browser on the grid, as the runner would', async () => {
    const [pass] = onGrid([undefined], { id: gridId, provider: 'playwright_server', name: 'Own server' });
    const browser = await runWithTenant(organizationId, () => launchBrowser(pass, { name: 'Login', build: 'Run 1' }));
    try {
      const page = await browser.newPage();
      await page.setContent('<h1>on the grid</h1>');
      expect(await page.textContent('h1')).toBe('on the grid');
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("is not another organization's to use", async () => {
    const [pass] = onGrid([undefined], { id: gridId, provider: 'playwright_server', name: 'Own server' });
    await expect(runWithTenant(otherOrganizationId, () => launchBrowser(pass))).rejects.toThrow(/no longer exists/);
    expect(await runWithTenant(otherOrganizationId, () => checkRunOn({ browserGridId: gridId }))).toMatchObject({ ok: false });
  });

  it('decides where a plan runs: agents or a grid, never both', async () => {
    expect(await runWithTenant(organizationId, () => checkRunOn({ agentPool: 'lab', browserGridId: gridId }))).toMatchObject({ ok: false });
    expect(await runWithTenant(organizationId, () => checkRunOn({ browserGridId: gridId }))).toEqual({ ok: true, changes: { browserGridId: gridId, agentPool: null } });
    expect(await runWithTenant(organizationId, () => checkRunOn({ agentPool: 'lab' }))).toEqual({ ok: true, changes: { agentPool: 'lab', browserGridId: null } });
    expect(await runWithTenant(organizationId, () => checkRunOn({ name: 'x' } as never))).toEqual({ ok: true, changes: { name: 'x' } });
  });

  it('says why when the grid cannot be reached, without repeating its address', async () => {
    const unreachable = uuidv4();
    await privilegedDb.insert(browserGrids).values({ id: unreachable, organizationId, name: 'Down', provider: 'playwright_server', endpoint: 'ws://127.0.0.1:9/?secret=abc' });
    const [pass] = onGrid([undefined], { id: unreachable, provider: 'playwright_server', name: 'Down' });
    const error = await runWithTenant(organizationId, () => launchBrowser(pass)).catch((e: Error) => e);
    expect(String(error)).toMatch(/Could not open chromium on the Playwright server grid "Down"/);
    expect(String(error)).not.toContain('secret=abc');
  }, 120_000);
});
