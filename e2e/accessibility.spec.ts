import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { register } from './helpers';

/**
 * The product sells accessibility checks with axe-core; its own interface is held to the same
 * standard here. WCAG 2.1 A and AA rules, and only serious or critical findings fail: those are
 * the ones that stop someone using a page (no name on a button, unreadable contrast, a dialog
 * without a label), where minor ones are matters of polish.
 *
 * axe is injected from the installed axe-core, the same build and the same way as
 * server/web/accessibility.ts.
 */
const axeSource = (createRequire(import.meta.url)('axe-core') as { source: string }).source;

type Violation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[]; html: string; any: { message: string }[] }[];
};

/**
 * Waits for entrance animations to end. Measured mid-fade, text is half transparent and axe
 * reports contrast the page never has at rest. Infinite animations (a pulsing icon) are ignored.
 */
async function settled(page: Page) {
  await page.waitForFunction(
    () => {
      for (const element of document.querySelectorAll<HTMLElement>('[style*="opacity"]')) {
        const opacity = Number(getComputedStyle(element).opacity);
        if (opacity > 0 && opacity < 1) return false;
      }
      return document
        .getAnimations()
        .every(
          (animation) =>
            animation.playState !== 'running' ||
            animation.effect?.getTiming().iterations === Infinity,
        );
    },
    null,
    { timeout: 10_000 },
  );
}

async function seriousViolations(page: Page, rules?: string[]) {
  await settled(page);
  // evaluate, not addScriptTag: the page's Content-Security-Policy refuses inline scripts.
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axeSource);
  const violations = await page.evaluate(async (only) => {
    const axe = (window as unknown as { axe: { run: (...args: unknown[]) => Promise<unknown> } })
      .axe;
    const result = (await axe.run(document, {
      runOnly: only
        ? { type: 'rule', values: only }
        : { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      resultTypes: ['violations'],
    })) as { violations: Violation[] };
    // axe shortens the HTML it reports to the first class name; the element's own start says
    // more about where it comes from.
    for (const violation of result.violations)
      for (const node of violation.nodes) {
        const selector = node.target[0];
        const element = typeof selector === 'string' ? document.querySelector(selector) : null;
        if (element) node.html = element.outerHTML.slice(0, 240);
      }
    return result.violations;
  }, rules);
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .flatMap((violation) =>
      // Every element, with axe's own words (for contrast: the two colours and the ratio) and the
      // start of its HTML, enough to find it in the source.
      violation.nodes.map(
        (node) =>
          `${violation.id} (${violation.impact}) ${node.target.join(' ')}: ${node.any[0]?.message ?? violation.help} — ${node.html.slice(0, 160)}`,
      ),
    );
}

/** Violations per page, pages without any left out: one failure lists everything to fix. */
async function auditPages(page: Page, rules?: string[], before?: () => Promise<void>) {
  const found: Record<string, string[]> = {};
  for (const { path, ready } of PAGES) {
    await page.goto(path);
    await before?.();
    await ready(page);
    // Data arriving after the first paint changes state (a filter button turns primary), and
    // its colour transition would be measured half way.
    await page.waitForLoadState('networkidle');
    const violations = await seriousViolations(page, rules);
    if (violations.length) found[path] = violations;
  }
  return found;
}

const PAGES: { path: string; ready: (page: Page) => Promise<void> }[] = [
  { path: '/dashboard', ready: (page) => expect(page.getByRole('main')).toBeVisible() },
  { path: '/test-plans', ready: (page) => expect(page.getByRole('main')).toBeVisible() },
  { path: '/reports', ready: (page) => expect(page.getByRole('main')).toBeVisible() },
  { path: '/tests', ready: (page) => expect(page.getByRole('main')).toBeVisible() },
  {
    path: '/dashboard/api-tester',
    ready: (page) => expect(page.getByLabel('Base URL', { exact: true })).toBeVisible(),
  },
  {
    path: '/settings',
    ready: (page) => expect(page.getByRole('button', { name: 'Security' })).toBeVisible(),
  },
];

test('the sign-in page has no serious accessibility violations', async ({ page }) => {
  await page.goto('/auth');
  await expect(page.locator('#login-username')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('the main pages have no serious accessibility violations', async ({ page }) => {
  await register(page);
  expect(await auditPages(page)).toEqual({});
});

test('the dark theme keeps text readable on the main pages', async ({ page }) => {
  await register(page);
  const saved = await page.request.post('/api/settings', { data: { theme: 'dark' } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  expect(
    await auditPages(page, ['color-contrast'], () =>
      expect(page.locator('html')).toHaveClass(/\bdark\b/),
    ),
  ).toEqual({});
});

test('the sidebar and a dialog work from the keyboard alone', async ({ page, browserName }) => {
  await register(page);
  await page.goto('/dashboard');
  // Tab from the top of the page reaches a sidebar link, and Enter follows it.
  const plans = page.getByRole('link', { name: 'Test plans', exact: false }).first();
  await expect(plans).toBeVisible();
  if (browserName === 'webkit') {
    // WebKit follows Safari, whose Tab skips links unless a system setting says otherwise;
    // what can be checked there is that the link takes the focus and Enter follows it.
    await plans.focus();
    await expect(plans).toBeFocused();
  } else {
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await plans.evaluate((element) => element === document.activeElement);
    }
    expect(reached, 'Tab never reached the Test plans link').toBe(true);
  }
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/test-plans$/);

  // A dialog takes the focus, keeps it inside while tabbing, and Escape gives it back.
  await page.goto('/dashboard/api-tester');
  const opener = page.getByRole('button', { name: 'Save Test', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});
