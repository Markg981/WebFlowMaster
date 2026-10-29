import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import playwright, { type Browser, type BrowserContext, type Page } from 'playwright';
import { PlaywrightService } from '../web/playwright-service';
import { scopeFor } from '../web/playwright/run-helpers';
import {
  mapRecordedSequence,
  unsupportedActions,
  type RecordedAction,
} from '../../shared/recording';
import { RECORDER_SCRIPT } from './recorder-script';
import { startShadowFixture, type ShadowFixtureServer } from '../../e2e/recorder-shadow-fixture';

vi.mock('../platform/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    http: vi.fn(),
    verbose: vi.fn(),
  },
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
  <div id="screen"><button id="stay">Stay</button></div>
  <script>
    // Clicking the menu entry swaps the screen and pushes a route, the way a single-page
    // application does — which replaces most of the document while the pointer is still
    // sitting on the entry that has just been removed.
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest || !ev.target.closest('#menu-item-nav')) return;
      var screen = document.getElementById('screen');
      var next = document.createElement('button');
      next.id = 'on-new-screen';
      next.textContent = 'On the new screen';
      screen.innerHTML = '';
      screen.appendChild(next);
      document.getElementById('flyout-slot').innerHTML = '';
      history.pushState({}, '', '/flyout?page=2');
    });
    var slot = document.getElementById('flyout-slot');
    document.getElementById('rail').addEventListener('mouseover', function () {
      if (slot.firstChild) return;
      var nav = document.createElement('nav');
      nav.id = 'flyout';
      // Three entries: two inert, so a test can pick twice from one menu, and one that
      // changes the screen the way a route does.
      [
        ['menu-item', 'Operator Console Listing'],
        ['menu-item-2', 'Current Executions'],
        ['menu-item-nav', 'Go to the next screen'],
      ].forEach(function (pair) {
        var link = document.createElement('a');
        link.id = pair[0];
        link.href = '#';
        link.textContent = pair[1];
        nav.appendChild(link);
      });
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
    await page.click('#menu-item-2');
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

describe('after the screen changes', () => {
  it('does not credit the entry that was just clicked with revealing the next screen', async () => {
    const sessionId = 'it-after-nav';
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/flyout`);

    await page.hover('#rail');
    await page.click('#menu-item-nav'); // swaps the screen and pushes a route
    await settle();
    await page.click('#on-new-screen');
    await settle();

    const actions = await recordedActions(sessionId);
    const hovers = actions.filter((a) => a.type === 'hover').map((a) => a.selector);

    // One hover, for the rail that opened the menu. The menu entry is gone by the time the
    // new screen renders, and a step cannot hover something that has left the document —
    // which is exactly what the replay of the DMO recording tripped over: a second hover
    // aimed at a menu item that no longer existed, timing out after thirty seconds.
    expect(hovers).toEqual(['#rail']);

    await context.close();
  }, 60_000);
});

/**
 * Web components (P12, C11): the recorder and the engine have to agree on the shadow DOM.
 *
 * The engine resolves selectors with Playwright's CSS engine, which pierces open shadow roots.
 * The recorder used to see them through event.target — retargeted to the outermost host by
 * the time a document listener hears it — and to count with document.querySelectorAll, which
 * does not pierce. So a field inside a component was recorded as a click on the component,
 * its value not at all (change is not composed), and a light-DOM selector it called unique
 * could match a second element inside a root. The fixture is shared with
 * e2e/recorder-shadow.spec.ts, which runs the same path on Firefox and WebKit.
 */
describe('shadow DOM', () => {
  let fixture: ShadowFixtureServer;

  beforeAll(async () => {
    fixture = await startShadowFixture();
  });

  afterAll(async () => {
    await fixture?.close();
  });

  const USER = 'x-login input[name="q"]';

  /** Records `steps` on a fixture page and returns the buffer plus the page's own #echo. */
  async function record(
    sessionId: string,
    path: string,
    steps: (page: Page) => Promise<void>,
    echoFrame?: string,
  ): Promise<{ actions: RecordedAction[]; echo: string }> {
    const context = await startRecording(sessionId);
    const page = await context.newPage();
    await page.goto(`${fixture.baseUrl}${path}`);
    await steps(page);
    await settle();
    const scope = echoFrame ? page.frameLocator(echoFrame) : page;
    const echo = (await scope.locator('#echo').textContent()) ?? '';
    const actions = await recordedActions(sessionId);
    await context.close();
    return { actions, echo };
  }

  /** What the engine resolves a recorded selector to, as the data-key/name of the element. */
  async function resolve(path: string, selector: string, frameSelector?: string | null) {
    const page = await browser.newPage();
    await page.goto(`${fixture.baseUrl}${path}`);
    const scope = scopeFor(page, frameSelector);
    const target = scope.locator(selector);
    const count = await target.count();
    const key =
      count === 1
        ? await target.evaluate(
            (el: Element) => el.getAttribute('data-key') || el.getAttribute('name'),
          )
        : null;
    await page.close();
    return { count, key };
  }

  it('records a field inside an open root once, on the field and not on its host', async () => {
    const { actions } = await record('shadow-open', '/', async (page) => {
      await page.fill(USER, 'marco');
      await page.press(USER, 'Tab');
    });

    const inputs = actions.filter((a) => a.type === 'input');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].value).toBe('marco');
    expect(inputs[0].selector).toContain('x-login');
    // A shadow path is one CSS selector. ' >> ' is how a FRAME path is separated, and the
    // engine splits frameSelector on it; it must never appear inside a selector.
    expect(inputs[0].selector).not.toContain('>>');
    expect(inputs[0].frameSelector).toBeUndefined();
    expect(await resolve('/', inputs[0].selector!)).toEqual({ count: 1, key: 'user' });
  }, 60_000);

  it('gives the light-DOM control a selector the engine does not share with the component', async () => {
    const { actions } = await record('shadow-control', '/', async (page) => {
      await page.fill('input[data-key="plain"]', 'light');
      await page.press('input[data-key="plain"]', 'Tab');
    });

    const input = actions.find((a) => a.type === 'input');
    expect(input?.value).toBe('light');
    // input[name="q"] is unique to document.querySelectorAll and matches two elements in the
    // engine, which acts on the first: the old check would have written a step that types
    // into whichever of the two the engine reached first.
    expect(input?.selector).not.toBe('input[name="q"]');
    expect(await resolve('/', input!.selector!)).toEqual({ count: 1, key: 'plain' });
  }, 60_000);

  it('masks a password inside a root and keeps Enter behind the value it submits', async () => {
    const { actions } = await record('shadow-secret', '/', async (page) => {
      await page.fill('x-login input[name="pass"]', 'hunter22');
      await page.press('x-login input[name="pass"]', 'Tab');
      await page.fill('x-login input[name="search"]', 'orders');
      await page.press('x-login input[name="search"]', 'Enter');
      await page.press('x-login input[name="search"]', 'Tab');
    });

    const secret = actions.find((a) => a.type === 'input' && a.masked);
    expect(secret?.value).toBe('');
    expect(JSON.stringify(actions)).not.toContain('hunter22');

    const steps = mapRecordedSequence(actions);
    const search = steps.findIndex(
      (s) => s.action.id === 'input' && !!s.targetElement?.selector.includes('search'),
    );
    expect(search).toBeGreaterThanOrEqual(0);
    expect(steps[search].value).toBe('orders');
    expect(steps[search + 1].action.id).toBe('pressKey');
  }, 60_000);

  it('reaches through two nested roots: select, checkbox and a button known by its text', async () => {
    const { actions } = await record('shadow-nested', '/', async (page) => {
      await page.selectOption('x-inner select[name="color"]', 'green');
      await page.check('x-inner input[name="agree"]');
      await page.click('x-inner button:text-is("Save")');
    });

    const select = actions.filter((a) => a.type === 'select');
    expect(select).toHaveLength(1);
    expect(select[0].value).toBe('green');
    expect(await resolve('/', select[0].selector!)).toEqual({ count: 1, key: 'color' });

    const save = actions.filter((a) => a.type === 'click' && a.targetText === 'Save');
    expect(save).toHaveLength(1);
    expect(await resolve('/', save[0].selector!)).toMatchObject({ count: 1 });

    // A ticked box is a state to reach, not text to type: fill() refuses checkboxes.
    const agree = mapRecordedSequence(actions).find(
      (s) => !!s.targetElement?.selector.includes('agree') && s.action.id !== 'click',
    );
    expect(agree?.action.id).toBe('ensureState');
    expect(agree?.value).toBe('checked');
  }, 60_000);

  it('hears a root created after load, and only once after it is removed and put back', async () => {
    const { actions } = await record('shadow-dynamic', '/', async (page) => {
      await page.click('#add-late');
      await page.fill('x-late input[name="late"]', 'first');
      await page.press('x-late input[name="late"]', 'Tab');
      await page.click('#cycle-late');
      await page.fill('x-late input[name="late"]', 'second');
      await page.press('x-late input[name="late"]', 'Tab');
    });

    const late = actions.filter((a) => a.type === 'input' && !!a.selector?.includes('x-late'));
    expect(late.map((a) => a.value)).toEqual(['first', 'second']);
  }, 60_000);

  it('hears a declarative shadow root, which no attachShadow call announced', async () => {
    const { actions } = await record('shadow-declarative', '/', async (page) => {
      await page.fill('x-decl input[name="decl"]', 'parsed');
      await page.press('x-decl input[name="decl"]', 'Tab');
    });

    const decl = actions.filter((a) => a.type === 'input');
    expect(decl.map((a) => a.value)).toEqual(['parsed']);
    expect(await resolve('/', decl[0].selector!)).toEqual({ count: 1, key: 'decl' });
  }, 60_000);

  it('reports what happens inside a closed root as unsupported instead of guessing', async () => {
    const { actions } = await record('shadow-closed', '/', async (page) => {
      const box = (await page.locator('x-closed').boundingBox())!;
      await page.mouse.click(box.x + 5, box.y + box.height / 2); // into the first field
      await page.keyboard.type('nope');
      await page.keyboard.press('Tab');
    });

    const closed = unsupportedActions(actions);
    expect(closed.length).toBeGreaterThanOrEqual(2); // the click and the value
    expect(closed.every((a) => a.unsupported === 'closed-shadow-root')).toBe(true);
    // Never the value: a closed field may be a secret, and it is not replayable anyway.
    expect(JSON.stringify(actions)).not.toContain('nope');
    // Shown, and not turned into steps that would fail far from where they were recorded.
    expect(mapRecordedSequence(actions)).toEqual(
      mapRecordedSequence(actions.filter((a) => !a.unsupported)),
    );
  }, 60_000);

  it('keeps the frame path and the shadow path apart for a component inside an iframe', async () => {
    const { actions } = await record(
      'shadow-frame',
      '/frames',
      async (page) => {
        const frame = page.frameLocator('iframe[name="inner"]');
        await frame.locator('input[name="city"]').fill('Torino');
        await frame.locator('input[name="city"]').press('Tab');
      },
      'iframe[name="inner"]',
    );

    const city = actions.filter((a) => a.type === 'input');
    expect(city).toHaveLength(1);
    // The iframe itself lives in x-frame-shell's root: its selector carries that shadow path,
    // and the step's selector carries the one inside the frame. ' >> ' only between frames.
    expect(city[0].frameSelector).toContain('x-frame-shell');
    expect(city[0].frameSelector).toContain('iframe[name="inner"]');
    expect(city[0].selector).toContain('x-field');
    expect(city[0].selector).not.toContain('iframe');
    expect(await resolve('/frames', city[0].selector!, city[0].frameSelector)).toEqual({
      count: 1,
      key: 'city',
    });
    // The iframe's own load is not a navigation of the test.
    expect(actions.filter((a) => a.type === 'navigate' && !!a.url?.includes('/inner'))).toEqual([]);
    expect(
      mapRecordedSequence(actions).find((s) => s.action.id === 'input')?.targetElement,
    ).toMatchObject({ frameSelector: city[0].frameSelector });
  }, 60_000);

  describe('record, save, replay through the engine', () => {
    /** Saved as the builder saves it (JSON), replayed by the engine, checked on #echo. */
    async function replay(
      path: string,
      actions: RecordedAction[],
      echo: string,
      echoFrame: string | null,
      vars: Record<string, string> = {},
    ) {
      const { playwrightService } = await import('../web/playwright-service');
      const saved = JSON.parse(JSON.stringify(mapRecordedSequence(actions)));
      saved.push({
        id: 'check-echo',
        action: {
          id: 'assertTextContains',
          type: 'assertTextContains',
          name: 'Same values on the same targets',
          icon: 'c',
          description: 'x',
        },
        targetElement: {
          id: 'echo',
          type: 'p',
          selector: '#echo',
          text: '',
          tag: 'p',
          attributes: {},
          frameSelector: echoFrame,
        },
        value: echo,
      });
      const result = await playwrightService.executeTestSequence(
        {
          id: 1,
          userId: 1,
          organizationId: 1,
          projectId: null,
          name: 'shadow-replay',
          url: `${fixture.baseUrl}${path}`,
          sequence: saved,
          elements: [],
          preconditions: null,
          status: 'draft',
          createdAt: new Date(),
          updatedAt: new Date(),
          module: null,
          featureArea: null,
          scenario: null,
          component: null,
          priority: 'Medium',
          severity: 'Major',
        } as never,
        1,
        undefined,
        undefined,
        vars,
      );
      return result.steps ?? [];
    }

    it('replays the components page with the recorded values on the recorded targets', async () => {
      const { actions, echo } = await record('shadow-replay', '/', async (page) => {
        await page.fill('input[data-key="plain"]', 'light');
        await page.press('input[data-key="plain"]', 'Tab');
        await page.fill(USER, 'marco');
        await page.press(USER, 'Tab');
        await page.fill('x-login input[name="pass"]', 'hunter22');
        await page.press('x-login input[name="pass"]', 'Tab');
        await page.selectOption('x-inner select[name="color"]', 'blue');
        await page.check('x-inner input[name="agree"]');
        await page.click('x-inner button:text-is("Save")');
        await page.click('#add-late');
        await page.fill('x-late input[name="late"]', 'late');
        await page.press('x-late input[name="late"]', 'Tab');
        await page.fill('x-login input[name="search"]', 'orders');
        await page.press('x-login input[name="search"]', 'Enter');
      });
      expect(echo).toContain('user=marco');
      expect(echo).toContain('plain=light');

      const steps = await replay('/', actions, echo, null, { secret_pass: 'hunter22' });
      const failures = steps.filter((s) => s.status === 'failed');
      expect(failures.map((f) => `${f.type}: ${f.error}`)).toEqual([]);
      expect(steps.length).toBeGreaterThan(5);
    }, 120_000);

    it('replays a component inside an iframe inside a component', async () => {
      const { actions, echo } = await record(
        'shadow-replay-frame',
        '/frames',
        async (page) => {
          const frame = page.frameLocator('iframe[name="inner"]');
          await frame.locator('input[name="city"]').fill('Torino');
          await frame.locator('input[name="city"]').press('Tab');
        },
        'iframe[name="inner"]',
      );
      expect(echo).toBe('city=Torino');

      const frameSelector = actions.find((a) => a.type === 'input')!.frameSelector!;
      const steps = await replay('/frames', actions, echo, frameSelector);
      const failures = steps.filter((s) => s.status === 'failed');
      expect(failures.map((f) => `${f.type}: ${f.error}`)).toEqual([]);
    }, 120_000);
  });
});

describe('the secret-field pattern', () => {
  it('masks card, one-time-code and SSN fields as well as passwords', () => {
    const source = RECORDER_SCRIPT.match(/return (\/pass[^;]*\/)\.test\(haystack\)/)?.[1];
    expect(source).toBeTruthy();
    const secret = new Function(`return ${source}`)() as RegExp;
    for (const hit of ['cc-number', 'one-time-code', 'ssn', 'cc-csc', 'cvc', 'password'])
      expect(secret.test(hit), hit).toBe(true);
    for (const miss of ['email', 'first-name', 'city']) expect(secret.test(miss), miss).toBe(false);
  });
});
