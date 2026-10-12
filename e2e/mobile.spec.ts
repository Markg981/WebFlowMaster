import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { register, saveApiTest } from './helpers';

/**
 * The pages someone opens from a phone: the dashboard, the reports and the report of one run.
 * They are for reading, not authoring, so they have to fit a phone screen without sideways
 * scrolling. The viewport is an iPhone 13 mini's, the narrowest phone still common; `isMobile`
 * is left out because Firefox does not support it, and the layout follows the width alone.
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

/**
 * Elements that stick out past the right edge of the screen, with enough of their HTML to find
 * them in the source. Content inside a container that scrolls sideways on purpose (a wide table
 * in an overflow-x-auto wrapper) is left out: the page stays put and only that box scrolls.
 */
async function overflowing(page: Page) {
  await page.waitForLoadState('networkidle');
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const main = document.querySelector('main');
    const scrollsSideways = (element: Element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        // main scrolls the page vertically, which makes its computed overflow-x auto as well;
        // a page that scrolls sideways inside it is exactly what this check is for.
        if (parent === document.body || parent === main) return false;
        const overflowX = getComputedStyle(parent).overflowX;
        if (
          (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') &&
          parent.getBoundingClientRect().right <= width + 1
        )
          return true;
      }
      return false;
    };
    const found: string[] = [];
    for (const element of document.body.querySelectorAll('*')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.right <= width + 1) continue;
      if (scrollsSideways(element)) continue;
      // Report the outermost offender only: its children stick out because it does.
      const parent = element.parentElement;
      if (parent && parent.getBoundingClientRect().right > width + 1 && !scrollsSideways(parent))
        continue;
      found.push(`${Math.round(box.right)}px: ${element.outerHTML.slice(0, 200)}`);
    }
    if (document.documentElement.scrollWidth > width + 1)
      found.push(`document is ${document.documentElement.scrollWidth}px wide`);
    if (main && main.scrollWidth > main.clientWidth + 1)
      found.push(`main scrolls sideways: ${main.scrollWidth}px in ${main.clientWidth}px`);
    return found;
  });
}

test('the menu opens as a drawer and closes after choosing a page', async ({ page }) => {
  await register(page);
  // The desktop sidebar is hidden; the header button is the way to the other pages.
  await expect(page.getByRole('link', { name: 'Reports', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(drawer).toHaveCount(0);
  // Escape closes it as well, like any other dialog.
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

/**
 * A phone, then a portrait tablet: at 768px the desktop sidebar comes back and leaves the page
 * about 530px, narrower than most phones turned sideways.
 */
const WIDTHS = [375, 768];

/** Opens each path at each width and collects what sticks out, keyed by "path @ width". */
async function auditWidths(page: Page, paths: string[]) {
  const found: Record<string, string[]> = {};
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      const offenders = await overflowing(page);
      if (offenders.length) found[`${path} @ ${width}px`] = offenders;
    }
  }
  return found;
}

test('the dashboard and the reports fit a phone and a tablet', async ({ page }) => {
  await register(page);
  expect(await auditWidths(page, ['/dashboard', '/reports'])).toEqual({});
});

test('the report of a run fits a phone and a tablet', async ({ page }) => {
  await register(page);
  const name = `Mobile report ${randomUUID()}`;
  const saved = await saveApiTest(page, name);
  const created = await page.request.post('/api/test-plans', {
    data: {
      name: `Mobile plan ${randomUUID()}`,
      selectedTests: [{ id: saved.id, type: 'api' }],
      testMachinesConfig: [{ browserName: 'chromium', headless: true }],
      maxParallelTests: 1,
    },
  });
  expect(created.status()).toBe(201);
  const plan = await created.json();
  const started = await page.request.post(`/api/run-test-plan/${plan.id}`, { data: {} });
  expect(started.ok(), await started.text()).toBeTruthy();
  const runId = (await started.json()).data.id;
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/test-plan-executions/${runId}`)).json()).status,
      { timeout: 60_000 },
    )
    .toBe('completed');

  await page.goto(`/test-plans/${plan.id}/executions/${runId}/report`);
  await expect(page.getByText('100.00% Pass Rate', { exact: true })).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
  // On a phone the topbar title is all the orientation there is; it names the report, not the
  // plans list the URL sits under.
  await expect(page.getByRole('banner').first()).toContainText('Execution report');
  // The dashboard and the reports now have a run to chart and list.
  expect(
    await auditWidths(page, [
      `/test-plans/${plan.id}/executions/${runId}/report`,
      '/dashboard',
      `/reports?planId=${plan.id}`,
    ]),
  ).toEqual({});
  // With a run to show, both dashboard charts are drawn with a real height. Inside a
  // configurable widget the card is not stretched by a grid row, and a chart sized to 100% of a
  // min-height alone was 0 pixels tall: present in the DOM, invisible on screen.
  await page.goto('/dashboard');
  const charts = page.locator('.recharts-wrapper > svg.recharts-surface');
  await expect(charts).toHaveCount(2);
  for (const chart of await charts.all()) {
    expect((await chart.boundingBox())?.height ?? 0).toBeGreaterThan(150);
  }
});
