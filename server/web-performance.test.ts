import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Browser } from 'playwright';
import { check, describeChecks, formatMetric, parseLighthouseLimits, parsePerformanceLimits } from '@shared/web-performance';
import { executeStep } from './step-executor';

/** How fast a page is, as a test step sees it (shared/web-performance.ts, server/web-performance.ts). */

describe('limits', () => {
  it('reads times, sizes and scores, with their units', () => {
    expect(parsePerformanceLimits('LCP < 2.5s, cls <= 0.1; TTFB < 800ms, weight < 2MB, requests <= 40')).toEqual([
      { metric: 'LCP', op: '<', value: 2500, text: 'LCP < 2.5s' },
      { metric: 'CLS', op: '<=', value: 0.1, text: 'cls <= 0.1' },
      { metric: 'TTFB', op: '<', value: 800, text: 'TTFB < 800ms' },
      { metric: 'WEIGHT', op: '<', value: 2 * 1024 * 1024, text: 'weight < 2MB' },
      { metric: 'REQUESTS', op: '<=', value: 40, text: 'requests <= 40' },
    ]);
    expect(parsePerformanceLimits('LCP fast')).toEqual({ error: expect.stringContaining('not a limit') });
    expect(parsePerformanceLimits('SPEED < 3')).toEqual({ error: expect.stringContaining('Unknown metric') });
    expect(parsePerformanceLimits('LCP < 3MB')).toEqual({ error: expect.stringContaining('ms or s') });
    expect(parseLighthouseLimits('performance >= 80, desktop')).toEqual({ formFactor: 'desktop', limits: [{ metric: 'performance', op: '>=', value: 80, text: 'performance >= 80' }] });
    expect(parseLighthouseLimits('speed >= 80')).toEqual({ error: expect.stringContaining('Unknown category') });
    expect(parseLighthouseLimits('seo >= 120')).toEqual({ error: expect.stringContaining('0 to 100') });
  });

  it('does not fail a metric the browser cannot measure, and says so', () => {
    const checks = check(parsePerformanceLimits('LCP < 2500, TTFB < 100') as any, { LCP: null, TTFB: 250 });
    expect(checks.map((c) => c.ok)).toEqual([null, false]);
    expect(describeChecks(checks, formatMetric)).toBe('Over the limit: TTFB 250 ms (limit < 100 ms). Not measured in this browser or page: LCP.');
  });
});

describe('the steps, in a real browser', () => {
  let browser: Browser;
  let server: http.Server;
  let base = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/slow') {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<!doctype html><title>slow</title><h1 style="font-size:64px">Slow page</h1>');
        }, 300);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>shop</title><h1 style="font-size:64px">Products</h1><p>Some text that paints.</p>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const step = (id: string, value?: string) => ({ action: { id, name: id }, value });

  it('measures the Core Web Vitals Chromium records, and checks the default limits', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    await page.waitForTimeout(200);
    const outcome = await executeStep({ page, vars: {} }, step('measurePerformance'));
    expect(outcome.status).toBe('passed');
    const metrics = outcome.performance!.metrics;
    expect(metrics.LCP).toBeGreaterThan(0);
    expect(metrics.FCP).toBeGreaterThan(0);
    expect(metrics.CLS).toBe(0);
    expect(metrics.INP).toBeNull(); // nobody interacted
    expect(metrics.REQUESTS).toBeGreaterThanOrEqual(1);
    expect(outcome.performance!.checks.map((c) => c.metric)).toEqual(['LCP', 'CLS', 'INP']);
    expect(outcome.detail).toContain('Within the limits');
    await page.close();
  });

  it('fails when a limit is broken, naming it and the value', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/slow`);
    const outcome = await executeStep({ page, vars: { budget: '100' } }, step('measurePerformance', 'TTFB < {{budget}}ms, requests < 50'));
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/^Over the limit: TTFB \d+ ms \(limit < 100 ms\)\.$/);
    expect(outcome.performance!.metrics.TTFB).toBeGreaterThanOrEqual(250);
    const bad = await executeStep({ page, vars: {} }, step('measurePerformance', 'LCP quick'));
    expect(bad).toMatchObject({ status: 'failed', error: expect.stringContaining('not a limit') });
    await page.close();
  });

  it('checks Lighthouse scores, and fails clearly where Lighthouse cannot run', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    const audit = async () => ({ url: page.url(), formFactor: 'desktop' as const, scores: { performance: 72, accessibility: 95 }, metrics: { LCP: 900 } });
    const low = await executeStep({ page, vars: {}, runLighthouse: audit }, step('auditLighthouse', 'performance >= 80, accessibility >= 90, desktop'));
    expect(low).toMatchObject({ status: 'failed', error: 'Lighthouse (desktop) below the limit: performance 72 (limit >= 80).' });
    expect(low.lighthouse!.checks.map((c) => c.ok)).toEqual([false, true]);
    const recorded = await executeStep({ page, vars: {}, runLighthouse: audit }, step('auditLighthouse'));
    expect(recorded).toMatchObject({ status: 'passed', detail: 'Lighthouse (desktop): performance 72, accessibility 95.' });

    const missing = async () => { throw new Error('Lighthouse is not installed on this runner.'); };
    expect(await executeStep({ page, vars: {}, runLighthouse: missing }, step('auditLighthouse'))).toMatchObject({ status: 'failed', error: 'Lighthouse is not installed on this runner.' });
    await page.goto('about:blank');
    expect(await executeStep({ page, vars: {}, runLighthouse: audit }, step('auditLighthouse'))).toMatchObject({ status: 'failed', error: expect.stringContaining('navigate first') });
    await page.close();
  });
});
