import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

/**
 * Selector generation against Angular-shaped markup.
 *
 * `buildUniqueSelector` preferred `#id` above everything, which is right for hand-written
 * markup and wrong for Angular Material: it stamps ids like `mat-input-3` and
 * `mat-select-value-5` that are assigned in render order and change as soon as anything
 * above the element does. A test recorded on Monday then fails on Tuesday against an
 * unchanged application — the single most expensive kind of false failure, because it
 * teaches the team to distrust the suite.
 */

let server: http.Server;
let baseUrl: string;

const PAGE = `<!doctype html>
<title>Site form</title>
<h1>Order entry</h1>

<!-- Angular Material shape: the id is generated and volatile, the label is not. -->
<label for="mat-input-3">Username</label>
<input id="mat-input-3" aria-label="Username" class="mat-mdc-input-element ng-untouched ng-pristine">

<!-- A second generated id, so an index-based selector would also be ambiguous. -->
<input id="mat-input-4" aria-label="Password" type="password" class="mat-mdc-input-element">

<!-- Hand-written and stable: this one should still win on its id. -->
<button id="save-order" class="mat-mdc-button">Save</button>

<!-- Nothing unique but its text. -->
<button class="mat-mdc-button">Confirm shipment</button>

<!-- A testid, which should outrank everything but a stable id. -->
<button id="mat-button-9" data-testid="cancel-order" class="mat-mdc-button">Cancel</button>

<!-- Two identical siblings: only a structural path can tell them apart. -->
<div class="row"><span class="cell">A</span></div>
<div class="row"><span class="cell">B</span></div>
`;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Detected elements keyed by their visible text, which is how a tester recognises them. */
async function detectByText() {
  const { playwrightService } = await import('./playwright-service');
  const { elements } = await playwrightService.detectElements(baseUrl);
  return { elements, find: (text: string) => elements.find((e) => e.text.includes(text)) };
}

describe('selectors for Angular-generated markup', () => {
  it('does not build a selector out of a volatile Material id', async () => {
    const { elements } = await detectByText();

    const username = elements.find((e) => e.attributes['aria-label'] === 'Username');
    expect(username).toBeDefined();
    expect(username!.selector).not.toContain('mat-input-3');
    // The accessible label is the stable thing on this element.
    expect(username!.selector).toContain('Username');
  }, 60_000);

  it('still prefers an id that looks hand-written', async () => {
    const { find } = await detectByText();

    expect(find('Save')?.selector).toBe('#save-order');
  }, 60_000);

  it('prefers a testid over a generated id', async () => {
    const { find } = await detectByText();

    const cancel = find('Cancel');
    expect(cancel?.selector).not.toContain('mat-button-9');
    expect(cancel?.selector).toContain('cancel-order');
  }, 60_000);

  it('falls back to text when nothing else identifies the element', async () => {
    const { find } = await detectByText();

    const confirm = find('Confirm shipment');
    expect(confirm).toBeDefined();
    // Not a bare class selector: `button.mat-mdc-button` matches three buttons here, and
    // Playwright refuses to click an ambiguous locator.
    expect(confirm!.selector).not.toBe('button.mat-mdc-button');
  }, 60_000);

  it('produces selectors that each match exactly one element', async () => {
    const { elements } = await detectByText();
    const { playwrightService } = await import('./playwright-service');

    // The real contract. A selector the engine cannot act on unambiguously is worse than
    // no selector, because the failure surfaces later, during replay.
    const ambiguous = await playwrightService.countSelectorMatches(
      baseUrl,
      elements.map((e) => e.selector),
    );

    expect(ambiguous.filter((r) => r.count !== 1)).toEqual([]);
  }, 60_000);

  it('still produces a structural path for otherwise identical siblings', async () => {
    const { elements } = await detectByText();

    const cells = elements.filter((e) => e.tag === 'span');
    // Whatever strategy wins, the two must not collide.
    const selectors = new Set(cells.map((e) => e.selector));
    expect(selectors.size).toBe(cells.length);
  }, 60_000);
});

describe('the preview the highlighting is drawn on', () => {
  it('returns the screenshot from the same page load as the boxes', async () => {
    const { playwrightService } = await import('./playwright-service');

    const result = await playwrightService.detectElements(baseUrl);

    // The screenshot used to come from loadWebsite() — a second browser, a second
    // navigation. On anything that renders differently twice (a carousel, an ad, a grid
    // sorted by time) the image and the boxes described two different pages, and the
    // highlight landed on the wrong thing.
    expect(result.screenshot).toMatch(/^data:image\/png;base64,/);
    expect(result.summary.pageSize.width).toBeGreaterThan(0);
    expect(result.summary.pageSize.height).toBeGreaterThan(0);
  }, 60_000);

  it('keeps every box inside the screenshot it will be drawn on', async () => {
    const { playwrightService } = await import('./playwright-service');

    const { elements, summary } = await playwrightService.detectElements(baseUrl);

    // A box outside the image is a highlight the tester cannot see — which is what a
    // viewport screenshot plus a document-relative box produced for anything below the
    // fold. The screenshot is full-page so that every detected element is on it.
    const outside = elements.filter(
      (e) =>
        !e.boundingBox ||
        e.boundingBox.x < 0 ||
        e.boundingBox.y < 0 ||
        e.boundingBox.x + e.boundingBox.width > summary.pageSize.width + 1 ||
        e.boundingBox.y + e.boundingBox.height > summary.pageSize.height + 1,
    );

    expect(outside.map((e) => `${e.tag}:${e.text}`)).toEqual([]);
  }, 60_000);

  it('says how many elements it left out instead of truncating in silence', async () => {
    const saved = process.env.ELEMENT_DETECTION_LIMIT;
    process.env.ELEMENT_DETECTION_LIMIT = '2';
    try {
      const { playwrightService } = await import('./playwright-service');

      const { elements, summary } = await playwrightService.detectElements(baseUrl);

      expect(elements).toHaveLength(2);
      expect(summary.truncated).toBe(true);
      expect(summary.totalFound).toBeGreaterThan(2);
      expect(summary.returned).toBe(2);
    } finally {
      if (saved === undefined) delete process.env.ELEMENT_DETECTION_LIMIT;
      else process.env.ELEMENT_DETECTION_LIMIT = saved;
    }
  }, 60_000);
});
