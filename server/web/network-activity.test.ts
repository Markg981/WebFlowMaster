import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import type { NetworkCheckpointData } from '@shared/comparison';
import { waitForQuietNetwork, type NetworkActivity } from './network-activity';

describe('waitForQuietNetwork', () => {
  it('waits for the calls to end and then for a quiet period', async () => {
    let clock = 0;
    let open = 1;
    let last = 0;
    const activity: NetworkActivity = { pending: () => open, lastActivityAt: () => last };
    const done = waitForQuietNetwork(activity, 10_000, 500, () => clock);
    clock = 300;
    open = 0;
    last = 300;
    await new Promise((resolve) => setTimeout(resolve, 120));
    clock = 700;
    let settled = false;
    void done.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(settled).toBe(false);
    clock = 800;
    expect(await done).toBe(true);
  });

  it('gives up at the deadline while a call is open', async () => {
    const activity: NetworkActivity = { pending: () => 1, lastActivityAt: () => 0 };
    expect(await waitForQuietNetwork(activity, 0, 500, () => 10)).toBe(false);
  });
});

describe('waitForNetworkIdle after a click', () => {
  let browser: Browser;
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        // A slow report query, then a follow-up call started a moment after it answers.
        res.end(`<html><body><button id="go">go</button><script>
          document.getElementById('go').onclick = function () {
            fetch('/api/report').then(function () {
              setTimeout(function () { fetch('/api/totals'); }, 200);
            });
          };
        </script></body></html>`);
        return;
      }
      const delay = req.url === '/api/report' ? 2_500 : 0;
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      }, delay);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('holds the next network checkpoint until the calls the click started have answered', async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const { executeStep } = await import('./step-executor');
      const run = (id: string, value?: string) =>
        executeStep(
          { page } as never,
          { id, action: { id, type: id, name: id, icon: 'x', description: id }, value } as never,
        );

      await run('checkpointNetwork', 'start');
      await page.goto(base);
      // The page has reached networkidle before the click, as a loaded page in a real test has.
      await page.waitForLoadState('networkidle');
      await page.click('#go');
      expect((await run('waitForNetworkIdle')).status).toBe('passed');
      const result = await run('checkpointNetwork', 'report | **/api/**');
      const paths = (result.checkpoint?.data as NetworkCheckpointData).entries.map((e) => e.path);
      expect(paths).toEqual(['/api/report', '/api/totals']);
    } finally {
      await context.close();
    }
  }, 60_000);
});
