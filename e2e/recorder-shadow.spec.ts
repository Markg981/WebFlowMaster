import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { register, unique } from './helpers';
import { startShadowFixture, type ShadowFixtureServer } from './recorder-shadow-fixture';
import { RECORDER_SCRIPT } from '../server/authoring/recorder-script';
import {
  RecordedActionSchema,
  mapRecordedSequence,
  unsupportedActions,
  type MappedTestStep,
  type RecordedAction,
} from '../shared/recording';

/**
 * Record, save, replay — on web components, in every browser the matrix runs (P12, C11).
 *
 * The recording happens in the project's own browser (Chromium, Firefox or WebKit) with the
 * production script and binding, the way installRecorder wires a recording session; each action
 * is admitted through the same schema pushAction uses. The steps are then saved through the API
 * and replayed by a plan on that same browser. Nothing between the recording and the run touches
 * a selector: the closing criterion is that the fixture replays without correcting a locator.
 */

let fixture: ShadowFixtureServer;

test.beforeAll(async () => {
  fixture = await startShadowFixture();
});

test.afterAll(async () => {
  await fixture?.close();
});

async function record(
  browser: Browser,
  path: string,
  steps: (page: Page) => Promise<void>,
  echoFrame?: string,
): Promise<{ actions: RecordedAction[]; echo: string }> {
  const context = await browser.newContext();
  const actions: RecordedAction[] = [];
  try {
    await context.exposeBinding('__wfmRecordAction', (_source, raw: unknown) => {
      const parsed = RecordedActionSchema.safeParse(raw);
      if (parsed.success) actions.push(parsed.data);
    });
    await context.addInitScript({ content: RECORDER_SCRIPT });
    const page = await context.newPage();
    await page.goto(`${fixture.baseUrl}${path}`);
    await steps(page);
    // The binding is asynchronous: give the last action time to arrive.
    await page.waitForTimeout(500);
    const scope = echoFrame ? page.frameLocator(echoFrame) : page;
    const echo = (await scope.locator('#echo').textContent()) ?? '';
    return { actions, echo };
  } finally {
    await context.close();
  }
}

/** The recorded steps, saved as they are, plus a check that the replay left the same values. */
async function saveRecordedTest(
  page: Page,
  url: string,
  steps: MappedTestStep[],
  echo: string,
  echoFrame: string | null,
) {
  const response = await page.request.post('/api/tests', {
    data: {
      name: unique('recorded_shadow'),
      url,
      elements: [],
      sequence: [
        ...steps,
        {
          id: 'check-echo',
          action: { id: 'assertTextContains', type: 'assertTextContains', name: 'Same values' },
          targetElement: {
            id: 'echo',
            selector: '#echo',
            type: 'text',
            tag: 'p',
            text: '',
            attributes: {},
            frameSelector: echoFrame,
          },
          value: echo,
        },
      ],
    },
  });
  expect(response.status()).toBe(201);
  const saved = await response.json();
  expect((await page.request.post(`/api/tests/${saved.id}/publish`, { data: {} })).ok()).toBe(true);
  return saved as { id: number };
}

test('a recording on web components replays on the browser it was made in', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const browserName = info.project.name;

  const components = await record(browser, '/', async (target) => {
    await target.fill('input[data-key="plain"]', 'light');
    await target.press('input[data-key="plain"]', 'Tab');
    await target.fill('x-login input[name="q"]', 'marco');
    await target.press('x-login input[name="q"]', 'Tab');
    await target.selectOption('x-inner select[name="color"]', 'blue');
    await target.check('x-inner input[name="agree"]');
    await target.click('x-inner button:text-is("Save")');
    await target.click('#add-late');
    await target.fill('x-late input[name="late"]', 'late');
    await target.press('x-late input[name="late"]', 'Tab');
    await target.fill('x-decl input[name="decl"]', 'parsed');
    await target.press('x-decl input[name="decl"]', 'Tab');
    await target.fill('x-login input[name="search"]', 'orders');
    await target.press('x-login input[name="search"]', 'Enter');
  });
  const framed = await record(
    browser,
    '/frames',
    async (target) => {
      const frame = target.frameLocator('iframe[name="inner"]');
      await frame.locator('input[name="city"]').fill('Torino');
      await frame.locator('input[name="city"]').press('Tab');
    },
    'iframe[name="inner"]',
  );

  // Each interaction captured once, on its own field, and nothing left unsupported.
  for (const name of ['plain', 'user', 'late', 'decl', 'search', 'color']) {
    expect(components.echo).toContain(`${name}=`);
  }
  const values = components.actions
    .filter((a) => a.type === 'input' || a.type === 'select')
    .map((a) => a.value);
  expect(values).toEqual(['light', 'marco', 'blue', 'true', 'late', 'parsed', 'orders']);
  expect(unsupportedActions([...components.actions, ...framed.actions])).toEqual([]);
  const frameSelector = framed.actions.find((a) => a.type === 'input')?.frameSelector ?? null;
  expect(frameSelector).toContain('iframe[name="inner"]');

  await register(page);
  const first = await saveRecordedTest(
    page,
    `${fixture.baseUrl}/`,
    mapRecordedSequence(components.actions),
    components.echo,
    null,
  );
  const second = await saveRecordedTest(
    page,
    `${fixture.baseUrl}/frames`,
    mapRecordedSequence(framed.actions),
    framed.echo,
    frameSelector,
  );

  const created = await page.request.post('/api/test-plans', {
    data: {
      name: unique('recorded_shadow_plan'),
      selectedTests: [first, second].map((t) => ({ id: t.id, type: 'ui' })),
      testMachinesConfig: [{ browserName, headless: true }],
      maxParallelTests: 1,
      captureScreenshots: 'never',
    },
  });
  expect(created.status()).toBe(201);
  const plan = await created.json();
  const started = await page.request.post(`/api/run-test-plan/${plan.id}`, { data: {} });
  expect(started.ok()).toBe(true);
  const runId = (await started.json()).data.id;
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/test-plan-executions/${runId}`)).json()).status,
      { timeout: 180_000 },
    )
    .toBe('completed');

  const report = await (await page.request.get(`/api/test-plan-executions/${runId}/report`)).json();
  type Row = { status: string; reasonForFailure?: string | null };
  const rows: Row[] = Object.values(
    report.testGroupings as Record<string, { components: Record<string, { tests: Row[] }> }>,
  ).flatMap((group) => Object.values(group.components).flatMap((c) => c.tests));
  expect(
    rows.map((r) => r.status),
    JSON.stringify(rows.map((r) => r.reasonForFailure)),
  ).toEqual(['Passed', 'Passed']);
});
