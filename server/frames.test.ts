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
  }, 60_000);
});
