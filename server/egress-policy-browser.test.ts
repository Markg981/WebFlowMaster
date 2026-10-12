import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { executeStep } from './web/step-executor';
import { installMock, parseMockSpec } from './authoring/network-mocks';
import {
  EGRESS_POLICY_HEADER,
  egressPolicy,
  egressPolicyDeps,
  guardBrowserContext,
} from './egress-policy';

/**
 * The browser a test drives must not read the metadata service either: a page can fetch()
 * whatever the worker can reach. The guard answers such requests itself, and a navigation
 * step reports the policy rather than a page.
 */

let server: http.Server;
let base: string;
let port: number;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let served: string[];
const realLookupAll = egressPolicyDeps.lookupAll;

const PAGE = `<!doctype html><body><p id="out">loading</p><script>
  async function load() {
    const out = document.getElementById('out');
    const target = new URLSearchParams(location.search).get('t');
    try {
      const res = await fetch(target);
      out.textContent = res.status + ' ' + (await res.text());
    } catch (e) { out.textContent = 'network error'; }
  }
  load();
</script></body>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    served.push(`${req.headers.host} ${req.url}`);
    if (req.url?.startsWith('/api/'))
      return void res
        .writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
        .end('secret');
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ headless: true });
  // A name the browser could not resolve answers, from the server's point of view, with the
  // metadata address: what a rebinding or an attacker-controlled record would do.
  egressPolicyDeps.lookupAll = async (hostname) =>
    hostname === 'rebind.test'
      ? [{ address: '169.254.169.254', family: 4 }]
      : realLookupAll(hostname);
}, 60_000);

afterAll(async () => {
  egressPolicyDeps.lookupAll = realLookupAll;
  await browser?.close();
  server?.closeAllConnections();
  server?.close();
});

beforeEach(async () => {
  served = [];
  context = await browser.newContext();
  await guardBrowserContext(context);
  page = await context.newPage();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await context.close();
});

const navigate = (url: string) =>
  executeStep(
    { page, vars: {} },
    {
      id: 'nav',
      action: { id: 'navigate', type: 'navigate', name: 'navigate', icon: 'x', description: 'go' },
      value: url,
    },
  );

/** What the page shows once its fetch has answered. */
const shown = async () => {
  await page.waitForFunction(() => document.getElementById('out')?.textContent !== 'loading');
  return page.locator('#out').textContent();
};

describe('egress policy in the browser', () => {
  it('lets the page reach allowed targets, including private ones by default', async () => {
    const result = await navigate(`${base}/?t=${encodeURIComponent(`${base}/api/data`)}`);
    expect(result.status).toBe('passed');
    expect(await shown()).toBe('200 secret');
    expect(served).toContain(`127.0.0.1:${port} /api/data`);
  });

  it("answers the page's request to the metadata service itself, naming the policy", async () => {
    await navigate(`${base}/?t=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`);
    expect(await shown()).toMatch(/^403 Blocked by the egress policy/);
    const requested = await page.evaluate(async () => {
      const res = await fetch('http://metadata.google.internal/computeMetadata/v1/');
      return { status: res.status, rule: res.headers.get('x-wfm-egress-policy') };
    });
    expect(requested).toEqual({ status: 403, rule: 'metadata' });
    // A name that resolves to the metadata service, as seen from the server, is denied too.
    const resolved = await page.evaluate(async (target) => {
      const res = await fetch(target);
      return { status: res.status, text: await res.text() };
    }, `http://rebind.test:${port}/api/data`);
    expect(resolved.status).toBe(403);
    expect(resolved.text).toContain('rebind.test');
    expect(resolved.text).not.toContain('169.254');
    expect(served.filter((line) => line.includes('/api/'))).toEqual([]);
  });

  it('turns a navigation to a denied target into a step error that names the policy', async () => {
    const error = await navigate('http://169.254.169.254/latest/meta-data/').then(
      () => undefined,
      (e: Error) => e,
    );
    expect(error?.message).toMatch(
      /Blocked by the egress policy: 169\.254\.169\.254 is a cloud metadata endpoint/,
    );
    expect(error?.message).not.toMatch(/timeout/i);
    expect((await navigate(`${base}/`)).status).toBe('passed');
    const response = await page.goto('http://169.254.169.254/latest/');
    expect(response?.status()).toBe(403);
    expect(response?.headers()[EGRESS_POLICY_HEADER]).toBe('metadata');
  });

  it('denies private targets only under EGRESS_PRIVATE_TARGETS=deny, with the allow-list honoured', async () => {
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'deny');
    await expect(navigate(`${base}/`)).rejects.toThrow(/127\.0\.0\.1 is a private network address/);
    vi.stubEnv('EGRESS_ALLOW_HOSTS', '127.0.0.0/8');
    expect((await navigate(`${base}/`)).status).toBe('passed');
    expect(egressPolicy().allowRanges).toHaveLength(1);
  });

  it('keeps network mocks registered by the test ahead of the guard', async () => {
    await navigate(`${base}/`);
    await installMock(context, parseMockSpec('http://169.254.169.254/** | 200 | mocked'));
    const mocked = await page.evaluate(async () => {
      const res = await fetch('http://169.254.169.254/latest/');
      return `${res.status} ${await res.text()}`;
    });
    expect(mocked).toBe('200 mocked');
    expect((await navigate(`${base}/?t=${encodeURIComponent(`${base}/api/x`)}`)).status).toBe(
      'passed',
    );
  });
});
