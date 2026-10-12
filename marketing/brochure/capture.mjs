/**
 * Films the screens the brochure shows, once per language, with the product's own localized UI:
 * assets/<lang>/<shot>.jpg, the files build.py lays out.
 *
 *   NODE_EXTRA_CA_CERTS=collaudo/collaudo-root.crt node marketing/brochure/capture.mjs
 *   LANGS=it SHOTS=bdd,mobile node marketing/brochure/capture.mjs     # a few
 *
 * Needs the Northwind Commerce demo of the promo video (marketing/promo-video/README.md, steps
 * 1-4) and, for the mobile inspector, the collaudo Android emulator (`npm run collaudo:mobile`)
 * with the "Lab" local Appium grid of organization Acme (collaudo/README.md, area MOB).
 * Each shot is taken on its own: one that cannot be taken is reported, the others are saved.
 */
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WFM_URL ?? 'https://wfm.collaudo.test';
const DEMO = { username: 'maya', password: 'Demo.Video.2026!' };
// The collaudo organization that has the emulator's grid; only its device screen is shown.
const MOBILE = { username: 'owner.a', password: 'Collaudo.2026!' };
const LANGS = process.env.LANGS?.split(',') ?? ['it', 'en'];
const ONLY = process.env.SHOTS?.split(',');

const FEATURE = {
  en: `Feature: Checkout
  Customers pay for the items in their cart.

  Scenario: A signed-in customer pays by card
    Given Maya is signed in to the Northwind shop
    And her cart holds 2 bags of "Ethiopia Guji"
    When she pays with a valid card
    Then she sees the order confirmation
    And the order total is "€ 31.80"
`,
  it: `# language: it
Funzionalità: Pagamento
  I clienti pagano gli articoli nel carrello.

  Scenario: Una cliente autenticata paga con la carta
    Dato che Maya ha effettuato l'accesso al negozio Northwind
    E il suo carrello contiene 2 confezioni di "Ethiopia Guji"
    Quando paga con una carta valida
    Allora vede la conferma dell'ordine
    E il totale dell'ordine è "€ 31,80"
`,
};

const MOBILE_TEST = {
  name: 'Wikipedia search',
  platform: 'android',
  app: '/apps/WikipediaSample.apk',
  deviceName: 'emulator-5554',
  steps: [
    { id: 's1', action: 'tap', target: '~Search Wikipedia' },
    {
      id: 's2',
      action: 'type',
      target: 'id=org.wikipedia.alpha:id/search_src_text',
      value: 'Appium',
    },
    { id: 's3', action: 'assertVisible', target: '//android.widget.TextView' },
  ],
};

async function labels(lang) {
  const file = path.join(HERE, '..', '..', 'client', 'src', 'locales', lang, 'translation.json');
  const json = JSON.parse(await readFile(file, 'utf8'));
  return (key) => {
    const value = key.split('.').reduce((node, part) => node?.[part], json);
    if (typeof value !== 'string') throw new Error(`No ${lang} label for ${key}`);
    return value;
  };
}

const exact = (text) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');

async function signIn(browser, lang, user) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    locale: lang === 'it' ? 'it-IT' : 'en-US',
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/auth`);
  await page.evaluate((lng) => {
    localStorage.setItem('i18nextLng', lng);
    localStorage.setItem('theme', 'light');
  }, lang);
  const login = await api(page, 'POST', '/api/login', user);
  if (!login?.username)
    throw new Error(`Sign-in of ${user.username} failed: ${JSON.stringify(login)}`);
  // The UI language is the user's stored preference: set for the capture, put back on close.
  const { language } = await api(page, 'GET', '/api/settings');
  await api(page, 'POST', '/api/settings', { language: lang });
  page.restore = () => api(page, 'POST', '/api/settings', { language: language ?? 'en' });
  await page.reload();
  return page;
}

async function close(page) {
  await page.restore().catch(() => {});
  await page.context().close();
}

function api(page, method, url, body) {
  return page.evaluate(
    async ([m, u, b]) => {
      const res = await fetch(u, {
        method: m,
        headers: { 'Content-Type': 'application/json' },
        body: b ? JSON.stringify(b) : undefined,
      });
      return res.json().catch(() => ({ status: res.status }));
    },
    [method, url, body],
  );
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
}

async function film(browser, lang) {
  const t = await labels(lang);
  const out = path.join(HERE, 'assets', lang);
  await mkdir(out, { recursive: true });
  const save = async (target, name) => {
    await target.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 86 });
    console.log(`  ✓ ${lang}/${name}.jpg`);
  };

  const page = await signIn(browser, lang, DEMO);
  const plans = await api(page, 'GET', '/api/test-plans');
  const planId = (name) => plans.find((p) => p.name === name)?.id;

  const SHOTS = {
    async dashboard() {
      await page.goto(`${BASE}/dashboard`);
      await settle(page);
      await page.waitForTimeout(1500);
      await save(page, 'dashboard');
    },
    async builder() {
      await page.goto(`${BASE}/dashboard/create-test`);
      await settle(page);
      await page
        .getByPlaceholder(/https?:\/\//i)
        .first()
        .fill('http://shop.northwind.test/login/');
      await page
        .getByRole('button', { name: exact(t('dashboardPageNew.loadWebsite.button')) })
        .click();
      const detect = page.getByRole('button', {
        name: exact(t('dashboardPageNew.detectElements.button')),
      });
      await detect.waitFor({ state: 'visible', timeout: 60000 });
      await page.waitForTimeout(4000);
      await detect.click();
      await page.waitForTimeout(6000);
      // The steps come from the description (the collaudo's simulated AI provider).
      await page
        .getByRole('button', { name: exact(t('testSequenceBuilder.describe.button')) })
        .click();
      await page
        .getByRole('dialog')
        .locator('textarea')
        .fill(
          [
            'Go to http://shop.northwind.test/login/',
            'Type maya.chen in the Username field',
            'Type Coffee-2026 in the Password field',
            'Click Sign in',
            'Check that "Welcome back, Maya!" is visible',
          ].join('\n'),
        );
      await page.getByRole('button', { name: exact(t('authorSteps.read')) }).click();
      const insert = page.getByRole('dialog').getByRole('button').filter({ hasText: /\d/ }).last();
      await insert.waitFor({ timeout: 30000 });
      await insert.click();
      // The "steps added" notice goes away on its own; the sequence under the preview stays.
      await page.waitForTimeout(7000);
      await save(page, 'builder');
    },
    async api() {
      const tests = await api(page, 'GET', '/api/api-tests');
      const create = tests.find((test) => test.name === 'Orders API: create an order');
      await page.goto(`${BASE}/dashboard/api-tester?testId=${create.id}`);
      await settle(page);
      await page
        .getByRole('button', { name: exact(t('apiTesterPage.send.button')) })
        .first()
        .click();
      await page.waitForTimeout(5000);
      await save(page, 'api');
    },
    async failure() {
      const runs = await api(page, 'GET', '/api/test-plan-executions?limit=100');
      const latest = (Array.isArray(runs) ? runs : (runs.items ?? [])).find(
        (run) => run.testPlanId === planId('Catalog checks'),
      );
      await page.goto(
        `${BASE}/test-plans/${planId('Catalog checks')}/executions/${latest.id}/report`,
      );
      await settle(page);
      await page
        .getByText(new RegExp(`^${t('testReportPage.failedTests')} \\(`))
        .first()
        .evaluate((heading) => heading.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => document.querySelector('main')?.scrollBy(0, -90));
      await page.waitForTimeout(800);
      // The failed tests, with the reason and the evidence buttons of each, over the modules.
      await save(page, 'failure');
    },
    async bdd() {
      const name = lang === 'it' ? 'Pagamento con carta' : 'Card checkout';
      const catalog = await api(
        page,
        'GET',
        `/api/catalog/tests?pageSize=50&search=${encodeURIComponent(name)}`,
      );
      let test = catalog.items?.find((item) => item.name.includes(name.split(' ')[0]));
      if (!test) {
        const imported = await api(page, 'POST', '/api/tests/import-bundle', {
          content: FEATURE[lang],
          format: 'gherkin',
          bdd: { mode: 'manual' },
        });
        console.log(`  imported the ${lang} feature: ${JSON.stringify(imported).slice(0, 160)}`);
      }
      await page.goto(`${BASE}/tests`);
      await settle(page);
      const search = page.getByRole('searchbox').or(page.getByPlaceholder(/./)).first();
      await search.fill(lang === 'it' ? 'carta' : 'card');
      await page.waitForTimeout(1500);
      await page
        .getByRole('button', { name: exact(t('bdd.edit')) })
        .first()
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByRole('heading').first().click();
      await page.waitForTimeout(1500);
      await save(dialog, 'bdd');
      await page.keyboard.press('Escape');
    },
  };

  for (const [name, take] of Object.entries(SHOTS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    console.log(`${lang} ${name}`);
    try {
      await take();
    } catch (error) {
      console.log(`  ✗ ${name}: ${error.message.split('\n')[0]}`);
      await page.screenshot({ path: path.join(out, `_failed-${name}.png`) }).catch(() => {});
    }
  }
  await close(page);

  if (ONLY && !ONLY.includes('mobile')) return;
  console.log(`${lang} mobile`);
  const phone = await signIn(browser, lang, MOBILE);
  try {
    const grids = await api(phone, 'GET', '/api/browser-grids');
    const grid = (Array.isArray(grids) ? grids : (grids.items ?? [])).find(
      (g) => g.provider === 'local_appium',
    );
    const tests = await api(phone, 'GET', '/api/mobile-tests');
    const list = Array.isArray(tests) ? tests : (tests.items ?? []);
    if (!list.some((test) => test.name === MOBILE_TEST.name)) {
      const created = await api(phone, 'POST', '/api/mobile-tests', {
        ...MOBILE_TEST,
        gridId: grid?.id,
      });
      if (!created?.id) throw new Error(`Mobile test not created: ${JSON.stringify(created)}`);
    }
    await phone.goto(`${BASE}/mobile-tests`);
    await settle(phone);
    await phone
      .getByRole('button', {
        name: exact(t('mobileTests.editFor').replace('{{name}}', MOBILE_TEST.name)),
      })
      .click();
    await phone.getByRole('button', { name: exact(t('mobileTests.inspect')) }).click();
    // The app starts on the emulator, then the inspector shows its screen and element tree.
    const screen = phone.getByRole('img', { name: t('mobileInspector.screen') });
    await screen.waitFor({ timeout: 180000 });
    await phone.waitForTimeout(2000);
    const at = async (x, y) => {
      const box = await screen.boundingBox();
      await phone.mouse.click(box.x + box.width * x, box.y + box.height * y);
    };
    // Android warns that the sample app is old: its OK, tapped on the device, clears the screen.
    await phone.getByRole('button', { name: exact(t('mobileInspector.tapMode')) }).click();
    await at(0.81, 0.63);
    await phone.waitForTimeout(3000);
    // Into the search screen: the home feed shows the day's news, not for a brochure.
    await at(0.5, 0.16);
    await phone.waitForTimeout(3000);
    await phone.getByRole('button', { name: t('mobileInspector.refresh') }).click();
    await phone.waitForTimeout(4000);
    await phone.getByRole('button', { name: exact(t('mobileInspector.select')) }).click();
    // The search field, picked: its locators show beside the screen.
    await at(0.5, 0.075);
    await phone.waitForTimeout(1500);
    await save(phone.getByRole('dialog').last(), 'mobile');
  } catch (error) {
    console.log(`  ✗ mobile: ${error.message.split('\n')[0]}`);
    await phone.screenshot({ path: path.join(out, '_failed-mobile.png') }).catch(() => {});
  }
  await close(phone);
}

const browser = await chromium.launch();
for (const lang of LANGS) await film(browser, lang);
await browser.close();
