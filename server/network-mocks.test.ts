import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import type { AdhocActionId } from '@shared/recording';
import { executeStep } from './step-executor';
import { parseMockSpec } from './network-mocks';

/**
 * Answering the page's requests in a test. The application is a small server: a page that loads
 * /api/orders and shows what came back, or the error. The browser is a real one.
 */

let server: http.Server;
let base: string;
let browser: Browser;
let page: Page;
let served: string[];

const PAGE = `<!doctype html><body><p id="out">loading</p><script>
  async function load() {
    const out = document.getElementById('out');
    try {
      const res = await fetch('/api/orders', { method: new URLSearchParams(location.search).get('m') || 'GET' });
      out.textContent = res.status + ' ' + (await res.text());
    } catch (e) { out.textContent = 'network error'; }
  }
  load();
</script></body>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    served.push(`${req.method} ${req.url}`);
    if (req.url?.startsWith('/api/orders')) return void res.writeHead(200, { 'content-type': 'application/json' }).end('["real"]');
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

beforeEach(async () => {
  served = [];
  page = await (await browser.newContext()).newPage();
});

afterEach(async () => {
  await page.context().close();
});

const step = (id: AdhocActionId, value?: string) =>
  executeStep({ page, vars: { api: `${base}/api` } }, { id: `s-${id}`, action: { id, type: id, name: id, icon: 'x', description: id }, value } as never);

const shown = async (query = '') => {
  await page.goto(`${base}/${query}`);
  await page.waitForFunction(() => document.getElementById('out')?.textContent !== 'loading');
  return page.textContent('#out');
};

describe('reading a mock', () => {
  it('takes a method, a pattern, a status with a delay, and a body that may hold |', () => {
    expect(parseMockSpec('POST **/api/orders | 201 after 2s | {"id": "a|b"}')).toEqual({
      method: 'POST', pattern: '**/api/orders', status: 201, delayMs: 2000, body: '{"id": "a|b"}', contentType: 'application/json',
    });
    expect(parseMockSpec('**/api/orders')).toMatchObject({ method: null, status: 200, body: '', delayMs: 0 });
    expect(parseMockSpec('**/x | 503 | Down for maintenance')).toMatchObject({ status: 503, contentType: 'text/plain; charset=utf-8' });
  });

  it('refuses what it cannot answer', () => {
    expect(parseMockSpec(' | 200')).toHaveProperty('error');
    expect(parseMockSpec('**/x | ok')).toHaveProperty('error');
    expect(parseMockSpec('**/x | 99')).toHaveProperty('error');
    expect(parseMockSpec('**/x | 200 after 90s')).toHaveProperty('error');
  });
});

describe('in a browser', () => {
  it('answers in place of the server, with variables, and the server never hears of it', async () => {
    const outcome = await step('mockRequest', '{{api}}/orders | 500 | {"error":"boom"}');
    expect(outcome.status).toBe('passed');
    expect(await shown()).toBe('500 {"error":"boom"}');
    expect(served).not.toContain('GET /api/orders');
  });

  it('answers one method only, and passes the others on', async () => {
    await step('mockRequest', 'POST **/api/orders | 201 | created');
    expect(await shown()).toBe('200 ["real"]');
    expect(await shown('?m=POST')).toBe('201 created');
  });

  it('lets a later mock of the same address win, and clearMocks give the real server back', async () => {
    await step('mockRequest', '**/api/orders | 200 | ["first"]');
    await step('mockRequest', '**/api/orders | 200 | []');
    expect(await shown()).toBe('200 []');
    const cleared = await step('clearMocks');
    expect(cleared.detail).toContain('2 mock');
    expect(await shown()).toBe('200 ["real"]');
  });

  it('blocks requests as if the network were down', async () => {
    expect((await step('blockRequests', '**/api/**')).status).toBe('passed');
    expect(await shown()).toBe('network error');
  });

  it('waits before answering, to show a loading state', async () => {
    await step('mockRequest', '**/api/orders | 200 after 800ms | []');
    await page.goto(`${base}/`);
    expect(await page.textContent('#out')).toBe('loading');
    await page.waitForFunction(() => document.getElementById('out')?.textContent !== 'loading');
    expect(await page.textContent('#out')).toBe('200 []');
  });

  it('fails the step, saying why, on a value it cannot read', async () => {
    const outcome = await step('mockRequest', '**/api/orders | soon');
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('not a status');
  });
});
