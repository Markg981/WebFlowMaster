import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

export { expect };

/**
 * A page whose first navigation has already completed.
 *
 * In CI Firefox sometimes loses the first navigation of a new page: the document loads and
 * renders, yet Playwright never sees the commit and no locator on that page gets an answer again
 * (October 2026 traces). Waiting longer on that page does not help, so the first navigation goes
 * to a cheap health endpoint, and a page that never reports its commit is closed and replaced
 * before any test step uses it.
 */
export async function openPage(context: BrowserContext): Promise<Page> {
  for (let attempt = 1; ; attempt++) {
    const page = await context.newPage();
    try {
      await page.goto('http://127.0.0.1:5080/healthz', { waitUntil: 'commit', timeout: 10_000 });
      return page;
    } catch (error) {
      await Promise.race([page.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5_000))]);
      if (attempt === 3) throw error;
    }
  }
}

export const test = base.extend({
  page: async ({ context }, use) => {
    await use(await openPage(context));
  },
});
