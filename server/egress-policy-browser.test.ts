import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { executeStep } from './web/step-executor';
import { installMock, parseMockSpec } from './authoring/network-mocks';
import { guardedBrowserLaunchOptions } from './platform/egress-guard-proxy';
import {
  EGRESS_POLICY_HEADER,
  egressPolicy,
  egressPolicyDeps,
  gotoWithinPolicy,
  guardBrowserContext,
} from './platform/egress-policy';

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
  // Launched as the runner launches its own browsers: behind the guard proxy.
  browser = await chromium.launch({ ...(await guardedBrowserLaunchOptions()), headless: true });
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

/**
 * The channels a page has besides a plain request: a WebSocket, a file:// page, a service
 * worker, a popup, a frame, a worker. The page is served from `localhost`, which the operator
 * allow-lists; the forbidden target is the same server reached as 127.0.0.1, a private address
 * under EGRESS_PRIVATE_TARGETS=deny. Each test asserts on what the server saw, not on what the
 * page reports, so a channel the guard misses shows up as a hit.
 */
describe('egress policy on every browser channel', () => {
  let channelServer: http.Server;
  let wss: WebSocketServer;
  let cport: number;
  let hits: string[];
  let markerDir: string;
  let markerFile: string;

  const allowed = () => `http://localhost:${cport}`;
  const denied = () => `http://127.0.0.1:${cport}`;
  const deniedHits = () => hits.filter((line) => line.startsWith(`127.0.0.1:${cport} `));

  const CHANNEL_PAGE = `<!doctype html><body><p id="out">idle</p></body>`;
  const SW = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => {
  fetch(e.data).then((r) => r.text()).then(
    (t) => e.source.postMessage('fetched ' + t),
    () => e.source.postMessage('network error'),
  );
});`;

  beforeAll(async () => {
    channelServer = http.createServer((req, res) => {
      hits.push(`${req.headers.host} ${req.url}`);
      if (req.url === '/sw.js')
        return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(SW);
      if (req.url?.startsWith('/api/'))
        return void res
          .writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
          .end('secret');
      res.writeHead(200, { 'content-type': 'text/html' }).end(CHANNEL_PAGE);
    });
    wss = new WebSocketServer({ server: channelServer });
    wss.on('connection', (socket, req) => {
      hits.push(`${req.headers.host} WS ${req.url}`);
      socket.send('hello');
    });
    // Chromium reaches `localhost` on 127.0.0.1 when nothing answers on ::1.
    await new Promise<void>((resolve) => channelServer.listen(0, '127.0.0.1', resolve));
    cport = (channelServer.address() as AddressInfo).port;
    markerDir = mkdtempSync(path.join(os.tmpdir(), 'wfm-egress-'));
    markerFile = path.join(markerDir, 'marker.html');
    writeFileSync(markerFile, '<p id="marker">FILE-MARKER-7f3a</p>');
  });

  afterAll(async () => {
    wss?.close();
    channelServer?.closeAllConnections();
    channelServer?.close();
    rmSync(markerDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    hits = [];
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'deny');
    vi.stubEnv('EGRESS_ALLOW_HOSTS', 'localhost');
  });

  /** Opens a WebSocket from the page and reports how it ended. */
  const openSocket = (target: string, where: Page = page) =>
    where.evaluate(
      (url) =>
        new Promise<string>((resolve) => {
          const socket = new WebSocket(url);
          socket.onmessage = (e) => resolve(`message ${e.data}`);
          socket.onerror = () => resolve('error');
          socket.onclose = (e) => resolve(`closed ${e.code}`);
          setTimeout(() => resolve('timeout'), 5000);
        }),
      target,
    );

  it('refuses a WebSocket to a denied address and lets an allowed one through', async () => {
    await page.goto(`${allowed()}/`);
    expect(await openSocket(`ws://localhost:${cport}/ok`)).toBe('message hello');
    expect(await openSocket(`ws://127.0.0.1:${cport}/forbidden`)).not.toBe('message hello');
    expect(hits).toContain(`localhost:${cport} WS /ok`);
    expect(deniedHits()).toEqual([]);
  });

  it('refuses a WebSocket to the metadata service even when private targets are allowed', async () => {
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'allow');
    await page.goto(`${allowed()}/`);
    const outcome = await openSocket('ws://169.254.169.254/');
    expect(outcome).not.toBe('message hello');
    expect(await openSocket(`ws://127.0.0.1:${cport}/private-ok`)).toBe('message hello');
  });

  it('turns a navigation to a file:// page into a step error, and never shows the file', async () => {
    const url = pathToFileURL(markerFile).href;
    const error = await navigate(url).then(
      () => undefined,
      (e: Error) => e,
    );
    expect(error?.message).toMatch(/Blocked by the egress policy: file:\/\/ pages/);
    expect(await page.content()).not.toContain('FILE-MARKER-7f3a');
    // Also under the permissive profile: the server's own disk is never a test target, nor is
    // it by another name.
    vi.stubEnv('EGRESS_PRIVATE_TARGETS', 'allow');
    await expect(navigate(url)).rejects.toThrow(/file:\/\/ pages/);
    await expect(navigate(`view-source:${url}`)).rejects.toThrow(/view-source:\/\/ pages/);
    expect(await page.content()).not.toContain('FILE-MARKER-7f3a');
    // The start URL takes the same road (test runner, preview, recorder, detection).
    await expect(gotoWithinPolicy(page, url)).rejects.toThrow(/Blocked by the egress policy/);
    expect((await navigate(`${allowed()}/`)).status).toBe('passed');
  });

  it('keeps a popup from reaching a denied address', async () => {
    await page.goto(`${allowed()}/`);
    const popup = context.waitForEvent('page');
    await page.evaluate((target) => void window.open(target), `${denied()}/api/popup`);
    const opened = await popup;
    await opened.waitForLoadState('domcontentloaded').catch(() => undefined);
    expect(await opened.content()).not.toContain('secret');
    expect(deniedHits()).toEqual([]);
    // A WebSocket from the popup is the context's too.
    const allowedPopup = context.waitForEvent('page');
    await page.evaluate((target) => void window.open(target), `${allowed()}/`);
    const second = await allowedPopup;
    await second.waitForLoadState('domcontentloaded');
    expect(await openSocket(`ws://127.0.0.1:${cport}/popup-ws`, second)).not.toBe('message hello');
    expect(deniedHits()).toEqual([]);
  });

  it('keeps a frame and a worker from reaching a denied address', async () => {
    await page.goto(`${allowed()}/`);
    await page.evaluate((target) => {
      const frame = document.createElement('iframe');
      frame.src = target;
      document.body.appendChild(frame);
      return new Promise((resolve) => (frame.onload = resolve));
    }, `${denied()}/api/frame`);
    const fromWorker = await page.evaluate(
      ({ http, ws }) =>
        new Promise<string>((resolve) => {
          const code = `
            fetch(${JSON.stringify(http)}).then(r => r.text()).catch(() => 'network error')
              .then((t) => {
                const s = new WebSocket(${JSON.stringify(ws)});
                s.onmessage = () => postMessage(t + ' / ws open');
                s.onerror = () => postMessage(t + ' / ws refused');
                s.onclose = () => postMessage(t + ' / ws refused');
              });`;
          const worker = new Worker(URL.createObjectURL(new Blob([code])));
          worker.onmessage = (e) => resolve(e.data);
          setTimeout(() => resolve('timeout'), 5000);
        }),
      { http: `${denied()}/api/worker`, ws: `ws://127.0.0.1:${cport}/worker-ws` },
    );
    expect(fromWorker).not.toContain('secret');
    expect(fromWorker).not.toContain('ws open');
    expect(deniedHits()).toEqual([]);
  });

  it('keeps a service worker from reaching a denied address', async () => {
    await page.goto(`${allowed()}/`);
    const askWorker = (target: string) =>
      page.evaluate(async (url) => {
        if (!('serviceWorker' in navigator)) return 'no service workers';
        await navigator.serviceWorker.register('/sw.js');
        const ready = await navigator.serviceWorker.ready;
        return new Promise<string>((resolve) => {
          navigator.serviceWorker.onmessage = (e) => resolve(e.data);
          ready.active!.postMessage(url);
          setTimeout(() => resolve('timeout'), 5000);
        });
      }, target);
    // The worker is real and can fetch: an allowed address answers through it.
    expect(await askWorker(`${allowed()}/api/sw-ok`)).toBe('fetched secret');
    expect(await askWorker(`${denied()}/api/sw`)).not.toContain('secret');
    expect(deniedHits()).toEqual([]);
  });

  it('leaves a link to a file:// page to the browser, which refuses it from a web page', async () => {
    const url = pathToFileURL(markerFile).href;
    await page.goto(`${allowed()}/`);
    await page.setContent(`<a id="go" href="${url}">file</a>`);
    await page.click('#go').catch(() => undefined);
    await page.waitForTimeout(300);
    expect(page.url()).not.toMatch(/^file:/);
    expect(await page.content()).not.toContain('FILE-MARKER-7f3a');
  });
});
