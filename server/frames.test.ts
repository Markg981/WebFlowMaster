import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

/**
 * Elements the page does not hold directly.
 *
 * `frameLocator` appeared nowhere in server/, and `page.locator` does not cross an iframe
 * boundary. So anything inside one was invisible to both detection and execution: not
 * merely unclickable, but absent from the Detected Elements list, which makes it look like
 * the page does not have it. DMO's logsheet printing mounts iframes, and any embedded
 * legacy screen is the same shape.
 *
 * Shadow DOM is the other half of the same gap. Playwright pierces open shadow roots for
 * CSS selectors on its own, so the work there is detection, not execution.
 */

let server: http.Server;
let baseUrl: string;

const FRAME_CHILD = `<!doctype html><title>inner</title>
  <h1 id="inner-title">Inner document</h1>
  <button id="inner-button" aria-label="Confirm inside the frame">Confirm</button>`;

const PAGE = `<!doctype html><title>Host</title>
  <h1 id="outer-title">Host document</h1>
  <button id="outer-button">Outer</button>
  <iframe id="report" name="report" src="/frame" width="400" height="200"></iframe>

  <div id="host"></div>
  <script>
    // An open shadow root, the way a web component ships one.
    const root = document.getElementById('host').attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="shadow-button" aria-label="Inside the shadow root">Shadow</button>';
  </script>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = (req.url ?? '/').startsWith('/frame') ? FRAME_CHILD : PAGE;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('detecting elements inside an iframe', () => {
  it('finds them at all', async () => {
    const { playwrightService } = await import('./playwright-service');

    const { elements } = await playwrightService.detectElements(baseUrl);

    const inner = elements.find((e) => e.text.includes('Confirm'));
    expect(inner).toBeDefined();
  }, 60_000);

  it('gives them a selector that says which frame they are in', async () => {
    const { playwrightService } = await import('./playwright-service');

    const { elements } = await playwrightService.detectElements(baseUrl);
    const inner = elements.find((e) => e.text.includes('Confirm'));

    // A selector that does not name the frame cannot be acted on from the top document,
    // however unique it is inside its own.
    expect(inner!.frameSelector).toBeTruthy();
    expect(inner!.frameSelector).toContain('report');
  }, 60_000);

  it('still finds the elements of the host document', async () => {
    const { playwrightService } = await import('./playwright-service');

    const { elements } = await playwrightService.detectElements(baseUrl);

    const outer = elements.find((e) => e.text.includes('Outer'));
    expect(outer).toBeDefined();
    // Nothing to enter, so nothing to record.
    expect(outer!.frameSelector).toBeFalsy();
  }, 60_000);
});

describe('detecting elements inside a shadow root', () => {
  it('finds them', async () => {
    const { playwrightService } = await import('./playwright-service');

    const { elements } = await playwrightService.detectElements(baseUrl);

    const shadow = elements.find((e) => e.text.includes('Shadow'));
    expect(shadow).toBeDefined();
  }, 60_000);
});

describe('acting on an element inside an iframe', () => {
  it('clicks it', async () => {
    const { playwrightService } = await import('./playwright-service');

    const result = await playwrightService.executeTestSequence(
      {
        id: 1, userId: 1, organizationId: 1, projectId: null,
        name: 'frame-click', url: baseUrl,
        sequence: [
          {
            id: 's1',
            action: { id: 'assertTextContains', type: 'assertTextContains', name: 'Assert inner', icon: 'c', description: 'x' },
            targetElement: {
              id: 'e1', type: 'heading', selector: '#inner-title', text: '', tag: 'h1',
              attributes: {},
              // The frame the selector is relative to.
              frameSelector: 'iframe#report',
            },
            value: 'Inner document',
          },
        ],
        elements: [], preconditions: null, status: 'draft',
        createdAt: new Date(), updatedAt: new Date(),
        module: null, featureArea: null, scenario: null, component: null,
        priority: 'Medium', severity: 'Major',
      } as never,
      1,
    );

    const failures = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failures.map((f) => `${f.type}: ${f.error}`)).toEqual([]);
    // Not redundant: an empty failure list is also what a run that never started produces,
    // so without this the test passed in 15ms on a machine with no browser.
    expect(result.success).toBe(true);
  }, 60_000);
});

/**
 * The same two things, for a frame served by a different origin.
 *
 * Worth pinning separately, because the limit everyone expects here is the one the browser
 * imposes on the page itself: script in the host document cannot reach into
 * `iframe.contentDocument` across origins, so a detector written as one `page.evaluate`
 * over the top document genuinely cannot see any of this — and that was assumed to be the
 * ceiling for this product too.
 *
 * It is not. Playwright drives each frame over its own connection to the browser rather
 * than from inside the page, so `page.frames()` and `frameLocator()` cross an origin
 * boundary the way they cross any other. Nothing here needed fixing; what it needed was a
 * test, so that the capability is not given up a second time — and so that a future change
 * to how frames are scanned cannot quietly lose it.
 *
 * It matters for the real target: an embedded legacy screen or a report viewer is usually
 * served from a different host than the shell that mounts it.
 */
describe('a frame from a different origin', () => {
  let otherOrigin: http.Server;
  let hostPage: http.Server;
  let hostUrl: string;
  let innerWasClicked = false;

  beforeAll(async () => {
    otherOrigin = http.createServer((req, res) => {
      // The click reports itself back to its own server, so the assertion rests on the
      // page having been driven rather than on the runner's account of itself.
      if ((req.url ?? '').startsWith('/clicked')) {
        innerWasClicked = true;
        return res.writeHead(204).end();
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        `<!doctype html><title>other</title>
         <button id="x-button" onclick="fetch('/clicked')">Confirm across origins</button>`,
      );
    });
    await new Promise<void>((resolve) => otherOrigin.listen(0, '127.0.0.1', resolve));
    // A different port is a different origin, which is all the same-origin policy asks.
    const otherUrl = `http://127.0.0.1:${(otherOrigin.address() as AddressInfo).port}/`;

    hostPage = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        `<!doctype html><title>host</title>
         <iframe id="embedded" src="${otherUrl}" width="400" height="200"></iframe>`,
      );
    });
    await new Promise<void>((resolve) => hostPage.listen(0, '127.0.0.1', resolve));
    hostUrl = `http://127.0.0.1:${(hostPage.address() as AddressInfo).port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => hostPage.close(() => resolve()));
    await new Promise<void>((resolve) => otherOrigin.close(() => resolve()));
  });

  it('is detected, and says which frame its elements are in', async () => {
    const { playwrightService } = await import('./playwright-service');

    const { elements } = await playwrightService.detectElements(hostUrl);

    const inner = elements.find((e) => e.text.includes('Confirm across origins'));
    expect(inner).toBeDefined();
    expect(inner!.frameSelector).toBe('iframe#embedded');
  }, 60_000);

  it('can be acted on, not merely listed', async () => {
    const { playwrightService } = await import('./playwright-service');

    const { elements } = await playwrightService.detectElements(hostUrl);
    const inner = elements.find((e) => e.text.includes('Confirm across origins'));

    const result = await playwrightService.executeTestSequence(
      {
        id: 1, userId: 1, organizationId: 1, projectId: null,
        name: 'cross-origin-frame-click', url: hostUrl,
        sequence: [
          {
            id: 's1',
            action: { id: 'click', type: 'click', name: 'Click', icon: 'c', description: 'x' },
            // Exactly what detection reported: listing an element the runner cannot then
            // act on would be the false promise frameChainFor exists to avoid.
            targetElement: inner as never,
            value: undefined,
          },
        ],
        elements: [], preconditions: null, status: 'draft',
        createdAt: new Date(), updatedAt: new Date(),
        module: null, featureArea: null, scenario: null, component: null,
        priority: 'Medium', severity: 'Major',
      } as never,
      1,
    );

    const failures = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failures.map((f) => `${f.type}: ${f.error}`)).toEqual([]);
    expect(innerWasClicked).toBe(true);
  }, 60_000);
});
