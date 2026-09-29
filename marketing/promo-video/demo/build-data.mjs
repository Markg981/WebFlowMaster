/**
 * Fills the Northwind Commerce organization (seed-org.mjs) through the product's own API, so
 * every test, plan and run the promo video shows is real.
 *
 *   NODE_EXTRA_CA_CERTS=collaudo/collaudo-root.crt node marketing/promo-video/demo/build-data.mjs
 *
 * It creates web and API tests against the public practice sites the collaudo protocol already
 * uses, three plans and a schedule, then runs the plans a few times and waits for them, so the
 * dashboard has a trend, the reports have results and one run has a failure worth opening.
 * Running it again adds nothing already there (matched by name) and adds more runs.
 */
const BASE = process.env.WFM_URL ?? 'https://wfm.collaudo.test';
const USERNAME = process.env.DEMO_USER ?? 'maya';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo.Video.2026!';
const RUNS_PER_PLAN = Number(process.env.RUNS_PER_PLAN ?? 3);

let cookie = '';

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

const action = (id, name, type = id) => ({ id, name, type, icon: 'circle', description: name });
const el = (selector, tag = 'div', text = '') => ({ id: selector, tag, text, type: tag, selector, attributes: {} });
const step = (id, act, value = '', target) => ({ id, value, action: act, ...(target ? { targetElement: target } : {}) });

const NAVIGATE = action('navigate', 'Navigate');
const INPUT = action('input', 'Input Text');
const CLICK = action('click', 'Click Element');
const WAIT = action('waitForElement', 'Wait for Element');
const ASSERT_TEXT = action('assertTextContains', 'Assert Text Contains');
// A native <select>: 'select'. ('selectByText' is for dropdowns built from other elements.)
const SELECT = action('select', 'Select Option');

const SITE = 'https://the-internet.herokuapp.com';

const WEB_TESTS = [
  {
    name: 'Sign in with valid credentials',
    url: `${SITE}/login`,
    module: 'Account', priority: 'Critical',
    sequence: [
      step('nav', NAVIGATE, `${SITE}/login`),
      step('user', INPUT, 'tomsmith', el('#username', 'input')),
      step('pass', INPUT, 'SuperSecretPassword!', el('#password', 'input')),
      step('submit', CLICK, '', el("button[type='submit']", 'button', 'Login')),
      step('check', ASSERT_TEXT, 'You logged into a secure area!', el('#flash')),
    ],
  },
  {
    name: 'Sign in rejects a wrong password',
    url: `${SITE}/login`,
    module: 'Account', priority: 'High',
    sequence: [
      step('nav', NAVIGATE, `${SITE}/login`),
      step('user', INPUT, 'tomsmith', el('#username', 'input')),
      step('pass', INPUT, 'not-the-password', el('#password', 'input')),
      step('submit', CLICK, '', el("button[type='submit']", 'button', 'Login')),
      step('check', ASSERT_TEXT, 'Your password is invalid!', el('#flash')),
    ],
  },
  {
    name: 'Order confirmation loads',
    url: `${SITE}/dynamic_loading/1`,
    module: 'Checkout', priority: 'Critical',
    sequence: [
      step('nav', NAVIGATE, `${SITE}/dynamic_loading/1`),
      step('start', CLICK, '', el('#start button', 'button', 'Start')),
      step('wait', WAIT, 'visible', el('#finish')),
      step('check', ASSERT_TEXT, 'Hello World!', el('#finish')),
    ],
  },
  {
    name: 'Shipping option can be chosen',
    url: `${SITE}/dropdown`,
    module: 'Checkout', priority: 'Medium',
    sequence: [
      step('nav', NAVIGATE, `${SITE}/dropdown`),
      step('choose', SELECT, 'Option 2', el('#dropdown', 'select')),
      step('check', ASSERT_TEXT, 'Option 2', el('#dropdown option:checked', 'option')),
    ],
  },
  {
    // Fails on purpose: the video opens its report to show a failure explained.
    name: 'Promo banner shows the discount',
    url: `${SITE}/dynamic_content`,
    module: 'Catalog', priority: 'Medium',
    sequence: [
      step('nav', NAVIGATE, `${SITE}/dynamic_content`),
      step('check', ASSERT_TEXT, '20% off everything', el('#content .large-10')),
    ],
  },
];

const uuid = () => crypto.randomUUID();

const API_TESTS = [
  {
    name: 'Orders API: create an order',
    method: 'POST', url: 'https://jsonplaceholder.typicode.com/posts',
    requestHeaders: { 'Content-Type': 'application/json' },
    requestBody: JSON.stringify({ title: 'Order #1042', body: '2 × Espresso beans', userId: 7 }),
    bodyType: 'raw',
    assertions: [
      { id: uuid(), source: 'status_code', enabled: true, comparison: 'equals', targetValue: '201' },
      { id: uuid(), source: 'body_json_path', enabled: true, property: 'title', comparison: 'equals', targetValue: 'Order #1042' },
    ],
    extractions: [{ id: uuid(), name: 'orderId', source: 'body_json_path', property: 'id' }],
  },
  {
    name: 'Orders API: read it back',
    method: 'GET', url: 'https://httpbin.org/anything/orders/{{orderId}}',
    requestHeaders: {}, requestBody: '', bodyType: 'raw',
    assertions: [
      { id: uuid(), source: 'status_code', enabled: true, comparison: 'equals', targetValue: '200' },
      { id: uuid(), source: 'body_json_path', enabled: true, property: 'url', comparison: 'contains', targetValue: '101' },
    ],
    extractions: [],
  },
  {
    name: 'Storefront health check',
    method: 'GET', url: 'https://httpbin.org/get',
    requestHeaders: {}, requestBody: '', bodyType: 'raw',
    assertions: [
      { id: uuid(), source: 'status_code', enabled: true, comparison: 'equals', targetValue: '200' },
      { id: uuid(), source: 'response_time', enabled: true, comparison: 'less_than', targetValue: '3000' },
    ],
    extractions: [],
  },
];

const machine = (browserName) => ({ os: 'linux', osVersion: 'Ubuntu 22.04', browserName, browserVersion: 'latest', headless: true });

async function main() {
  await api('POST', '/api/login', { username: USERNAME, password: PASSWORD });
  console.log(`Signed in as ${USERNAME}`);

  const existingTests = await api('GET', '/api/tests');
  const webIds = {};
  for (const test of WEB_TESTS) {
    const found = existingTests.find((t) => t.name === test.name);
    const body = { ...test, elements: [], status: 'saved' };
    // An existing test is brought up to date, so a fix here reaches the next runs.
    webIds[test.name] = found ? (await api('PUT', `/api/tests/${found.id}`, body), found.id) : (await api('POST', '/api/tests', body)).id;
  }
  const existingApi = await api('GET', '/api/api-tests');
  const apiIds = {};
  for (const test of API_TESTS) {
    const found = existingApi.find((t) => t.name === test.name);
    apiIds[test.name] = found?.id ?? (await api('POST', '/api/api-tests', { ...test, queryParams: {}, authType: 'none' })).id;
  }
  console.log(`Tests: ${Object.keys(webIds).length} web, ${Object.keys(apiIds).length} API`);

  const ui = (names) => names.map((n) => ({ id: webIds[n], type: 'ui' }));
  const apiSel = (names) => names.map((n) => ({ id: apiIds[n], type: 'api' }));
  const common = { captureScreenshots: 'on_failed_steps', captureVideo: 'on_failure', captureTrace: 'on_failure', captureNetwork: 'always', reRunOnFailure: 'none' };
  const PLANS = [
    {
      name: 'Nightly regression',
      description: 'Every storefront journey on Chromium, Firefox and WebKit.',
      testMachinesConfig: [machine('chromium'), machine('firefox'), machine('webkit')],
      maxParallelTests: 4, ...common,
      selectedTests: ui(WEB_TESTS.map((t) => t.name)),
    },
    {
      name: 'Checkout smoke',
      description: 'The paths that take money, before every release.',
      testMachinesConfig: [machine('chromium')],
      maxParallelTests: 2, ...common,
      selectedTests: ui(['Sign in with valid credentials', 'Order confirmation loads', 'Shipping option can be chosen']),
    },
    {
      name: 'Orders API contract',
      description: 'Create, read back and health-check the orders service.',
      testMachinesConfig: [machine('chromium')],
      maxParallelTests: 1, ...common,
      selectedTests: apiSel(API_TESTS.map((t) => t.name)),
    },
  ];

  const existingPlans = await api('GET', '/api/test-plans');
  const planIds = {};
  for (const plan of PLANS) {
    const found = existingPlans.find((p) => p.name === plan.name);
    planIds[plan.name] = found?.id ?? (await api('POST', '/api/test-plans', plan)).id;
  }
  console.log(`Plans: ${Object.keys(planIds).join(', ')}`);

  const schedules = await api('GET', '/api/test-plan-schedules');
  if (!schedules.some((s) => s.scheduleName === 'Every night at 02:00')) {
    const tomorrow2am = new Date();
    tomorrow2am.setDate(tomorrow2am.getDate() + 1);
    tomorrow2am.setHours(2, 0, 0, 0);
    await api('POST', '/api/test-plan-schedules', {
      testPlanId: planIds['Nightly regression'],
      scheduleName: 'Every night at 02:00',
      frequency: 'cron:0 2 * * *',
      timezone: 'Europe/Rome',
      // Seconds since the epoch, like the scheduling page sends.
      nextRunAt: Math.floor(tomorrow2am.getTime() / 1000),
      browsers: ['chromium', 'firefox', 'webkit'],
      isActive: true,
      retryOnFailure: 'once',
    });
    console.log('Schedule: Every night at 02:00');
  }

  // Runs one after the other, so a small collaudo stack is not flooded.
  for (let round = 1; round <= RUNS_PER_PLAN; round++) {
    for (const [name, id] of Object.entries(planIds)) {
      const started = await api('POST', `/api/run-test-plan/${id}`, {});
      const executionId = started.data?.id ?? started.data?.executionId ?? started.id;
      process.stdout.write(`Run ${round}/${RUNS_PER_PLAN} ${name} (${executionId}) `);
      for (;;) {
        await new Promise((r) => setTimeout(r, 4000));
        const run = await api('GET', `/api/test-plan-executions/${executionId}`);
        if (!['pending', 'queued', 'running'].includes(run.status)) {
          console.log(`→ ${run.status}, ${run.passedTests ?? 0}/${run.totalTests ?? 0} passed`);
          break;
        }
        process.stdout.write('.');
      }
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
