/**
 * Films the product for the promo video: real screens of the Northwind Commerce organization,
 * saved as PNGs the Remotion project animates (video/public/shots).
 *
 *   NODE_EXTRA_CA_CERTS=collaudo/collaudo-root.crt node marketing/promo-video/demo/capture.mjs
 *
 * Needs seed-org.mjs and build-data.mjs first. Each shot is taken on its own, so one that cannot
 * be taken (a label changed, a page slower than usual) is reported and the others are still saved.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.WFM_URL ?? 'https://wfm.collaudo.test';
const USERNAME = process.env.DEMO_USER ?? 'maya';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo.Video.2026!';
const ONLY = process.env.SHOTS?.split(',');
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'video', 'public', 'shots');

const DESCRIPTION = [
  'Go to http://shop.northwind.test/login/',
  'Type maya.chen in the Username field',
  'Type Coffee-2026 in the Password field',
  'Click Sign in',
  'Check that "Welcome back, Maya!" is visible',
].join('\n');

async function apiJson(page, method, url, body) {
  return page.evaluate(async ([m, u, b]) => {
    const res = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return res.json();
  }, [method, url, body]);
}

const browser = await chromium.launch();
// 2x: the video zooms into the screens, and they must stay sharp when it does.
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true, locale: 'en-US', colorScheme: 'light' });
const page = await context.newPage();
await mkdir(OUT, { recursive: true });

const shot = async (name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}.png`);
};
const settle = async () => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);
};

await page.goto(`${BASE}/auth`);
await page.evaluate(() => { try { localStorage.setItem('i18nextLng', 'en'); localStorage.setItem('theme', 'light'); } catch {} });
// Signed in from the page itself: same origin, so the session cookie lands in this browser.
const login = await apiJson(page, 'POST', '/api/login', { username: USERNAME, password: PASSWORD });
if (!login?.username) throw new Error(`Sign-in failed: ${JSON.stringify(login)}`);
console.log(`Signed in as ${USERNAME}`);

const plans = await apiJson(page, 'GET', '/api/test-plans');
const planId = (name) => plans.find((p) => p.name === name)?.id;
const apiTests = await apiJson(page, 'GET', '/api/api-tests');

const SHOTS = {
  async dashboard() {
    await page.goto(`${BASE}/dashboard`); await settle(); await page.waitForTimeout(1500);
    await shot('dashboard');
  },
  async library() {
    await page.goto(`${BASE}/tests`); await settle();
    await shot('library');
  },
  async builder() {
    await page.goto(`${BASE}/dashboard/create-test`); await settle();
    await page.getByPlaceholder(/https?:\/\//i).first().fill('http://shop.northwind.test/login/');
    await page.getByRole('button', { name: /load website/i }).click();
    await page.getByRole('button', { name: /detect elements/i }).waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(4000);
    await shot('builder-loaded');
    await page.getByRole('button', { name: /detect elements/i }).click();
    await page.waitForTimeout(6000);
    await shot('builder-detected');
    await page.getByRole('button', { name: /^describe$/i }).click();
    await page.getByRole('dialog').locator('textarea').fill(DESCRIPTION);
    await shot('builder-describe');
    await page.getByRole('button', { name: /read the description/i }).click();
    await page.getByRole('button', { name: /insert \d+ steps?/i }).waitFor({ timeout: 30000 });
    await shot('builder-proposed');
    await page.getByRole('button', { name: /insert \d+ steps?/i }).click();
    await page.waitForTimeout(1000);
    await shot('builder-sequence');
    await page.getByRole('button', { name: /execute test/i }).click();
    await page.waitForTimeout(2500);
    await shot('builder-running');
    // Done when the button is back, then the preview plays the steps back: let it finish.
    await page.getByRole('button', { name: /execute test/i }).waitFor({ state: 'visible', timeout: 120000 });
    await page.waitForTimeout(10000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('builder-passed');
  },
  async api() {
    const create = apiTests.find((t) => t.name === 'Orders API: create an order');
    await page.goto(`${BASE}/dashboard/api-tester?testId=${create.id}`); await settle();
    await page.getByRole('button', { name: /^send$/i }).first().click();
    await page.waitForTimeout(5000);
    await shot('api');
  },
  async plans() {
    await page.goto(`${BASE}/test-suites`); await settle();
    await shot('plans');
  },
  async run() {
    // The run page starts the plan itself and streams it: a few frames of it in progress.
    await page.goto(`${BASE}/test-plan/${planId('Nightly regression')}/run`); await settle();
    await page.getByRole('button', { name: /start execution/i }).click();
    for (let i = 1; i <= 4; i++) {
      await page.waitForTimeout(i === 1 ? 4000 : 9000);
      await shot(`run-${i}`);
    }
    await page.getByText(/completed|failed/i).first().waitFor({ timeout: 240000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await shot('run-done');
  },
  async report() {
    const runs = await apiJson(page, 'GET', '/api/test-plan-executions?limit=100');
    const list = (Array.isArray(runs) ? runs : runs.items ?? []).filter((r) => r.testPlanId === planId('Catalog checks'));
    const latest = list[0];
    await page.goto(`${BASE}/test-plans/${planId('Catalog checks')}/executions/${latest.id}/report`); await settle();
    await page.waitForTimeout(1500);
    await shot('report');
    await page.getByText('Failed Tests').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await shot('report-failure');
    // The evidence of the first failed row: its screenshot, then its step log.
    const row = page.locator('tr', { hasText: 'Promo banner shows the discount' }).first();
    const actions = row.locator('td').last().locator('button, a');
    await actions.nth(0).click();
    await page.waitForTimeout(2500);
    await shot('report-screenshot');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await actions.nth(2).click();
    await page.waitForTimeout(2500);
    await shot('report-log');
    await page.keyboard.press('Escape');
  },
  async reports() {
    await page.goto(`${BASE}/reports`); await settle();
    await shot('reports');
  },
  async scheduling() {
    await page.goto(`${BASE}/scheduling`); await settle();
    await shot('scheduling');
  },
  async settings() {
    await page.goto(`${BASE}/settings`); await settle();
    await shot('settings');
  },
};

for (const [name, take] of Object.entries(SHOTS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  console.log(name);
  try {
    await take();
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message.split('\n')[0]}`);
    await page.screenshot({ path: path.join(OUT, `_failed-${name}.png`) }).catch(() => {});
  }
}

await browser.close();
