import os from 'node:os';
import type { Browser, Page } from 'playwright';
import type { BrowserChoice } from './browsers';
import {
  matrixEvidence,
  type MatrixConfiguration,
  type MatrixEvidence,
} from '@shared/matrix-evidence';

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.slice(0, 120) : null;

/** Whitelist platform fields: capability payloads may contain credentials and signed URLs. */
export function appiumMatrixEvidence(
  requested: MatrixConfiguration,
  capabilities: Record<string, unknown>,
  provider: string,
  sessionId?: string,
): MatrixEvidence {
  return matrixEvidence({
    route: 'appium',
    provider,
    ...(sessionId ? { sessionId } : {}),
    requested,
    source: 'capabilities',
    effective: {
      os: text(capabilities.platformName),
      osVersion: text(capabilities['appium:platformVersion'] ?? capabilities.platformVersion),
      device: text(capabilities['appium:deviceName'] ?? capabilities.deviceName),
    },
  });
}

export async function browserMatrixEvidence(
  choice: BrowserChoice,
  browser: Browser,
  page: Page,
): Promise<MatrixEvidence> {
  const requested = {
    browser: choice.name ?? choice.grid?.browserName ?? choice.label,
    ...choice.machine,
    ...(choice.device ? { device: choice.device } : {}),
  };
  const route = choice.grid ? 'grid' : choice.agent ? 'agent' : 'local';
  const engine = browser.browserType?.().name() ?? choice.engine;
  const brand = choice.channel === 'msedge' ? 'edge' : choice.channel;
  const effective: MatrixConfiguration = {
    // A local channel launches that installed binary; a remote connection proves only its engine.
    browser: choice.grid && brand ? null : (engine === choice.engine ? brand ?? engine : engine),
    browserVersion: text(browser.version?.()),
  };
  // A remote browser's host OS cannot be inferred from the worker or its user agent.
  if (route === 'local') {
    effective.os = os.platform();
    effective.osVersion = os.release();
  }
  if (choice.device) effective.device = `${choice.device} (emulated)`;
  let source: MatrixEvidence['source'] = 'runtime';
  const provider = choice.grid?.provider;
  let sessionId: string | null = null;
  if (provider === 'browserstack' || provider === 'lambdatest') {
    try {
      const command =
        provider === 'browserstack'
          ? 'browserstack_executor: {"action":"getSessionDetails"}'
          : 'lambdatest_action: {"action":"getTestDetails"}';
      const answer: unknown = await page.evaluate(() => {}, command);
      const details = typeof answer === 'string' ? JSON.parse(answer) : answer;
      const data = details?.data ?? details;
      const reportedBrowser = text(data?.browser ?? data?.browserName);
      if (reportedBrowser && reportedBrowser.toLowerCase() !== 'safari') effective.browser = reportedBrowser;
      sessionId = text(data?.hashed_id ?? data?.test_id ?? data?.sessionId);
      effective.os = text(data?.os ?? data?.platform);
      effective.osVersion = text(data?.os_version ?? data?.osVersion);
      // LambdaTest can report a combined platform identifier (e.g. "win10").
      // Split only observed identifiers, never fill a version from the request.
      if (!effective.osVersion && typeof data?.platform === 'string') {
        const windows = /^(?:win|windows)\s*(7|8(?:\.1)?|10|11)$/i.exec(data.platform.trim());
        const mac = /^mac(?:os)?[\s_-]+(.+)$/i.exec(data.platform.trim());
        if (windows) {
          effective.os = 'Windows';
          effective.osVersion = windows[1];
        } else if (mac) {
          effective.os = 'macOS';
          effective.osVersion = text(mac[1]);
        }
      }
      // Browser.version() remains authoritative for the connected engine.
      source = effective.os ? 'provider' : 'runtime';
    } catch {
      /* Runtime browser version remains useful; absent OS stays unverified. */
    }
  }
  return matrixEvidence({
    route,
    ...(provider ? { provider } : {}),
    ...(sessionId ? { sessionId } : {}),
    requested,
    effective,
    source,
  });
}
