import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Browser } from 'playwright';
import { summariseAxe, describeFinding } from '@shared/accessibility';
import { executeStep } from './step-executor';

/**
 * `assertAccessible`, against real pages in a real browser.
 *
 * What is worth a test: it fails on what stops someone from using a page (an image with no text
 * alternative, a button with no name) and passes a page that has none of it; the severity it
 * fails at is the author's; every violation is kept, whether it failed the step or not; and it
 * still works under a Content Security Policy that forbids every script, which is where a check
 * that quietly could not load would report a clean page.
 */

const INACCESSIBLE = `<!doctype html><html lang="en"><head><title>Checkout</title></head><body>
  <main><h1>Checkout</h1>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
    <button></button>
  </main></body></html>`;

const ACCESSIBLE = `<!doctype html><html lang="en"><head><title>Checkout</title></head><body>
  <main><h1>Checkout</h1>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Card logo">
    <button>Pay</button>
  </main></body></html>`;

let server: http.Server;
let baseUrl: string;
let browser: Browser;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const strict = req.url?.startsWith('/strict');
    res.writeHead(200, {
      'Content-Type': 'text/html',
      ...(strict ? { 'Content-Security-Policy': "default-src 'none'; img-src data:; script-src 'none'" } : {}),
    });
    res.end(req.url?.includes('accessible') ? ACCESSIBLE : INACCESSIBLE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

const step = (value?: string) => ({ action: { id: 'assertAccessible', name: 'Check accessibility' }, value });

async function check(path: string, value?: string) {
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}${path}`);
    return await executeStep({ page, vars: {} }, step(value));
  } finally {
    await page.close();
  }
}

describe('assertAccessible in a browser', () => {
  it('fails a page with an unlabelled image and a nameless button, and names both', async () => {
    const outcome = await check('/broken');

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/image-alt/);
    expect(outcome.error).toMatch(/button-name/);
    const ids = outcome.accessibility!.violations.map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(['image-alt', 'button-name']));
    expect(outcome.accessibility!.violations.find((v) => v.id === 'button-name')).toMatchObject({
      impact: 'critical',
      blocking: true,
      count: 1,
      targets: ['button'],
    });
    expect(outcome.accessibility!.url).toBe(`${baseUrl}/broken`);
  }, 60_000);

  it('passes a page that gives both a text alternative and a name', async () => {
    const outcome = await check('/accessible');

    expect(outcome.status).toBe('passed');
    expect(outcome.detail).toMatch(/^No accessibility violations serious or worse/);
    expect(outcome.accessibility!.blocking).toBe(0);
    expect(outcome.accessibility!.passes).toBeGreaterThan(0);
  }, 60_000);

  it('still runs under a policy that forbids every script', async () => {
    const outcome = await check('/strict-broken');

    expect(outcome.status).toBe('failed');
    expect(outcome.accessibility!.violations.map((v) => v.id)).toContain('button-name');
  }, 60_000);

  it('refuses a severity it does not know, by name', async () => {
    const outcome = await check('/accessible', 'severe');

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/Unknown severity "severe".*minor, moderate, serious, critical/);
  }, 60_000);
});

describe('what a step keeps of a scan', () => {
  const run = {
    url: 'https://shop.test/checkout',
    violations: [
      { id: 'color-contrast', impact: 'serious', help: 'Contrast', helpUrl: 'u1', tags: ['wcag2aa'], nodes: [{ target: ['.price'] }, { target: ['.total'] }] },
      { id: 'region', impact: 'moderate', help: 'Landmarks', helpUrl: 'u2', nodes: [{ target: ['body > div'] }] },
      { id: 'button-name', impact: 'critical', help: 'Name', helpUrl: 'u3', nodes: [{ target: [['#widget', 'button']] }] },
      { id: 'mystery', impact: null, help: 'Unrated', helpUrl: 'u4', nodes: [{ target: ['x'] }] },
    ],
    passes: [1, 2, 3],
    incomplete: [1],
  };

  it('marks what fails the step at the chosen severity, most severe first, and never an unrated one', () => {
    const finding = summariseAxe(run, 'serious');
    expect(finding.violations.map((v) => [v.id, v.blocking])).toEqual([
      ['button-name', true],
      ['color-contrast', true],
      ['region', false],
      ['mystery', false],
    ]);
    expect(finding).toMatchObject({ blocking: 2, passes: 3, incomplete: 1, url: 'https://shop.test/checkout' });
    // A target inside a shadow root or frame is a list of its own.
    expect(finding.violations[0].targets).toEqual(['#widget button']);

    expect(summariseAxe(run, 'critical').blocking).toBe(1);
    expect(summariseAxe(run, 'minor').blocking).toBe(3);
  });

  it('reaches the report with the step, as the runner stored it', async () => {
    const { stepsWithArtifactUrls } = await import('./routes/artifacts.routes');
    const finding = summariseAxe(run, 'serious');
    const [stored] = stepsWithArtifactUrls('exec-1', JSON.stringify([
      { name: 'Check accessibility', type: 'assertAccessible', status: 'failed', details: 'x', accessibility: finding },
    ]));
    expect(stored.accessibility).toEqual(finding);
  });

  it('says what failed it, or that nothing did and how much sat below the line', () => {
    expect(describeFinding(summariseAxe(run, 'serious'))).toBe(
      '2 accessibility violations serious or worse: button-name (critical, 1 element), color-contrast (serious, 2 elements).',
    );
    expect(describeFinding(summariseAxe({ violations: [run.violations[1]] }, 'serious'))).toBe(
      'No accessibility violations serious or worse (1 below the threshold).',
    );
  });
});
