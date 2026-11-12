import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import type { NetworkCheckpointData, NetworkCheckpointEntry } from '@shared/comparison';
import {
  attachNetworkJournal,
  hasNetworkCheckpoint,
  networkJournalOf,
  parseNetworkCheckpointValue,
  sortEntries,
} from './network-journal';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('parseNetworkCheckpointValue', () => {
  it('reads the name and the comma-separated patterns', () => {
    expect(parseNetworkCheckpointValue(' orders ')).toEqual({ name: 'orders', patterns: [] });
    expect(parseNetworkCheckpointValue('orders | **/api/orders**, , /api/lines')).toEqual({
      name: 'orders',
      patterns: ['**/api/orders**', '/api/lines'],
    });
  });

  it('wants a name first', () => {
    expect(parseNetworkCheckpointValue(' | **/api/**')).toHaveProperty('error');
    expect(parseNetworkCheckpointValue('')).toHaveProperty('error');
  });
});

describe('sortEntries and hasNetworkCheckpoint', () => {
  it('orders the entries by their content, whatever order the network gave', () => {
    const e = (path: string, method = 'GET'): NetworkCheckpointEntry => ({
      method,
      path,
      query: [],
      requestBodyHash: null,
      status: 200,
    });
    const sorted = sortEntries([e('/b'), e('/a', 'POST'), e('/a')]);
    expect(sorted.map((x) => `${x.method} ${x.path}`)).toEqual(['GET /a', 'GET /b', 'POST /a']);
  });

  it('finds a checkpointNetwork step', () => {
    expect(hasNetworkCheckpoint([{ action: { id: 'click' } }, { action: null }])).toBe(false);
    expect(hasNetworkCheckpoint([{ action: { id: 'checkpointNetwork' } }])).toBe(true);
  });
});

describe('the journal on a browser context', () => {
  let browser: Browser;
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body><img src="/logo.png"></body></html>');
        return;
      }
      if (req.url?.startsWith('/missing')) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(`{"url":"${req.url}"}`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('keeps fetch calls by default, with sorted query, hashes and status, then starts over', async () => {
    const context = await browser.newContext();
    try {
      const journal = attachNetworkJournal(context);
      expect(attachNetworkJournal(context)).toBe(journal);
      expect(networkJournalOf(context)).toBe(journal);
      const page = await context.newPage();
      await page.goto(base);
      await page.evaluate(async () => {
        await (await fetch('/api/orders?z=2&a=1')).text();
        await (await fetch('/api/orders', { method: 'POST', body: '{"n":1}' })).text();
        await fetch('/missing');
      });

      const first = await journal.take([]);
      expect(first.dropped).toBe(0);
      // The document and the image are not fetch calls.
      expect(first.entries.map((e) => `${e.method} ${e.path} ${e.status}`)).toEqual([
        'GET /api/orders 200',
        'GET /missing 404',
        'POST /api/orders 200',
      ]);
      const get = first.entries[0];
      expect(get.query).toEqual(['a=1', 'z=2']);
      expect(get.requestBodyHash).toBeNull();
      expect(get.responseBodyHash).toBe(sha256('{"url":"/api/orders?z=2&a=1"}'));
      expect(first.entries[2].requestBodyHash).toBe(sha256('{"n":1}'));

      expect((await journal.take([])).entries).toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);

  it('keeps any request matching a pattern, documents and images too', async () => {
    const context = await browser.newContext();
    try {
      const journal = attachNetworkJournal(context);
      const page = await context.newPage();
      await page.goto(base);
      await page.evaluate(() => fetch('/api/lines'));
      const { entries } = await journal.take(['**/logo.png', '/api/lines']);
      expect(entries.map((e) => e.path)).toEqual(['/api/lines', '/logo.png']);
      // An image is not a fetch call: its body is not hashed.
      expect(entries[1].responseBodyHash).toBeUndefined();
    } finally {
      await context.close();
    }
  }, 60_000);

  it('runs as a step: the first one starts the journal, the next one reports', async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const { executeStep } = await import('../step-executor');
      const run = (value: string) =>
        executeStep(
          { page } as never,
          {
            id: 'step-net',
            action: {
              id: 'checkpointNetwork',
              type: 'checkpointNetwork',
              name: 'n',
              icon: 'x',
              description: 'n',
            },
            value,
          } as never,
        );

      const preview = await run('orders');
      expect(preview.status).toBe('passed');
      expect(preview.detail).toMatch(/journal started at this step/);
      expect((preview.checkpoint?.data as NetworkCheckpointData).entries).toEqual([]);

      await page.goto(base);
      await page.evaluate(() => fetch('/api/orders'));
      const result = await run('orders | **/api/**');
      expect(result.status).toBe('passed');
      expect(result.checkpoint?.kind).toBe('network');
      expect((result.checkpoint?.data as NetworkCheckpointData).entries.map((e) => e.path)).toEqual(
        ['/api/orders'],
      );

      expect((await run(' | x')).status).toBe('failed');
    } finally {
      await context.close();
    }
  }, 60_000);
});
