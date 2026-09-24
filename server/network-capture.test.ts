import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import type { AddressInfo } from 'net';
import type { Browser } from 'playwright';
import { describeNetworkFailures, REDACTED, sanitiseHar, summariseHar, type HarLike } from '@shared/network';
import { captureRunEvidence, harContextOptions } from './run-evidence';

/**
 * Network capture: a HAR of each test's requests, and what the report reads out of it.
 *
 * What is worth a test: the summary puts server errors and dead requests first and lists the
 * slowest; a kept HAR carries no credential the page sent (bearer token, cookie, API key, token
 * in the URL, form body); "on failure" drops a passing test's file but keeps its summary; and
 * all of it against a real browser, since the file is Playwright's to write.
 */

const entry = (method: string, url: string, status: number, time: number, extra: Record<string, unknown> = {}) => ({
  time,
  request: { method, url, headers: [] },
  response: { status, statusText: status === 500 ? 'Internal Server Error' : 'OK', _transferSize: 100 },
  ...extra,
});

describe('reading a HAR', () => {
  it('puts server errors and dead requests before client errors, and lists the slowest', () => {
    const har: HarLike = {
      log: {
        entries: [
          entry('GET', 'https://shop.test/favicon.ico', 404, 5),
          entry('POST', 'https://shop.test/api/orders', 500, 1200),
          entry('GET', 'https://shop.test/', 200, 300),
          { ...entry('GET', 'https://cdn.test/app.js', 0, 30000), response: { status: 0, _failureText: 'net::ERR_CONNECTION_REFUSED' } },
        ] as HarLike['log']['entries'],
      },
    };
    const summary = summariseHar(har);

    expect(summary).toMatchObject({ requests: 4, failed: 3, transferredBytes: 300 });
    expect(summary.failures.map((r) => r.status)).toEqual([500, 0, 404]);
    expect(summary.failures[1].statusText).toBe('net::ERR_CONNECTION_REFUSED');
    expect(summary.slowest.map((r) => r.url)[0]).toBe('https://cdn.test/app.js');
    expect(describeNetworkFailures(summary)).toBe(
      '2 requests failed during this test: POST shop.test/api/orders → 500; GET cdn.test/app.js → net::ERR_CONNECTION_REFUSED.',
    );
    expect(describeNetworkFailures(summariseHar({ log: { entries: [har.log.entries[0]] } }))).toBeNull();
  });

  it('keeps no credential the page sent, and no body', () => {
    const har = sanitiseHar({
      log: {
        entries: [
          {
            request: {
              method: 'POST',
              url: 'https://user:pass@shop.test/login?next=/cart&access_token=abc123',
              headers: [
                { name: 'Authorization', value: 'Bearer abc123' },
                { name: 'Cookie', value: 'sid=s3cret' },
                { name: 'X-API-Key', value: 'k-999' },
                { name: 'Accept', value: 'application/json' },
              ],
              cookies: [{ name: 'sid', value: 's3cret' }],
              queryString: [{ name: 'next', value: '/cart' }, { name: 'access_token', value: 'abc123' }],
              postData: { mimeType: 'application/x-www-form-urlencoded', text: 'user=mario&password=hunter2' },
            },
            response: {
              status: 200,
              headers: [{ name: 'Set-Cookie', value: 'sid=s3cret; HttpOnly' }],
              cookies: [{ name: 'sid', value: 's3cret' }],
              content: { size: 10, text: '{"token":"abc123"}' },
            },
          },
        ],
      },
    });

    const text = JSON.stringify(har);
    for (const secret of ['abc123', 's3cret', 'k-999', 'hunter2', 'user:pass']) expect(text).not.toContain(secret);
    expect(har.log.entries[0].request.url).toBe(`https://shop.test/login?next=%2Fcart&access_token=${encodeURIComponent(REDACTED)}`);
    expect(har.log.entries[0].request.headers).toContainEqual({ name: 'Accept', value: 'application/json' });
    expect(har.log.entries[0].request.postData).toEqual({ mimeType: 'application/x-www-form-urlencoded', text: REDACTED });
  });
});

describe('recording it in a browser', () => {
  let server: http.Server;
  let baseUrl: string;
  let browser: Browser;
  let artifactDir: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/api/boom')) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end('{"error":"database is down"}');
      }
      if (req.url?.startsWith('/api/ok')) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=server-s3cret' });
        return res.end('{"ok":true}');
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html><body><h1>Shop</h1><script>
        fetch('/api/ok?token=url-s3cret', { headers: { Authorization: 'Bearer header-s3cret' } })
          .then(() => fetch('/api/boom', { method: 'POST', body: 'password=body-s3cret' }))
          .then(() => { document.body.dataset.done = '1'; });
      </script></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfm-har-'));
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.remove(artifactDir);
  });

  async function runPage(mode: 'always' | 'on_failure', passed: boolean, label: string) {
    const options = { network: mode, artifactDir } as const;
    const har = await harContextOptions(options);
    const context = await browser.newContext({ ...har });
    const page = await context.newPage();
    await page.goto(baseUrl);
    await page.waitForSelector('body[data-done="1"]');
    return captureRunEvidence({ context, page, options, tracing: false, passed, label, harScratchPath: har.recordHar?.path });
  }

  it('keeps a HAR with the requests and none of the credentials, and summarises the failure', async () => {
    const evidence = await runPage('always', false, 'checkout');

    expect(evidence.harPath).toBe(path.join(artifactDir, 'checkout_network.har'));
    const kept = await fs.readFile(evidence.harPath!, 'utf8');
    expect(JSON.parse(kept).log.entries.length).toBeGreaterThanOrEqual(3);
    expect(kept).not.toMatch(/s3cret/);

    expect(evidence.network!.failures).toEqual([
      expect.objectContaining({ method: 'POST', url: `${baseUrl}/api/boom`, status: 500 }),
    ]);
    // Nothing of the recording is left behind but the kept file.
    expect(await fs.pathExists(path.join(artifactDir, '_har'))).toBe(false);
  }, 60_000);

  it('"on failure" drops a passing test\'s file, and still says what its page asked for', async () => {
    const evidence = await runPage('on_failure', true, 'passing');

    expect(evidence.harPath).toBeUndefined();
    expect(await fs.pathExists(path.join(artifactDir, 'passing_network.har'))).toBe(false);
    expect(evidence.network!.requests).toBeGreaterThanOrEqual(3);
    expect(evidence.network!.failed).toBe(1);
  }, 60_000);

  it('records nothing for a plan that asked for nothing', async () => {
    expect(await harContextOptions({ network: 'never', artifactDir })).toEqual({});
  });
});
