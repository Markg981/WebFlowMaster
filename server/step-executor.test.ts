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
    <ul id="rows"></ul>
    <script>
      setTimeout(function () {
        document.getElementById('panel').style.display = 'block';
        document.getElementById('title').textContent = 'Order 4711 confirmed';
        var rows = document.getElementById('rows');
        for (var i = 0; i < 3; i++) {
          var li = document.createElement('li');
          li.className = 'row';
          li.textContent = 'Row ' + (i + 1);
          rows.appendChild(li);
        }
      }, 700);
    </script>`,

  // Controls in the two shapes an application actually uses: a real <input type=checkbox>,
  // and the Angular Material arrangement DMO has — a div with a role and aria-checked, no
  // input anywhere. A state assertion that only understood the first would be useless on
  // the application it was written for.
  '/controls': `<!doctype html><title>Controls</title>
    <h1 id="title">Controls</h1>
    <input id="native-on" type="checkbox" checked>
    <input id="native-off" type="checkbox">
    <div id="mat-toggle-on" role="switch" aria-checked="true" tabindex="0">NetContentMachine</div>
    <div id="mat-toggle-off" role="switch" aria-checked="false" tabindex="0">NCC_RCP2</div>
    <button id="live">Enabled</button>
    <button id="dead" disabled>Disabled</button>
    <input id="typable" type="text">
    <input id="locked" type="text" readonly>
    <script>
      // Flips late, so the assertion has to be willing to look again.
      setTimeout(function () {
        document.getElementById('mat-toggle-off').setAttribute('aria-checked', 'true');
      }, 700);
    </script>`,

  // The precondition screen, in the two shapes that matter and with the toggles actually
  // wired, because ensureState has to be able to change them and then read the change back.
  //
  // `#fn-already-on` is the case the whole action exists for: a function that someone — or
  // a previous run of the same test — has already switched on. A `click` step here turns it
  // off and the test then fails on a tab that never appears.
  '/setup': `<!doctype html><title>Setup</title>
    <h1 id="title">Machine setup</h1>
    <div id="fn-already-on" role="switch" aria-checked="true" tabindex="0">NetContentMachine</div>
    <div id="fn-off" role="switch" aria-checked="false" tabindex="0">NCC_RCP2</div>
    <input id="box-on" type="checkbox" checked>
    <input id="box-off" type="checkbox">
    <span id="label">not a control</span>
    <div id="tab" hidden>Static Scale Check</div>
    <script>
      // The switches behave like the real ones: a click flips aria-checked.
      ['fn-already-on', 'fn-off'].forEach(function (id) {
        var el = document.getElementById(id);
        el.addEventListener('click', function () {
          var on = el.getAttribute('aria-checked') === 'true';
          el.setAttribute('aria-checked', on ? 'false' : 'true');
          // The tab under test appears only while both functions are on — the same coupling
          // the application has, so a setup step that toggles one off is visible in the result.
          var both =
            document.getElementById('fn-already-on').getAttribute('aria-checked') === 'true' &&
            document.getElementById('fn-off').getAttribute('aria-checked') === 'true';
          document.getElementById('tab').hidden = !both;
        });
      });
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
    // Not redundant. "No step failed" is also true of a run that produced no steps at all,
    // so on a machine with no browser installed this test passed in 18ms while proving
    // nothing — which is how it stayed green in CI for as long as CI had no browsers.
    expect(result.success).toBe(true);
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

/**
 * Assertions on a screen that has not finished rendering.
 *
 * None of the three waited. Replaying a recorded DMO test, the click on a tab returned, the
 * assertion on the tab's content ran against the DOM as it was that instant, and the step
 * failed in 16ms — against a tab that was there a moment later. That is not flakiness, it is
 * an assertion that reports the wrong answer whenever the application renders after the fact,
 * which an Angular application does constantly. The fix cost a `waitForElement` inserted by
 * hand in front of every assertion, which is not something a recording can be expected to do.
 */
describe('an assertion on a screen that is still rendering', () => {
  const runOnLatePage = async (sequence: MappedTestStep[]) => {
    const { playwrightService } = await import('./playwright-service');
    return playwrightService.executeTestSequence(savedTest(sequence, '/late'), 1);
  };

  it('waits for an element to become visible instead of judging it at once', async () => {
    // #panel is display:none for 700ms. No explicit wait in front of it — that is the point.
    const result = await runOnLatePage([step('assert', { selector: '#panel' })]);

    const failures = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failures.map((f) => f.error)).toEqual([]);
    expect(result.success).toBe(true);
  }, 60_000);

  it('waits for the text to arrive', async () => {
    const result = await runOnLatePage([
      step('assertTextContains', { selector: '#title', value: 'Order 4711 confirmed' }),
    ]);

    expect(result.success).toBe(true);
  }, 60_000);

  it('waits for the rows to be rendered before counting them', async () => {
    const result = await runOnLatePage([
      step('assertElementCount', { selector: '.row', value: '==3' }),
    ]);

    expect(result.success).toBe(true);
  }, 60_000);

  it('still fails when the thing never arrives, and says it waited', async () => {
    const started = Date.now();
    const result = await runOnLatePage([step('assert', { selector: '#never-there' })]);
    const elapsed = Date.now() - started;

    const failure = (result.steps ?? []).find((s) => s.status === 'failed');
    expect(failure?.error).toContain('#never-there');
    // Patience is not the same as hanging: a genuine failure has to stay quick enough that a
    // suite full of them still finishes, which is why assertions wait for less time than the
    // explicit waits do.
    expect(elapsed).toBeLessThan(20_000);
  }, 60_000);

  it('does not turn a wrong expectation into a passing one by waiting', async () => {
    // The text does change, but never to this. Waiting must not become "eventually accept
    // whatever is there".
    const result = await runOnLatePage([
      step('assertTextContains', { selector: '#title', value: 'Order 9999 confirmed' }),
    ]);

    expect(result.success).toBe(false);
    const failure = (result.steps ?? []).find((s) => s.status === 'failed');
    // And the message reports what was actually on screen, not only what was wanted.
    expect(failure?.error).toContain('Order 4711 confirmed');
  }, 60_000);
});

/**
 * The table the builder draws its fields from, against what the runner actually demands.
 *
 * Three copies of "which actions need an element, which need a value" had drifted: the
 * builder node's two arrays, the schema's two refines, and the handlers themselves. The
 * conditional waits and the Material dropdown were added to the action list and only the
 * handlers learned about them, so `waitForElement` could be dragged into a sequence, drawn
 * with no element to drop onto and no value to type, accepted by validation, and then fail at
 * run time. Now there is one table — and this is the test that it tells the truth, because a
 * shared table that nobody checks is just the same lie in one place.
 */
describe('what each action needs', () => {
  const bare = (id: AdhocActionId): MappedTestStep => ({
    id: `step-${id}`,
    action: { id, type: id, name: id, icon: 'x', description: id },
    targetElement: undefined,
    value: undefined,
  });

  const withTarget = (id: AdhocActionId): MappedTestStep => ({
    ...bare(id),
    targetElement: {
      id: 'e1', type: 'element', selector: '#title', text: '', tag: 'h1', attributes: {},
    },
  });

  /**
   * "It refused, and said why" — however the handler chose to say it.
   *
   * Some return a failed outcome and some throw: `assert` and the wait actions return,
   * `click` and `input` throw. Both end up as a failed step because the callers wrap each
   * one, so the difference is cosmetic — but it is a difference, and a test that knew about
   * only one of them would have called the other a passing step.
   */
  const refusal = async (step: MappedTestStep, page: unknown): Promise<string | null> => {
    const { executeStep } = await import('./step-executor');
    try {
      const outcome = await executeStep({ page } as never, step as never);
      return outcome.status === 'failed' ? outcome.error ?? '' : null;
    } catch (error) {
      return (error as Error).message;
    }
  };

  it('refuses a step with no element, for exactly the actions the table marks as needing one', async () => {
    const { ACTION_REQUIREMENTS } = await import('@shared/recording');
    const { chromium } = await import('playwright');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/`);

    const disagreed: string[] = [];
    for (const id of ADHOC_ACTION_IDS) {
      if (!ACTION_REQUIREMENTS[id].target) continue;
      const error = await refusal(bare(id), page);
      // In the runner's own words, so the message a tester reads is the one under test.
      if (error === null || !/selector|element/i.test(error)) {
        disagreed.push(`${id}: ${error === null ? 'passed' : error}`);
      }
    }

    await browser.close();
    expect(disagreed).toEqual([]);
  }, 120_000);

  it('refuses a step with no value, for exactly the actions the table marks as requiring one', async () => {
    const { ACTION_REQUIREMENTS } = await import('@shared/recording');
    const { chromium } = await import('playwright');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/`);

    const disagreed: string[] = [];
    for (const id of ADHOC_ACTION_IDS) {
      if (!ACTION_REQUIREMENTS[id].valueRequired) continue;
      // Given the element it needs, so what is left is the missing value and nothing else.
      const step = ACTION_REQUIREMENTS[id].target ? withTarget(id) : bare(id);
      const error = await refusal(step, page);
      if (error === null || !/value|url/i.test(error)) {
        disagreed.push(`${id}: ${error === null ? 'passed' : error}`);
      }
    }

    await browser.close();
    expect(disagreed).toEqual([]);
  }, 120_000);

  it('lets waitForElement run without a value, which the table says is optional', async () => {
    const { executeStep } = await import('./step-executor');
    const { chromium } = await import('playwright');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/`);

    // It takes a value — "visible" or "hidden" — and means visible when left empty. The
    // difference between `value` and `valueRequired` exists for this, and the builder has to
    // draw the field without validation demanding it be filled.
    const outcome = await executeStep({ page }, withTarget('waitForElement') as never);

    await browser.close();
    expect(outcome.status).toBe('passed');
  }, 120_000);
});

/**
 * Asserting the state of a control.
 *
 * Before this action existed the only way to check one was to fold the state into the
 * selector — `[aria-checked="true"]` appended to whatever identified the element. That works
 * and reports badly: when the toggle is off the selector matches nothing and the step says
 * the element was not found, sending the tester to look for a control that is on screen in
 * front of them. NCC_TC_00085 needs exactly this, to turn "enable the function" from a
 * configuration change into a check that it is still enabled.
 */
describe('asserting the state of a control', () => {
  const runOnControls = async (sequence: MappedTestStep[]) => {
    const { playwrightService } = await import('./playwright-service');
    return playwrightService.executeTestSequence(savedTest(sequence, '/controls'), 1);
  };

  const stateStep = (selector: string, value: string) =>
    step('assertState', { selector, value });

  it('reads a native checkbox', async () => {
    const result = await runOnControls([
      stateStep('#native-on', 'checked'),
      stateStep('#native-off', 'unchecked'),
    ]);

    const failures = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failures.map((f) => f.error)).toEqual([]);
  }, 90_000);

  it('reads an Angular Material toggle, which has no input at all', async () => {
    // A div with role=switch and aria-checked. This is the shape DMO uses for a function on
    // a machine node, and the reason this action goes through Playwright's accessors rather
    // than looking for a checked property.
    const result = await runOnControls([stateStep('#mat-toggle-on', 'checked')]);

    expect(result.success).toBe(true);
  }, 90_000);

  it('reads enabled, disabled, editable and readonly', async () => {
    const result = await runOnControls([
      stateStep('#live', 'enabled'),
      stateStep('#dead', 'disabled'),
      stateStep('#typable', 'editable'),
      stateStep('#locked', 'readonly'),
    ]);

    const failures = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failures.map((f) => `${f.type}: ${f.error}`)).toEqual([]);
  }, 90_000);

  it('says the control was off, not that it was missing', async () => {
    const result = await runOnControls([stateStep('#native-off', 'checked')]);

    const failure = (result.steps ?? []).find((s) => s.status === 'failed');
    // The whole point of the action. The old way — a selector with [aria-checked="true"] —
    // could only ever report "not found".
    expect(failure?.error).toContain('was not checked');
    expect(failure?.error).not.toMatch(/not found|no element/i);
  }, 90_000);

  it('waits for a state that arrives late', async () => {
    // #mat-toggle-off flips to checked after 700ms, with no explicit wait in front of it.
    const result = await runOnControls([stateStep('#mat-toggle-off', 'checked')]);

    expect(result.success).toBe(true);
  }, 90_000);

  it('names a state it does not understand instead of calling it false', async () => {
    const result = await runOnControls([stateStep('#native-on', 'ticked')]);

    const failure = (result.steps ?? []).find((s) => s.status === 'failed');
    // A typo must not read as "the control is not in that state", which would send someone
    // looking at the application instead of at their test.
    expect(failure?.error).toContain('Unknown state');
    expect(failure?.error).toContain('checked');
  }, 90_000);

  it('distinguishes "cannot be read" from "is off"', async () => {
    // A heading is not a checkable thing. Reporting that as "unchecked" would hide a step
    // pointed at the wrong element.
    const result = await runOnControls([stateStep('#title', 'checked')]);

    const failure = (result.steps ?? []).find((s) => s.status === 'failed');
    expect(failure?.error).toContain('could not read');
  }, 90_000);
});

/**
 * A precondition that is already satisfied.
 *
 * The case that prompted this: NCC_TC_00085 begins by enabling two functions on a machine,
 * and on the machine it was to run against both were already enabled. Written with `click`
 * — the only thing the builder could express — the setup step is a toggle, so it turned the
 * first function back OFF, and the test then failed on a tab that legitimately was not
 * there. The failure named the tab, which is three screens away from the mistake.
 *
 * The fix is not a smarter click. It is being able to say what state the test needs, and
 * letting the runner decide whether anything has to happen.
 */
describe('a precondition that is already satisfied', () => {
  const runOnSetup = async (sequence: MappedTestStep[]) => {
    const { playwrightService } = await import('./playwright-service');
    return playwrightService.executeTestSequence(savedTest(sequence, '/setup'), 1);
  };

  const ensure = (selector: string, value: string) => step('ensureState', { selector, value });

  /** The sequence's own steps: result.steps opens with the navigation to the page. */
  const details = (result: { steps?: Array<{ type?: string; details?: string }> }) =>
    (result.steps ?? []).filter((s) => s.type === 'ensureState').map((s) => s.details);

  it('leaves a control that is already in the wanted state alone', async () => {
    const result = await runOnSetup([
      ensure('#fn-already-on', 'checked'),
      // If the step above had toggled, this assertion is what notices.
      step('assertState', { selector: '#fn-already-on', value: 'checked' }),
    ]);

    expect(result.success).toBe(true);
    expect(details(result)[0]).toContain('Already checked');
  }, 90_000);

  it('is what `click` cannot be: clicking the same control turns it off', async () => {
    // The defect, reproduced. Without this the test above proves nothing — a control that
    // ignored clicks would pass it just as well.
    const result = await runOnSetup([
      step('click', { selector: '#fn-already-on' }),
      step('assertState', { selector: '#fn-already-on', value: 'checked' }),
    ]);

    expect(result.success).toBe(false);
    const failure = (result.steps ?? []).find((s) => s.status === 'failed');
    expect(failure?.error).toContain('not checked');
  }, 90_000);

  it('changes a control that is in the wrong state, and says so', async () => {
    const result = await runOnSetup([
      ensure('#fn-off', 'checked'),
      step('assertState', { selector: '#fn-off', value: 'checked' }),
    ]);

    expect(result.success).toBe(true);
    expect(details(result)[0]).toContain('Set to checked');
  }, 90_000);

  it('reaches the same state whether the setup had been done or not', async () => {
    // The whole point, in one sequence: the two functions the test needs, one already on and
    // one off, then the same two steps again. A toggle would have undone itself; this ends
    // with the tab visible either way.
    const result = await runOnSetup([
      ensure('#fn-already-on', 'checked'),
      ensure('#fn-off', 'checked'),
      ensure('#fn-already-on', 'checked'),
      ensure('#fn-off', 'checked'),
      step('assert', { selector: '#tab' }),
    ]);

    expect(result.success).toBe(true);
    expect(details(result)).toEqual([
      expect.stringContaining('Already checked'),
      expect.stringContaining('Set to checked'),
      expect.stringContaining('Already checked'),
      expect.stringContaining('Already checked'),
    ]);
  }, 90_000);

  it('works on a native checkbox too, in both directions', async () => {
    const result = await runOnSetup([
      ensure('#box-on', 'unchecked'),
      ensure('#box-off', 'checked'),
      step('assertState', { selector: '#box-on', value: 'unchecked' }),
      step('assertState', { selector: '#box-off', value: 'checked' }),
    ]);

    expect(result.success).toBe(true);
  }, 90_000);

  it('refuses a state the application decides, naming it', async () => {
    // "enabled" is not something a test sets — it follows from permissions and from the
    // record. Clicking and hoping would report whatever happened next as the outcome.
    const result = await runOnSetup([ensure('#fn-off', 'enabled')]);

    const failure = (result.steps ?? []).find((s) => s.status === 'failed');
    expect(failure?.error).toContain('assertState');
    expect(failure?.error).toContain('checked, unchecked');
  }, 90_000);

  it('says it cannot read the control rather than clicking a guess', async () => {
    const result = await runOnSetup([ensure('#label', 'checked')]);

    const failure = (result.steps ?? []).find((s) => s.status === 'failed');
    expect(failure?.error).toContain('Could not read the checked state');
    // And it must not have clicked anything in the meantime.
    expect(failure?.error).not.toContain('after being clicked');
  }, 90_000);
});
