import { describe, it, expect } from 'vitest';
import { browsersForRun, describeBrowser, onAgents, resolveBrowser, unsupportedMachineFields } from './browsers';

/**
 * The plan wizard and the schedule form have always collected a browser configuration that
 * the runner threw away. These are the rules by which it is now read.
 */

describe('resolveBrowser', () => {
  it('maps the branded names onto an engine and a channel', () => {
    expect(resolveBrowser('edge', true)).toEqual({ label: 'edge', engine: 'chromium', channel: 'msedge', headless: true });
    expect(resolveBrowser('chrome', true)).toEqual({ label: 'chrome', engine: 'chromium', channel: 'chrome', headless: true });
    expect(resolveBrowser('safari', true)).toEqual({ label: 'safari', engine: 'webkit', channel: undefined, headless: true });
  });

  it('is indifferent to case and stray spaces, and refuses what it does not know', () => {
    expect(resolveBrowser('  FireFox ', true)?.engine).toBe('firefox');
    expect(resolveBrowser('internet explorer', true)).toBeNull();
  });
});

describe('browsersForRun', () => {
  it("runs the schedule's browsers, in the order the schedule lists them", () => {
    const { browsers } = browsersForRun({ executionBrowsers: ['firefox', 'webkit'] });
    expect(browsers.map((b) => b.label)).toEqual(['firefox', 'webkit']);
    expect(browsers.every((b) => b.headless)).toBe(true);
  });

  it('prefers the schedule over the plan, because the schedule is the more specific statement', () => {
    const { browsers } = browsersForRun({
      executionBrowsers: ['firefox'],
      testMachines: [{ browserName: 'chrome', headless: false }],
    });
    expect(browsers.map((b) => b.label)).toEqual(['firefox']);
  });

  it("falls back to the plan's machines when no schedule asked for anything", () => {
    const { browsers } = browsersForRun({
      executionBrowsers: [],
      testMachines: [
        { browserName: 'chrome', headless: false },
        { browserName: 'webkit', headless: true },
      ],
    });
    expect(browsers.map((b) => b.label)).toEqual(['chrome', 'webkit']);
    expect(browsers[0].headless).toBe(false);
  });

  it("runs once on the user's default when nothing was configured, as every plan did before", () => {
    const { browsers } = browsersForRun({ fallback: { label: 'firefox', headless: true } });
    expect(browsers).toHaveLength(1);
    expect(browsers[0].label).toBe('firefox');
  });

  it('drops a duplicate rather than running the same browser twice', () => {
    const { browsers } = browsersForRun({ executionBrowsers: ['chromium', 'chromium'] });
    expect(browsers).toHaveLength(1);
  });

  it('skips a name it cannot launch and says so instead of failing the run', () => {
    const { browsers, warnings } = browsersForRun({ executionBrowsers: ['firefox', 'netscape'] });
    expect(browsers.map((b) => b.label)).toEqual(['firefox']);
    expect(warnings.join(' ')).toContain('netscape');
  });

  it('warns that Safari is really WebKit, so the report does not claim a run that did not happen', () => {
    const { warnings } = browsersForRun({ executionBrowsers: ['safari'] });
    expect(warnings.join(' ')).toContain('WebKit');
  });

  it('reads a jsonb column that came back as text, which is how these columns are written here', () => {
    const { browsers } = browsersForRun({ executionBrowsers: JSON.stringify(['firefox', 'webkit']) });

    expect(browsers.map((b) => b.label)).toEqual(['firefox', 'webkit']);
  });

  it('reads a machine configuration that came back as text too', () => {
    const { browsers } = browsersForRun({
      testMachines: JSON.stringify([{ browserName: 'webkit', headless: true }]),
    });

    expect(browsers.map((b) => b.label)).toEqual(['webkit']);
  });

  it('never leaves a run with nothing to launch', () => {
    const { browsers } = browsersForRun({ executionBrowsers: ['netscape'] });
    expect(browsers).toHaveLength(1);
    expect(browsers[0].engine).toBe('chromium');
  });
});

describe('unsupportedMachineFields', () => {
  it('names the OS and the browser version it could not honour', () => {
    const warnings = unsupportedMachineFields([
      { os: 'windows', osVersion: '11', browserName: 'chrome', browserVersion: '118' },
    ]);
    expect(warnings.join(' ')).toContain('windows 11');
    expect(warnings.join(' ')).toContain('chrome 118');
  });

  it('stays quiet about "latest", which is what the runner gives anyway', () => {
    const warnings = unsupportedMachineFields([{ browserName: 'chrome', browserVersion: 'latest' }]);
    expect(warnings.join(' ')).not.toContain('chrome');
  });
});

describe('describeBrowser', () => {
  it('shows the channel and the headed mode, which are what differ between two rows of the same engine', () => {
    expect(describeBrowser({ label: 'edge', engine: 'chromium', channel: 'msedge', headless: false }))
      .toBe('edge (chromium/msedge), headed');
    expect(describeBrowser({ label: 'firefox', engine: 'firefox', headless: true })).toBe('firefox');
  });
});

describe('onAgents', () => {
  it("sends every pass to the pool, and gives the runner's default pass a browser an agent can start", () => {
    const agent = { organizationId: 3, pool: 'onprem' };
    const passes = onAgents([undefined, { label: 'firefox', engine: 'firefox', headless: false }], agent);
    expect(passes).toEqual([
      { label: 'chromium', engine: 'chromium', headless: true, agent },
      { label: 'firefox', engine: 'firefox', headless: false, agent },
    ]);
    expect(passes.map(describeBrowser)).toEqual(['chromium on agent pool "onprem"', 'firefox, headed on agent pool "onprem"']);
  });
});
