import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { ADHOC_ACTION_IDS, type AdhocActionId, type MappedTestStep } from '@shared/recording';

/**
 * The step executor, exercised through the *persisted* path.
 *
 * `executeAdhocSequence` (the "Execute Test" button) and `executeTestSequence` (a saved
 * test, a test plan, every schedule) each carried their own copy of the action switch, and
 * they had already drifted: the persisted copy has no `navigate` case, so a recorded
 * multi-page test passes when previewed and fails when replayed. These tests run the
 * persisted path, because that is the one that was broken.
 */

let server: http.Server;
let baseUrl: string;
let savedBaseUrlEnv: string | undefined;

const PAGES: Record<string, string> = {
  // `#echo` mirrors what was actually typed, so an assertion can read the value that
  // reached the page rather than trusting the step's own report of itself.
  '/': `<!doctype html><title>First</title><h1 id="title">First page</h1>
        <a id="go" href="/second">go</a>
        <input id="field" type="text" oninput="document.getElementById('echo').textContent = this.value">
        <span id="echo"></span>
        <select id="native"><option value="a">A</option><option value="b">B</option></select>`,
  '/second': `<!doctype html><title>Second</title><h1 id="title">Second page</h1>`,

  // Everything here appears *after* a delay, which is the shape of a DMO page: the shell
  // renders, then SignalR pushes the content. A fixed `wait` can only guess how long.
  '/late': `<!doctype html><title>Late</title>
    <h1 id="title">Loading…</h1>
    <div id="panel" style="display:none">ready</div>
    <script>
      setTimeout(function () {
        document.getElementById('panel').style.display = 'block';
        document.getElementById('title').textContent = 'Order 4711 confirmed';
      }, 700);
    </script>`,

  // A mat-select in miniature: the trigger is a div, and the options are mounted in a
  // CDK-style overlay that is a sibling of the trigger's container, not a child of it.
  // page.selectOption() cannot see any of this.
  '/material': `<!doctype html><title>Material</title>
    <h1 id="title">Material page</h1>
    <div id="site-select" role="combobox" tabindex="0" class="mat-mdc-select">
      <span id="site-value" class="mat-mdc-select-value">Choose a site</span>
    </div>
    <div id="overlay-root"></div>
    <script>
      document.getElementById('site-select').addEventListener('click', function () {
        var root = document.getElementById('overlay-root');
        if (root.childElementCount > 0) { root.innerHTML = ''; return; }
        ['Henniez', 'Nespresso', 'Zoegas'].forEach(function (name) {
          var opt = document.createElement('div');
          opt.setAttribute('role', 'option');
          opt.className = 'mat-mdc-option';
          opt.textContent = name;
          opt.addEventListener('click', function () {
            document.getElementById('site-value').textContent = name;
            root.innerHTML = '';
          });
          root.appendChild(opt);
        });
      });
    </script>`,
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = PAGES[(req.url ?? '/').split('?')[0]];
    if (body === undefined) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // `{{baseUrl}}` is the one variable the persisted path could already resolve, so using it
  // keeps this test about the executor rather than about variable plumbing.
  savedBaseUrlEnv = process.env.DMO_BASE_URL;
  process.env.DMO_BASE_URL = baseUrl;
});

afterAll(async () => {
  if (savedBaseUrlEnv === undefined) delete process.env.DMO_BASE_URL;
  else process.env.DMO_BASE_URL = savedBaseUrlEnv;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const step = (
  id: AdhocActionId,
  opts: { selector?: string; value?: string } = {},
): MappedTestStep => ({
  id: `step-${id}`,
  action: { id, type: id, name: id, icon: 'x', description: id },
  targetElement: opts.selector
    ? { id: 'e1', type: 'element', selector: opts.selector, text: '', tag: 'div', attributes: {} }
    : undefined,
  value: opts.value,
});

const savedTest = (sequence: MappedTestStep[], path = '/') =>
  ({
    id: 1,
    userId: 1,
    organizationId: 1,
    projectId: null,
    name: 'persisted-path',
    url: `${baseUrl}${path}`,
    sequence,
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
  }) as never;

describe('a saved test replayed through executeTestSequence', () => {
  it('runs a navigate step instead of rejecting it as unsupported', async () => {
    const { playwrightService } = await import('./playwright-service');

    const result = await playwrightService.executeTestSequence(
      savedTest([
        step('navigate', { value: '{{baseUrl}}/second' }),
        step('assertTextContains', { selector: '#title', value: 'Second page' }),
      ]),
      1,
    );

    const failures = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failures.map((f) => f.error)).toEqual([]);
    expect(result.success).toBe(true);
  }, 60_000);

  it('substitutes variables in an input value', async () => {
    const { playwrightService } = await import('./playwright-service');

    const result = await playwrightService.executeTestSequence(
      savedTest([
        step('input', { selector: '#field', value: '{{baseUrl}}/typed' }),
        // Reads what the page received. A literal `{{baseUrl}}` typed into a field is
        // exactly how recorded `{{secret_…}}` passwords used to reach the app under test.
        step('assertTextContains', { selector: '#echo', value: `${baseUrl}/typed` }),
      ]),
      1,
    );

    const failures = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failures.map((f) => `${f.type}: ${f.error}`)).toEqual([]);
    expect(result.success).toBe(true);
  }, 60_000);
});

describe('unresolved variables', () => {
  it('fails the step instead of typing the placeholder into the page', async () => {
    const { playwrightService } = await import('./playwright-service');

    const result = await playwrightService.executeTestSequence(
      savedTest([step('input', { selector: '#field', value: '{{secret_password}}' })]),
      1,
    );

    const inputStep = (result.steps ?? []).find((s) => s.type === 'input');
    expect(inputStep?.status).toBe('failed');
    // The message has to name what to define: the tester's fix is to pick an environment
    // that carries this secret, and "the step failed" does not say that.
    expect(inputStep?.error).toContain('secret_password');
    expect(result.success).toBe(false);
  }, 60_000);

  it('resolves an environment secret handed to it by the caller', async () => {
    const { playwrightService } = await import('./playwright-service');

    const result = await playwrightService.executeTestSequence(
      savedTest([
        step('input', { selector: '#field', value: '{{secret_password}}' }),
        step('assertTextContains', { selector: '#echo', value: 'hunter2' }),
      ]),
      1,
      undefined,
      undefined,
      { baseUrl, secret_password: 'hunter2' },
    );

    const failures = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failures.map((f) => `${f.type}: ${f.error}`)).toEqual([]);
    expect(result.success).toBe(true);
  }, 60_000);

  it('reports an unresolved URL in a navigate step the same way', async () => {
    const { playwrightService } = await import('./playwright-service');

    const result = await playwrightService.executeTestSequence(
      savedTest([step('navigate', { value: '{{missingHost}}/orders' })]),
      1,
    );

    const navStep = (result.steps ?? []).find((s) => s.type === 'navigate');
    expect(navStep?.status).toBe('failed');
    expect(navStep?.error).toContain('Unresolved variable(s) missingHost');
  }, 60_000);
});

describe('waiting for something to happen instead of for a duration', () => {
  const runOnLatePage = async (sequence: MappedTestStep[]) => {
    const { playwrightService } = await import('./playwright-service');
    return playwrightService.executeTestSequence(savedTest(sequence, '/late'), 1);
  };

  it('waits for an element to become visible', async () => {
    const result = await runOnLatePage([
      step('waitForElement', { selector: '#panel', value: 'visible' }),
      step('assert', { selector: '#panel' }),
    ]);

    const failures = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failures.map((f) => `${f.type}: ${f.error}`)).toEqual([]);
  }, 60_000);

  it('waits for an element to contain text', async () => {
    const result = await runOnLatePage([
      step('waitForText', { selector: '#title', value: 'Order 4711 confirmed' }),
    ]);

    const waitStep = (result.steps ?? []).find((s) => s.type === 'waitForText');
    expect(waitStep?.status).toBe('passed');
  }, 60_000);

  it('names the selector and the state when the wait times out', async () => {
    const result = await runOnLatePage([
      step('waitForElement', { selector: '#never-appears', value: 'visible' }),
    ]);

    const waitStep = (result.steps ?? []).find((s) => s.type === 'waitForElement');
    expect(waitStep?.status).toBe('failed');
    // A bare Playwright timeout says nothing about what the test was waiting for.
    expect(waitStep?.error).toContain('#never-appears');
    expect(waitStep?.error).toContain('visible');
  }, 60_000);

  it('waits for the network to settle', async () => {
    const result = await runOnLatePage([step('waitForNetworkIdle')]);

    const waitStep = (result.steps ?? []).find((s) => s.type === 'waitForNetworkIdle');
    expect(waitStep?.status).toBe('passed');
  }, 60_000);
});

describe('a dropdown that is not a <select>', () => {
  it('opens a Material-style combobox and picks the option by text', async () => {
    const { playwrightService } = await import('./playwright-service');

    const result = await playwrightService.executeTestSequence(
      savedTest(
        [
          step('selectByText', { selector: '#site-select', value: 'Nespresso' }),
          step('assertTextContains', { selector: '#site-value', value: 'Nespresso' }),
        ],
        '/material',
      ),
      1,
    );

    const failures = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failures.map((f) => `${f.type}: ${f.error}`)).toEqual([]);
    expect(result.success).toBe(true);
  }, 60_000);

  it('reports the options it could see when the wanted one is absent', async () => {
    const { playwrightService } = await import('./playwright-service');

    const result = await playwrightService.executeTestSequence(
      savedTest([step('selectByText', { selector: '#site-select', value: 'Konolfingen' })], '/material'),
      1,
    );

    const selectStep = (result.steps ?? []).find((s) => s.type === 'selectByText');
    expect(selectStep?.status).toBe('failed');
    expect(selectStep?.error).toContain('Konolfingen');
  }, 60_000);
});

describe('action coverage', () => {
  it('handles every action the builder and recorder can produce', async () => {
    const { HANDLED_ACTION_IDS } = await import('./step-executor');

    // The real guarantee is a compile-time one: the executor's handler map is typed
    // `Record<AdhocActionId, …>`, so declaring an action without writing its handler fails
    // `npm run check`. This asserts the same thing at runtime, and exists because the
    // previous version of it derived the set from ADHOC_ACTION_IDS and so proved nothing.
    expect([...HANDLED_ACTION_IDS].sort()).toEqual([...ADHOC_ACTION_IDS].sort());
  });
});
