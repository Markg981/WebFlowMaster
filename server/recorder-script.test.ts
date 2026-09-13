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

/**
 * An Angular Material page in miniature, with the ids the framework actually stamps.
 *
 * Every id here is one that came back from recording a real walk through DMO: the overlay
 * counter, the generated control ids, the tab content id. A recording anchored on any of
 * them cannot be replayed, because the numbers are assigned in render order and shift on
 * the next run.
 */
const PAGE_MATERIAL = `<!doctype html>
<html><body>
  <!-- A menu, which is where cdk-overlay ids come from. -->
  <div id="cdk-overlay-0">
    <mat-nav-list>
      <a id="mat-list-item-4" class="menu-link">Plant configuration</a>
    </mat-nav-list>
  </div>

  <!-- A control that carries both a generated id and a deliberate test id. -->
  <button id="mat-mdc-button-7" data-testid="save-equipment">Save</button>

  <!-- Nothing on the button itself is usable — the class is a framework class, which the
       recorder already filters out — so it must fall back to a structural path, and the
       question is which ancestor that path is anchored to. -->
  <div id="host-container"><div><span id="mat-tab-content-4-2"><button class="mat-mdc-button-base"><svg width="8" height="8"></svg></button></span></div></div>

  <!-- An overlay: nothing above it is named, so a path would have to count from <body>. Its
       words are the only durable thing about it. -->
  <div><div><div><a class="mat-mdc-list-item">Operator Console Listing</a></div></div></div>

  <!-- The same thing as Angular Material actually builds it: the label sits in a span inside
       a span inside the anchor. By innerText all three "have" the text, so a uniqueness check
       written that way calls it ambiguous — while Playwright's :text-is() resolves it to the
       one element that owns the text. -->
  <div><div><a class="mat-mdc-list-item"><span class="mdc-list-item__content"><span class="mat-mdc-list-item-title">Current Executions</span></span></a></div></div>
</body></html>`;

/**
 * A flyout menu, the shape DMO uses for its navigation: nothing in the DOM until the pointer
 * is over the rail. Beside it a tooltip, which appears the same way and which nobody clicks —
 * the recorder has to keep the first and forget the second, or every test fills up with the
 * hovers a person makes on the way to what they meant to press.
 */
const PAGE_FLYOUT = `<!doctype html>
<html><body>
  <div id="rail">Menu</div>
  <div id="tooltip-host">Help</div>
  <div id="flyout-slot"></div>
  <div id="tip-slot"></div>
  <button id="plain">Plain</button>
  <script>
    var slot = document.getElementById('flyout-slot');
    document.getElementById('rail').addEventListener('mouseover', function () {
      if (slot.firstChild) return;
      var nav = document.createElement('nav');
      nav.id = 'flyout';
      var link = document.createElement('a');
      link.id = 'menu-item';
      link.href = '#';
      link.textContent = 'Operator Console Listing';
      nav.appendChild(link);
      slot.appendChild(nav);
    });
    var tipSlot = document.getElementById('tip-slot');
    document.getElementById('tooltip-host').addEventListener('mouseover', function () {
      if (tipSlot.firstChild) return;
      var tip = document.createElement('div');
      tip.id = 'tooltip';
      tip.textContent = 'Some hint';
      tipSlot.appendChild(tip);
    });
  </script>
</body></html>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url?.startsWith('/material')) return res.end(PAGE_MATERIAL);
    if (req.url?.startsWith('/flyout')) return res.end(PAGE_FLYOUT);
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

describe('recording an Angular Material page', () => {
  /** Clicks one selector on the Material page and returns the selector that was recorded. */
  const recordClickOn = async (sessionId: string, target: string): Promise<string | undefined> => {
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/material`);
    await page.click(target);
    await settle();
    const actions = await recordedActions(sessionId);
    await context.close();
    return actions.find((a) => a.type === 'click')?.selector;
  };

  it('does not anchor on a generated id, nor on an overlay that contains one', async () => {
    const selector = await recordClickOn('it-material-overlay', '#mat-list-item-4');

    expect(selector).toBeDefined();
    // Both halves matter. `#mat-list-item-4` as the leaf is unreplayable, and so is a path
    // that merely starts at `#cdk-overlay-0` — the overlay counter is the number of overlays
    // opened so far in that browsing session, so the same walk yields a different one.
    expect(selector).not.toContain('mat-list-item-4');
    expect(selector).not.toContain('cdk-overlay');
  }, 60_000);

  it('prefers a test id over the generated id on the same element', async () => {
    const selector = await recordClickOn('it-material-testid', '[data-testid="save-equipment"]');

    // A test id is something someone wrote down on purpose. The recorder used to read the
    // id first and never reach this.
    expect(selector).toBe('[data-testid="save-equipment"]');
  }, 60_000);

  it('identifies an overlay item by its words rather than by counting divs', async () => {
    const selector = await recordClickOn('it-material-text', 'a.mat-mdc-list-item');

    // Nothing above it is named, so the structural path would start at <body> and count the
    // overlay containers that existed at that moment — a different number on the next run.
    // This is the step that kept failing on replay against DMO.
    expect(selector).toBe('a:text-is("Operator Console Listing")');
  }, 60_000);

  it('anchors a structural path on the nearest id a developer chose', async () => {
    // An icon-only button: no text to go on, so the fallback below it is what runs.
    const selector = await recordClickOn('it-material-real-id', '#mat-tab-content-4-2 button');

    // The rule has to leave good ids alone: rejecting every id would push every path back to
    // <body>, which is the outcome it exists to avoid. So it walks past the generated
    // ancestor and stops at the named one.
    expect(selector).toContain('#host-container');
    expect(selector).not.toContain('mat-tab-content');
  }, 60_000);
});

describe('a menu that only exists while the pointer is over it', () => {
  it('records the hover that revealed the item, before the click on it', async () => {
    const sessionId = 'it-flyout';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/flyout`);

    await page.hover('#rail');
    await page.click('#menu-item');
    await settle();

    const actions = await recordedActions(sessionId);
    const shape = actions
      .filter((a) => a.type === 'hover' || a.type === 'click')
      .map((a) => `${a.type} ${a.selector}`);

    // Order matters as much as presence: replayed the other way round there is nothing to
    // click. This is the step that was missing from every recording made against DMO — the
    // menu is not in the document until the pointer is on the rail, so replay timed out on
    // the first action no matter how good its selector was.
    expect(shape).toEqual(['hover #rail', 'click #menu-item']);

    await context.close();
  }, 60_000);

  it('forgets a hover whose result nobody clicked', async () => {
    const sessionId = 'it-flyout-noise';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/flyout`);

    // A tooltip opens under the pointer on the way past, and is never used.
    await page.hover('#tooltip-host');
    await page.click('#plain');
    await settle();

    const actions = await recordedActions(sessionId);

    // Recording every mouseover would make a walk across a page into dozens of steps and
    // bury the ones that mean something.
    expect(actions.filter((a) => a.type === 'hover')).toEqual([]);
    expect(actions.filter((a) => a.type === 'click').map((a) => a.selector)).toEqual(['#plain']);

    await context.close();
  }, 60_000);

  it('does not repeat the hover for a second item from the same menu', async () => {
    const sessionId = 'it-flyout-twice';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/flyout`);

    await page.hover('#rail');
    await page.click('#menu-item');
    await page.click('#menu-item');
    await settle();

    const actions = await recordedActions(sessionId);

    expect(actions.filter((a) => a.type === 'hover')).toHaveLength(1);

    await context.close();
  }, 60_000);
});

describe('the recorder says whether it armed itself', () => {
  it('reports the hover watch as installed, on the first document', async () => {
    const sessionId = 'it-hover-watch';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/flyout`);

    // The guard this test exists to be. The observer is set up inside a try/catch — correctly,
    // since nothing the recorder does may break the page under test — and the first version
    // observed `document.documentElement`, which does not exist yet when an init script runs.
    // It threw, the catch swallowed it, and the only evidence was that recordings came back
    // with no hover steps: indistinguishable from a page where nothing opened on hover.
    const armed = await page.evaluate(() => (window as any).__wfmRecorderHoverWatch);
    expect(armed).toBe(true);

    await context.close();
  }, 60_000);

  it('is still armed after a full page navigation', async () => {
    const sessionId = 'it-hover-watch-nav';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/`);
    await page.click('#direct-link');
    await page.waitForLoadState('domcontentloaded');

    // The init script re-runs per document, so the flag has to be true in the second one too —
    // the same failure mode that once truncated every multi-page recording.
    expect(await page.evaluate(() => (window as any).__wfmRecorderHoverWatch)).toBe(true);

    await context.close();
  }, 60_000);
});

describe('a label wrapped the way Angular Material wraps it', () => {
  const recordClickOn = async (sessionId: string, target: string): Promise<string | undefined> => {
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/material`);
    await page.click(target);
    await settle();
    const actions = await recordedActions(sessionId);
    await context.close();
    return actions.find((a) => a.type === 'click')?.selector;
  };

  it('still identifies it by its words, not by counting divs', async () => {
    const selector = await recordClickOn('it-nested-text', '.mat-mdc-list-item-title');

    // Measured on the real application, where this exact shape produced
    // "body > div:nth-of-type(8) > ..." instead: the check counted with innerText, by which
    // the label, the span around it and the anchor around that all carry the same text, so
    // it declared the selector ambiguous. Playwright disagrees — :text-is() matched the span
    // and nothing else — and the engine that acts on the selector is the one that decides.
    expect(selector).toBe('span:text-is("Current Executions")');
  }, 60_000);

  it('and the selector it produces finds exactly that element', async () => {
    const context = await startRecording('it-nested-text-check');
    const page = await context.newPage();
    await page.goto(`${baseUrl}/material`);

    // The check and the engine, side by side. A selector the recorder calls unique and
    // Playwright resolves to two elements would fail replay in strict mode; one it resolves
    // to none would fail even sooner.
    expect(await page.locator('span:text-is("Current Executions")').count()).toBe(1);

    await context.close();
  }, 60_000);
});
