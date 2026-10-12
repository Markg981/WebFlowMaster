/**
 * Films the product for the promo video, once per language and with the product's own localized
 * UI: still screens (video/public/shots/<lang>/<name>.png) and live clips of the product in use
 * (video/public/clips/<lang>/<name>.mp4, with <name>.json marking when things happen in it).
 *
 *   NODE_EXTRA_CA_CERTS=collaudo/collaudo-root.crt node marketing/promo-video/demo/capture.mjs
 *   LANGS=it SHOTS=recorder,run node marketing/promo-video/demo/capture.mjs     # a few
 *
 * Needs the Northwind Commerce demo (README.md, steps 1-4) on the collaudo stack. The recorder
 * clip needs its virtual screen (the `display` service, noVNC on localhost:6080); the mobile
 * clip needs the collaudo Android emulator (`npm run collaudo:mobile`) with the "Lab" local
 * Appium grid of organization Acme (collaudo/README.md, area MOB). Each shot is taken on its
 * own: one that cannot be taken is reported, and the others are still saved.
 */
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ffmpeg } from '../ffmpeg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WFM_URL ?? 'https://wfm.collaudo.test';
const VNC = process.env.WFM_DISPLAY_URL ?? 'http://localhost:6080';
const DEMO = {
  username: process.env.DEMO_USER ?? 'maya',
  password: process.env.DEMO_PASSWORD ?? 'Demo.Video.2026!',
};
// The collaudo organization that has the emulator's grid; only its device screen is shown.
const MOBILE = { username: 'owner.a', password: 'Collaudo.2026!' };
const LANGS = process.env.LANGS?.split(',') ?? ['en', 'it'];
const ONLY = process.env.SHOTS?.split(',');
const PUBLIC = path.join(HERE, '..', 'video', 'public');
const SHOP = 'http://shop.northwind.test/login/';

const DESCRIPTION = {
  en: [
    `Go to ${SHOP}`,
    'Type maya.chen in the Username field',
    'Type Coffee-2026 in the Password field',
    'Click Sign in',
    'Check that "Welcome back, Maya!" is visible',
  ],
  it: [
    `Vai su ${SHOP}`,
    'Scrivi maya.chen nel campo Username',
    'Scrivi Coffee-2026 nel campo Password',
    'Clicca Sign in',
    'Verifica che "Welcome back, Maya!" sia visibile',
  ],
};

// The same feature the brochure shows (marketing/brochure/capture.mjs): imported once per language.
const FEATURE = {
  en: {
    name: 'Card checkout',
    content: `Feature: Checkout
  Customers pay for the items in their cart.

  Scenario: A signed-in customer pays by card
    Given Maya is signed in to the Northwind shop
    And her cart holds 2 bags of "Ethiopia Guji"
    When she pays with a valid card
    Then she sees the order confirmation
    And the order total is "€ 31.80"
`,
  },
  it: {
    name: 'Pagamento con carta',
    content: `# language: it
Funzionalità: Pagamento
  I clienti pagano gli articoli nel carrello.

  Scenario: Una cliente autenticata paga con la carta
    Dato che Maya ha effettuato l'accesso al negozio Northwind
    E il suo carrello contiene 2 confezioni di "Ethiopia Guji"
    Quando paga con una carta valida
    Allora vede la conferma dell'ordine
    E il totale dell'ordine è "€ 31,80"
`,
  },
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
  const file = path.join(
    HERE,
    '..',
    '..',
    '..',
    'client',
    'src',
    'locales',
    lang,
    'translation.json',
  );
  const json = JSON.parse(await readFile(file, 'utf8'));
  return (key, values = {}) => {
    const value = key.split('.').reduce((node, part) => node?.[part], json);
    if (typeof value !== 'string') throw new Error(`No ${lang} label for ${key}`);
    return value.replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '');
  };
}

const exact = (text) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');

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
  await page.waitForTimeout(1000);
}

/**
 * A browser signed in as `user`, in `lang`. The UI language is the user's stored preference:
 * set for the capture, and put back when the page is closed.
 */
async function signIn(browser, lang, user, { scale = 2 } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    // 2x for stills: the video zooms into them, and they must stay sharp when it does.
    deviceScaleFactor: scale,
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
  const { language } = await api(page, 'GET', '/api/settings');
  await api(page, 'POST', '/api/settings', { language: lang });
  page.restore = () => api(page, 'POST', '/api/settings', { language: language ?? 'en' });
  await page.reload();
  return page;
}

async function close(page) {
  await page.restore?.().catch(() => {});
  await page.context().close();
}

/**
 * Films pages while `act` runs, from Chromium's screencast: a JPEG each time the page changes,
 * with its time. The frames become a 30 fps H.264 clip per page; `mark(label)` notes the second
 * something happens, saved beside the clip so the video can start it at the right moment.
 */
async function screencast(pages, act) {
  const sessions = await Promise.all(
    Object.values(pages).map(async ({ page, file, canvas }) => {
      const frames = [];
      if (canvas) {
        // noVNC draws on a canvas the screencast only sees a few times a second: read the
        // canvas itself instead, 20 times a second.
        await page.evaluate((selector) => {
          window.__frames = [];
          window.__filming = setInterval(() => {
            const c = document.querySelector(selector);
            if (c) window.__frames.push([Date.now() / 1000, c.toDataURL('image/jpeg', 0.92)]);
          }, 50);
        }, canvas);
        return { canvas, page, frames, file };
      }
      const cdp = await page.context().newCDPSession(page);
      cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        frames.push({ at: metadata.timestamp, jpeg: Buffer.from(data, 'base64') });
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      const { width, height } = page.viewportSize();
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 92,
        maxWidth: width,
        maxHeight: height,
        everyNthFrame: 1,
      });
      return { cdp, frames, file };
    }),
  );
  const start = Date.now() / 1000;
  const marks = {};
  await act((label) => {
    marks[label] = Math.round((Date.now() / 1000 - start) * 100) / 100;
  });
  const end = Date.now() / 1000;
  for (const { cdp, canvas, page, frames, file } of sessions) {
    if (canvas) {
      const taken = await page.evaluate(() => {
        clearInterval(window.__filming);
        return window.__frames;
      });
      for (const [at, url] of taken) {
        frames.push({ at, jpeg: Buffer.from(url.slice(url.indexOf(',') + 1), 'base64') });
      }
    } else await cdp.send('Page.stopScreencast').catch(() => {});
    if (!frames.length) throw new Error(`No frames for ${file}`);
    const dir = await mkdtemp(path.join(tmpdir(), 'wfm-clip-'));
    let list = 'ffconcat version 1.0\n';
    for (let i = 0; i < frames.length; i++) {
      const from = i === 0 ? start : frames[i].at;
      const to = i + 1 < frames.length ? frames[i + 1].at : end;
      await writeFile(path.join(dir, `${i}.jpg`), frames[i].jpeg);
      list += `file '${i}.jpg'\nduration ${Math.max(0.001, to - from).toFixed(4)}\n`;
    }
    // The concat demuxer drops the last duration: the last frame is listed once more.
    list += `file '${frames.length - 1}.jpg'\n`;
    await writeFile(path.join(dir, 'list.txt'), list);
    await mkdir(path.dirname(file), { recursive: true });
    // prettier-ignore
    ffmpeg([
      '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
      '-r', '30', '-fps_mode', 'cfr',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-movflags', '+faststart',
      file,
    ]);
    await writeFile(
      file.replace(/\.mp4$/, '.json'),
      `${JSON.stringify({ seconds: Math.round((end - start) * 100) / 100, marks }, null, 2)}\n`,
    );
    await rm(dir, { recursive: true, force: true });
    console.log(
      `  ✓ ${path.relative(PUBLIC, file)} (${frames.length} frames, ${(end - start).toFixed(1)}s)`,
    );
  }
}

async function film(browser, lang) {
  const t = await labels(lang);
  const shots = path.join(PUBLIC, 'shots', lang);
  const clips = path.join(PUBLIC, 'clips', lang);
  await mkdir(shots, { recursive: true });
  const save = async (target, name) => {
    await target.screenshot({ path: path.join(shots, `${name}.png`) });
    console.log(`  ✓ shots/${lang}/${name}.png`);
  };

  const page = await signIn(browser, lang, DEMO);
  const plans = await api(page, 'GET', '/api/test-plans');
  const planId = (name) => plans.find((p) => p.name === name)?.id;

  const openBuilder = async (target) => {
    await target.goto(`${BASE}/dashboard/create-test`);
    await settle(target);
    await target
      .getByPlaceholder(/https?:\/\//i)
      .first()
      .fill(SHOP);
  };

  const SHOTS = {
    async dashboard() {
      await page.goto(`${BASE}/dashboard`);
      await settle(page);
      await page.waitForTimeout(1500);
      await save(page, 'dashboard');
    },
    async builder() {
      await openBuilder(page);
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
      await page
        .getByRole('button', { name: exact(t('testSequenceBuilder.describe.button')) })
        .click();
      await page.getByRole('dialog').locator('textarea').fill(DESCRIPTION[lang].join('\n'));
      await save(page, 'builder-describe');
      await page.getByRole('button', { name: exact(t('authorSteps.read')) }).click();
      // The steps come from the description (the collaudo's simulated AI provider).
      const insert = page.getByRole('dialog').getByRole('button').filter({ hasText: /\d/ }).last();
      await insert.waitFor({ timeout: 30000 });
      await save(page, 'builder-proposed');
      await insert.click();
      await page.waitForTimeout(1000);
      const execute = page.getByRole('button', {
        name: exact(t('testSequenceBuilder.executeTest.button')),
      });
      await execute.click();
      // Done when the button is back, then the preview plays the steps back: let it finish.
      await page.waitForTimeout(2500);
      await execute.waitFor({ state: 'visible', timeout: 120000 });
      await page.waitForTimeout(10000);
      await page.evaluate(() => window.scrollTo(0, 0));
      await save(page, 'builder-passed');
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
    async report() {
      const runs = await api(page, 'GET', '/api/test-plan-executions?limit=100');
      const latest = (Array.isArray(runs) ? runs : (runs.items ?? [])).find(
        (run) => run.testPlanId === planId('Catalog checks'),
      );
      await page.goto(
        `${BASE}/test-plans/${planId('Catalog checks')}/executions/${latest.id}/report`,
      );
      await settle(page);
      await page.waitForTimeout(1500);
      // The evidence of the failed test: video, trace, network, and the step that failed.
      // The row of the failed tests table: the configuration matrix above it names the test too.
      const row = page
        .locator('tr', { hasText: 'Promo banner shows the discount' })
        .filter({ has: page.locator('button') })
        .first();
      await row.scrollIntoViewIfNeeded();
      await row.locator('td').last().locator('button, a').nth(2).click();
      await page.waitForTimeout(2500);
      await save(page, 'report-log');
      await page.keyboard.press('Escape');
    },
    async bdd() {
      const { name, content } = FEATURE[lang];
      const catalog = await api(
        page,
        'GET',
        `/api/catalog/tests?pageSize=50&search=${encodeURIComponent(name)}`,
      );
      if (!catalog.items?.some((item) => item.name.includes(name.split(' ')[0]))) {
        await api(page, 'POST', '/api/tests/import-bundle', {
          content,
          format: 'gherkin',
          bdd: { mode: 'manual' },
        });
      }
      await page.goto(`${BASE}/tests`);
      await settle(page);
      await page
        .getByRole('searchbox')
        .or(page.getByPlaceholder(/./))
        .first()
        .fill(name.split(' ').pop());
      await page.waitForTimeout(1500);
      await page
        .getByRole('button', { name: exact(t('bdd.edit')) })
        .first()
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByRole('heading').first().click();
      await page.waitForTimeout(1500);
      await save(page, 'bdd');
      await page.keyboard.press('Escape');
    },
  };

  // Live clips are filmed at 1x: a screencast frame at 2x is four times the data, for a clip
  // the video shows at about half its width anyway.
  const CLIPS = {
    async recorder() {
      const builder = await signIn(browser, lang, DEMO, { scale: 1 });
      try {
        await openBuilder(builder);
        await builder.getByRole('combobox').first().click();
        await builder
          .getByRole('option', { name: t('dashboardPageNew.registraAzioniUtenteAutorecord.text') })
          .click();
        // The recording window opens on the server's screen, seen here through noVNC at 1:1.
        const screen = await builder.context().newPage();
        await screen.setViewportSize({ width: 1440, height: 900 });
        await screen.goto(`${VNC}/vnc.html?autoconnect=true&resize=scale`);
        await screen.addStyleTag({ content: '#noVNC_control_bar_anchor{display:none!important}' });
        await builder
          .getByRole('button', { name: exact(t('dashboardPageNew.iniziaRegistrazione.button')) })
          .click();
        await screen.waitForTimeout(8000);
        await builder
          .getByText(t('dashboardPageNew.registrazioneInCorso.text'))
          .scrollIntoViewIfNeeded();
        await screencast(
          {
            site: { page: screen, file: path.join(clips, 'recorder-site.mp4'), canvas: 'canvas' },
            steps: { page: builder, file: path.join(clips, 'recorder-steps.mp4') },
          },
          async (mark) => {
            await screen.waitForTimeout(800);
            // The shop's login form in the maximized window (Xvfb 1440x900).
            mark('username');
            await screen.mouse.click(493, 395);
            await screen.keyboard.type('maya.chen', { delay: 110 });
            await screen.waitForTimeout(500);
            mark('password');
            await screen.mouse.click(493, 480);
            await screen.keyboard.type('Coffee-2026', { delay: 110 });
            await screen.waitForTimeout(500);
            mark('signIn');
            await screen.mouse.click(328, 547);
            // The builder polls every two seconds: wait for the actions to show.
            await builder.waitForTimeout(4500);
            mark('captured');
            await builder.waitForTimeout(1500);
          },
        );
        await builder
          .getByRole('button', { name: exact(t('dashboardPageNew.terminaRegistrazione.button')) })
          .click();
        await builder.waitForTimeout(3000);
      } finally {
        await close(builder);
      }
    },
    async run() {
      const runner = await signIn(browser, lang, DEMO, { scale: 1 });
      try {
        await runner.goto(`${BASE}/test-plan/${planId('Nightly regression')}/run`);
        await settle(runner);
        await screencast(
          { run: { page: runner, file: path.join(clips, 'run.mp4') } },
          async (mark) => {
            await runner.waitForTimeout(800);
            mark('start');
            await runner
              .getByRole('button', {
                name: exact(t('testPlanExecutionPage.startExecution.button')),
              })
              .click();
            await runner.waitForTimeout(30000);
          },
        );
      } finally {
        await close(runner);
      }
    },
    async mobile() {
      const phone = await signIn(browser, lang, MOBILE, { scale: 1 });
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
            name: exact(t('mobileTests.editFor', { name: MOBILE_TEST.name })),
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
        // Android warns that the sample app is old: its OK, tapped on the device, clears it.
        await phone.getByRole('button', { name: exact(t('mobileInspector.tapMode')) }).click();
        await at(0.81, 0.63);
        await phone.waitForTimeout(3000);
        await phone.getByRole('button', { name: t('mobileInspector.refresh') }).click();
        await phone.waitForTimeout(4000);
        await screencast(
          { mobile: { page: phone, file: path.join(clips, 'mobile.mp4') } },
          async (mark) => {
            await phone.waitForTimeout(800);
            // Into the search screen, tapped on the device, then the search field picked.
            mark('tap');
            await at(0.5, 0.16);
            await phone.waitForTimeout(3000);
            await phone.getByRole('button', { name: t('mobileInspector.refresh') }).click();
            await phone.waitForTimeout(4000);
            await phone.getByRole('button', { name: exact(t('mobileInspector.select')) }).click();
            mark('select');
            await at(0.5, 0.075);
            await phone.waitForTimeout(3000);
          },
        );
      } finally {
        await close(phone);
      }
    },
  };

  for (const [name, take] of [...Object.entries(SHOTS), ...Object.entries(CLIPS)]) {
    if (ONLY && !ONLY.includes(name)) continue;
    console.log(`${lang} ${name}`);
    try {
      await take();
    } catch (error) {
      console.log(`  ✗ ${name}: ${error.message.split('\n')[0]}`);
      await page.screenshot({ path: path.join(shots, `_failed-${name}.png`) }).catch(() => {});
    }
  }
  await close(page);
}

const browser = await chromium.launch();
for (const lang of LANGS) await film(browser, lang);
await browser.close();
