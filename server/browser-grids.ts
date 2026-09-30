import { createRequire } from 'module';
import { eq } from 'drizzle-orm';
import type { Page } from 'playwright';
import { browserGrids, type BrowserGrid } from '@shared/schema';
import { HONOURS_MACHINE, type BrowserGridProvider } from '@shared/browser-grids';
import { withTenantTransaction } from './middleware/tenancy';
import { decryptSecret } from './crypto';
import type { BrowserEngine } from './browsers';

/**
 * Connecting a run's browser to a grid (shared/browser-grids.ts).
 *
 * Each provider takes the same thing — a Playwright `connect` to a WebSocket — with what to run
 * written into the address: BrowserStack and LambdaTest as capabilities, a Playwright server as
 * nothing at all, since it runs what it has. The credentials are decrypted here, in the runner,
 * when the browser is needed, and travel only in that address or header: never in a job, a log
 * or a snapshot.
 */

const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION: string = require('playwright/package.json').version;

export interface GridConfig {
  id: string;
  name: string;
  provider: BrowserGridProvider;
  username: string | null;
  endpoint: string | null;
  key: string | null;
}

/** The machine a run asks the grid for — the plan's row, as the runner reads it. */
export interface GridMachine {
  /** The name the plan used: chrome, edge, chromium, firefox, webkit, safari. */
  label: string;
  engine: BrowserEngine;
  os?: string | null;
  osVersion?: string | null;
  browserVersion?: string | null;
  /** Shown in the provider's dashboard: the test, and the run it belongs to. */
  sessionName: string;
  buildName: string;
}

export interface GridConnection {
  engine: BrowserEngine;
  wsEndpoint: string;
  headers?: Record<string, string>;
}

const isMac = (os?: string | null) => /mac|os ?x/i.test(os ?? '');

/** The browser as BrowserStack names it. Branded Chrome and Edge are real; the others are Playwright's. */
function browserStackBrowser(label: string): string {
  switch (label) {
    case 'chrome': return 'chrome';
    case 'edge':
    case 'msedge': return 'edge';
    case 'firefox': return 'playwright-firefox';
    case 'webkit':
    case 'safari': return 'playwright-webkit';
    default: return 'playwright-chromium';
  }
}

function lambdaTestBrowser(label: string): string {
  switch (label) {
    case 'chrome': return 'Chrome';
    case 'edge':
    case 'msedge': return 'MicrosoftEdge';
    case 'firefox': return 'pw-firefox';
    case 'webkit':
    case 'safari': return 'pw-webkit';
    default: return 'pw-chromium';
  }
}

/** WebKit runs on macOS on both clouds; everything else defaults to Windows 11. */
function defaultOs(machine: GridMachine): { os: string; osVersion: string } {
  const wantsMac = isMac(machine.os) || (!machine.os && machine.engine === 'webkit');
  if (wantsMac) return { os: 'OS X', osVersion: machine.osVersion || 'Sonoma' };
  return { os: 'Windows', osVersion: machine.osVersion || '11' };
}

export function gridConnection(grid: GridConfig, machine: GridMachine): GridConnection {
  const version = machine.browserVersion?.trim() || 'latest';
  switch (grid.provider) {
    case 'browserstack': {
      const { os, osVersion } = defaultOs(machine);
      const caps = {
        browser: browserStackBrowser(machine.label),
        browser_version: version,
        os,
        os_version: osVersion,
        name: machine.sessionName,
        build: machine.buildName,
        'browserstack.username': grid.username ?? '',
        'browserstack.accessKey': grid.key ?? '',
        'client.playwrightVersion': PLAYWRIGHT_VERSION,
      };
      return { engine: machine.engine, wsEndpoint: `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}` };
    }
    case 'lambdatest': {
      const { os, osVersion } = defaultOs(machine);
      const caps = {
        browserName: lambdaTestBrowser(machine.label),
        browserVersion: version,
        'LT:Options': {
          platform: `${os === 'OS X' ? 'MacOS' : os} ${osVersion}`,
          build: machine.buildName,
          name: machine.sessionName,
          user: grid.username ?? '',
          accessKey: grid.key ?? '',
          video: true,
          console: true,
          playwrightClientVersion: PLAYWRIGHT_VERSION,
        },
      };
      return { engine: machine.engine, wsEndpoint: `wss://cdp.lambdatest.com/playwright?capabilities=${encodeURIComponent(JSON.stringify(caps))}` };
    }
    case 'playwright_server': {
      const endpoint = grid.endpoint ?? '';
      // Browserless and the like take the token in the address, where the endpoint says so;
      // anything else gets it as a bearer token.
      if (grid.key && endpoint.includes('{token}')) {
        return { engine: machine.engine, wsEndpoint: endpoint.replace('{token}', encodeURIComponent(grid.key)) };
      }
      return {
        engine: machine.engine,
        wsEndpoint: endpoint,
        ...(grid.key ? { headers: { Authorization: `Bearer ${grid.key}` } } : {}),
      };
    }
  }
}

/**
 * What of the plan's machine this grid cannot deliver, for the run's log — the same honesty the
 * runners owe (server/browsers.ts `unsupportedMachineFields`).
 */
export function gridWarnings(provider: BrowserGridProvider, machine: Pick<GridMachine, 'label' | 'os' | 'osVersion' | 'browserVersion'>): string[] {
  if (HONOURS_MACHINE[provider]) {
    // Safari on a cloud is still Playwright's WebKit: the clouds do not drive Safari itself.
    return machine.label === 'safari' ? ['Safari runs on Playwright\'s WebKit on the grid too, not on Safari itself.'] : [];
  }
  const asked = [machine.os, machine.osVersion, machine.browserVersion && machine.browserVersion !== 'latest' ? `${machine.label} ${machine.browserVersion}` : null].filter(Boolean);
  return asked.length > 0 ? [`A Playwright server runs the browsers it has: ${asked.join(', ')} not applied.`] : [];
}

/**
 * Where a plan runs, as a save of it states it: a pool of agents, a grid, or neither. Both at once
 * is refused, a grid this organization does not have is refused, and naming one clears the other
 * — so a plan moved from agents to a grid does not keep a pool that would win at run time.
 */
export async function checkRunOn(changes: { agentPool?: string | null; browserGridId?: string | null }): Promise<
  { ok: true; changes: { agentPool?: string | null; browserGridId?: string | null } } | { ok: false; error: string }
> {
  if (changes.agentPool && changes.browserGridId) {
    return { ok: false, error: 'A plan runs on a pool of local agents or on a browser grid, not both.' };
  }
  if (changes.browserGridId) {
    const [row] = await withTenantTransaction((tx) =>
      tx.select({ id: browserGrids.id }).from(browserGrids).where(eq(browserGrids.id, changes.browserGridId!)).limit(1),
    );
    if (!row) return { ok: false, error: 'That browser grid does not exist.' };
    return { ok: true, changes: { ...changes, agentPool: null } };
  }
  if (changes.agentPool) return { ok: true, changes: { ...changes, browserGridId: null } };
  return { ok: true, changes };
}

/** A grid's configuration with its key decrypted, under the caller's organization; null if none. */
export async function loadGridConfig(id: string): Promise<GridConfig | null> {
  const [row] = await withTenantTransaction((tx) => tx.select().from(browserGrids).where(eq(browserGrids.id, id)).limit(1));
  return row ? toGridConfig(row) : null;
}

export function toGridConfig(row: BrowserGrid): GridConfig {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as BrowserGridProvider,
    username: row.username,
    endpoint: row.endpoint,
    key: row.encryptedKey && row.keyIv && row.keyAuthTag ? decryptSecret(row.encryptedKey, row.keyIv, row.keyAuthTag) : null,
  };
}

/**
 * Tells the provider how the test went, so its dashboard agrees with the report. The clouds read
 * it from a script call their browsers intercept; a Playwright server has no dashboard to tell.
 */
export async function markGridSession(page: Page, provider: BrowserGridProvider, passed: boolean, reason: string | null): Promise<void> {
  const status = passed ? 'passed' : 'failed';
  const text = (reason ?? (passed ? 'Passed' : 'Failed')).slice(0, 250);
  let command: string | null = null;
  if (provider === 'browserstack') {
    command = `browserstack_executor: ${JSON.stringify({ action: 'setSessionStatus', arguments: { status, reason: text } })}`;
  } else if (provider === 'lambdatest') {
    command = `lambdatest_action: ${JSON.stringify({ action: 'setTestStatus', arguments: { status, remark: text } })}`;
  }
  if (!command || page.isClosed()) return;
  await page.evaluate(() => {}, command).catch(() => {
    // The status is the provider's dashboard's business; a run's result does not wait on it.
  });
}
