import { describe, it, expect } from 'vitest';
import { matrixEvidence, readMatrixEvidence } from '@shared/matrix-evidence';
import { appiumMatrixEvidence, browserMatrixEvidence } from './matrix-evidence';

describe('requested versus observed matrix', () => {
  it('does not certify a remote browser brand from the requested channel', async () => {
    const choice = { label: 'chrome', engine: 'chromium' as const, channel: 'chrome', headless: true,
      grid: { id: 'g', provider: 'browserstack' as const, name: 'Grid', browserName: 'chrome' } };
    const browser = { version: () => '140.0', browserType: () => ({ name: () => 'chromium' }) } as any;
    const substituted = await browserMatrixEvidence(choice, browser, { evaluate: async () => ({ browser: 'playwright-chromium' }) } as any);
    expect(substituted.verdict).toBe('mismatch');
    const missing = await browserMatrixEvidence(choice, browser, { evaluate: async () => ({}) } as any);
    expect(missing.verdict).toBe('unverified'); expect(missing.effective.browser).toBeNull();
    const actual = await browserMatrixEvidence(choice, browser, { evaluate: async () => ({ browser: 'chrome' }) } as any);
    expect(actual.verdict).toBe('matched');
  });
  it('never certifies a copied request or a missing session', () => {
    const e = matrixEvidence({
      route: 'grid',
      requested: { os: 'Windows', browser: 'firefox' },
      effective: { browser: 'firefox' },
      source: 'runtime',
    });
    expect(e.verdict).toBe('unverified');
    expect(e.effective.os).toBeUndefined();
    expect(
      matrixEvidence({ route: 'local', requested: {}, effective: {}, source: 'unavailable' })
        .verdict,
    ).toBe('unverified');
  });
  it('accepts major versions and aliases but rejects another version and Safari substitution', () => {
    const base = {
      route: 'grid' as const,
      source: 'provider' as const,
      requested: { os: 'macOS', browser: 'firefox', browserVersion: '140' },
    };
    expect(
      matrixEvidence({
        ...base,
        effective: { os: 'OS X', browser: 'playwright-firefox', browserVersion: '140.0.1' },
      }).verdict,
    ).toBe('matched');
    expect(
      matrixEvidence({
        ...base,
        effective: { os: 'OS X', browser: 'firefox', browserVersion: '141.0' },
      }).verdict,
    ).toBe('mismatch');
    expect(
      matrixEvidence({
        route: 'local',
        source: 'runtime',
        requested: { browser: 'safari' },
        effective: { browser: 'webkit' },
      }).verdict,
    ).toBe('mismatch');
  });
  it('reads each dataset row and leaves legacy or malformed logs uncertified', () => {
    const e = matrixEvidence({
      route: 'local',
      source: 'runtime',
      requested: { browser: 'firefox' },
      effective: { browser: 'firefox' },
    });
    expect(
      readMatrixEvidence(JSON.stringify([{ matrixEvidence: e }, {}, { matrixEvidence: e }])),
    ).toHaveLength(2);
    expect(
      readMatrixEvidence(JSON.stringify({ mobile: true, matrixEvidence: e, steps: [] })),
    ).toEqual([e]);
    expect(readMatrixEvidence('[]')).toEqual([]);
    expect(readMatrixEvidence('{')).toEqual([]);
  });
  it('whitelists Appium capabilities and reports a substituted device', () => {
    const e = appiumMatrixEvidence(
      { os: 'Android', osVersion: '14', device: 'Pixel 8' },
      {
        platformName: 'Android',
        'appium:platformVersion': '15',
        'appium:deviceName': 'Pixel 9',
        accessKey: 'secret',
        'bstack:options': { accessKey: 'secret' },
        app: 'signed-url',
      },
      'browserstack',
    );
    expect(e.verdict).toBe('mismatch');
    expect(e.effective).toEqual({ os: 'Android', osVersion: '15', device: 'Pixel 9' });
    expect(JSON.stringify(e)).not.toContain('secret');
    expect(appiumMatrixEvidence({ os: 'Android' }, {}, 'local_appium').verdict).toBe('unverified');
  });
  it('uses remote provider metadata without persisting credentials or assigning the worker OS', async () => {
    const browser = { version: () => '140.0' } as any;
    const page = {
      evaluate: async () =>
        JSON.stringify({
          os: 'Windows',
          os_version: '11',
          hashed_id: 'session-123',
          accessKey: 'secret',
        }),
    } as any;
    const e = await browserMatrixEvidence(
      {
        label: 'firefox · Windows 11',
        engine: 'firefox',
        headless: true,
        machine: { os: 'Windows', osVersion: '11' },
        grid: { id: 'g', provider: 'browserstack', name: 'Grid', browserName: 'firefox' },
      },
      browser,
      page,
    );
    expect(e.verdict).toBe('matched');
    expect(e.requested.browser).toBe('firefox');
    expect(e.effective.os).toBe('Windows');
    expect(e.sessionId).toBe('session-123');
    expect(JSON.stringify(e)).not.toContain('secret');
    const remote = await browserMatrixEvidence(
      {
        label: 'webkit',
        engine: 'webkit',
        headless: true,
        machine: { os: 'macOS' },
        grid: { id: 'g', provider: 'playwright_server', name: 'Grid', browserName: 'webkit' },
      },
      browser,
      page,
    );
    expect(remote.verdict).toBe('unverified');
    expect(remote.effective.os).toBeUndefined();
  });
  it('reads LambdaTest combined platform identifiers without borrowing requested values', async () => {
    const e = await browserMatrixEvidence(
      {
        label: 'firefox',
        engine: 'firefox',
        headless: true,
        machine: { os: 'Windows', osVersion: '10' },
        grid: { id: 'g', provider: 'lambdatest', name: 'Grid', browserName: 'firefox' },
      },
      { version: () => '140.0' } as any,
      {
        evaluate: async () =>
          JSON.stringify({ data: { platform: 'win10', test_id: 'lt-session' } }),
      } as any,
    );
    expect(e.verdict).toBe('matched');
    expect(e.sessionId).toBe('lt-session');
    expect(e.effective).toMatchObject({ os: 'Windows', osVersion: '10' });
  });
});
