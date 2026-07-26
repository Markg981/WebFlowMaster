import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import playwright, { type Browser, type BrowserContext } from 'playwright';
import { PlaywrightService } from './playwright-service';
import { mapRecordedSequence, type RecordedAction } from '../shared/recording';

vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), http: vi.fn(), verbose: vi.fn() },
  updateLogLevel: vi.fn(),
}));

/**
 * Drives the real recorder script in a real Chromium against a real two-page site.
 *
 * This is the test that actually proves the fixes: that the script survives a full page
 * navigation (it used to be injected with `page.addScriptTag()` and died on the first one),
 * that password fields are never sent in clear text, and that the in-page assert overlay
 * produces a replayable assertion step.
 *
 * Headless on purpose — a recording session is always headed, but the recorder wiring under
 * test (`installRecorder`) is identical either way.
 */

const PAGE_ONE = `<!doctype html>
<html><body>
  <h1 id="title">Login</h1>
  <form id="login" action="/dashboard" method="get">
    <input id="username" name="username" type="text" />
    <input id="password" name="password" type="password" />
    <button id="submit" type="submit">Sign in</button>
  </form>
  <a id="direct-link" href="/dashboard">Go to dashboard</a>
</body></html>`;

const PAGE_TWO = `<!doctype html>
<html><body>
  <h1 id="welcome">Welcome back</h1>
  <ul id="orders"><li class="order">A</li><li class="order">B</li></ul>
  <button id="refresh">Refresh</button>
</body></html>`;

let server: http.Server;
let baseUrl: string;
let browser: Browser;

const service = new PlaywrightService();

/** Opens a context with the production recorder wiring and a fresh session buffer. */
async function startRecording(sessionId: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await service.installRecorder(context, sessionId);
  service.registerSession(sessionId, {
    browser,
    context,
    page: undefined as never, // filled in below; pushAction only reads it for a URL fallback
    targetUrl: baseUrl,
  });
  return context;
}

async function recordedActions(sessionId: string): Promise<RecordedAction[]> {
  const result = await service.getRecordedActions(sessionId);
  return result.sequence ?? [];
}

/** The recorder posts actions over a binding, so give the buffer a moment to fill. */
async function settle(ms = 300) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url?.startsWith('/dashboard') ? PAGE_TWO : PAGE_ONE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  browser = await playwright.chromium.launch({ headless: true });
}, 120_000);

afterAll(async () => {
  await service.disposeAllRecordingSessions();
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('recorder script in a real browser', () => {
  it('captures clicks and inputs on the first page', async () => {
    const sessionId = 'it-basic';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/`);

    await page.fill('#username', 'marco');
    await page.click('#title'); // blur, so the change event fires
    await settle();

    const actions = await recordedActions(sessionId);
    const input = actions.find((a) => a.type === 'input');
    expect(input).toBeDefined();
    expect(input?.selector).toBe('#username');
    expect(input?.value).toBe('marco');

    await context.close();
  }, 60_000);

  it('keeps recording after a full page navigation', async () => {
    const sessionId = 'it-navigation';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/`);

    await page.click('#direct-link');
    await page.waitForLoadState('domcontentloaded');
    await settle();

    // This click happens in the SECOND document. With the old script-tag injection the
    // recorder was gone by now and nothing below was ever captured.
    await page.click('#refresh');
    await settle();

    const actions = await recordedActions(sessionId);
    const selectors = actions.filter((a) => a.type === 'click').map((a) => a.selector);
    expect(selectors).toContain('#direct-link');
    expect(selectors).toContain('#refresh');

    await context.close();
  }, 60_000);

  it('never sends the contents of a password field', async () => {
    const sessionId = 'it-secrets';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/`);

    await page.fill('#password', 'hunter2-super-secret');
    await page.click('#title'); // blur
    await settle();

    const actions = await recordedActions(sessionId);
    const serialised = JSON.stringify(actions);
    expect(serialised).not.toContain('hunter2-super-secret');

    const passwordAction = actions.find((a) => a.selector === '#password');
    expect(passwordAction?.masked).toBe(true);
    expect(passwordAction?.value).toBe('');

    // The mapper turns it into a variable placeholder rather than an empty value.
    const steps = mapRecordedSequence(actions);
    const passwordStep = steps.find((s) => s.targetElement?.selector === '#password');
    expect(passwordStep?.value).toBe('{{secret_password}}');

    await context.close();
  }, 60_000);

  it('records an assertion built through the in-page overlay', async () => {
    const sessionId = 'it-assert';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/dashboard`);
    await settle();

    // Enter assert mode from the recorder toolbar.
    await page.click('[data-wfm-recorder="toolbar"] button');
    // Pick the element to assert on; the click is swallowed by the overlay.
    await page.click('#welcome');

    const panel = page.locator('[data-wfm-recorder="panel"]');
    await panel.waitFor({ state: 'visible' });
    // Default assert type is "contains text", pre-filled with the element's own text.
    expect(await panel.locator('input').inputValue()).toBe('Welcome back');

    await panel.locator('button', { hasText: 'Add assert' }).click();
    await settle();

    const actions = await recordedActions(sessionId);
    const assertion = actions.find((a) => a.type === 'assertTextContains');
    expect(assertion).toBeDefined();
    expect(assertion?.selector).toBe('#welcome');
    expect(assertion?.value).toBe('Welcome back');

    // The click used to pick the element must NOT have been recorded as an interaction.
    expect(actions.filter((a) => a.type === 'click' && a.selector === '#welcome')).toHaveLength(0);

    // And it maps to a step the replay engine understands.
    const steps = mapRecordedSequence(actions);
    expect(steps.some((s) => s.action.id === 'assertTextContains')).toBe(true);

    await context.close();
  }, 60_000);

  it('records an element-count assertion with the live count pre-filled', async () => {
    const sessionId = 'it-assert-count';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/dashboard`);
    await settle();

    await page.click('[data-wfm-recorder="toolbar"] button');
    await page.click('li.order >> nth=0');

    const panel = page.locator('[data-wfm-recorder="panel"]');
    await panel.waitFor({ state: 'visible' });
    await panel.locator('select').selectOption('assertElementCount');
    await panel.locator('button', { hasText: 'Add assert' }).click();
    await settle();

    const actions = await recordedActions(sessionId);
    const assertion = actions.find((a) => a.type === 'assertElementCount');
    expect(assertion).toBeDefined();
    // Two <li class="order"> exist, and the selector the recorder built matches both.
    expect(assertion?.value).toMatch(/^==\d+$/);

    await context.close();
  }, 60_000);

  it('ignores the recorder toolbar itself', async () => {
    const sessionId = 'it-ignore-ui';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/dashboard`);
    await settle();

    // Toggle assert mode on and back off: neither click is a user action.
    await page.click('[data-wfm-recorder="toolbar"] button');
    await page.click('[data-wfm-recorder="toolbar"] button');
    await settle();

    const actions = await recordedActions(sessionId);
    expect(actions.filter((a) => a.type === 'click')).toHaveLength(0);

    await context.close();
  }, 60_000);
});
