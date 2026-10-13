import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { register } from './helpers';

/**
 * "Start with a sample project" on a real installation: the built server under its enforced
 * Content Security Policy, the worker, and real browsers opening the demo shop the server hosts.
 * The sample is only worth offering if its runs pass there, on the first try.
 */

const TERMINAL = ['completed', 'failed', 'error', 'cancelled', 'timed_out'];

async function finished(page: Page, runId: string) {
  let run: { status: string; passedTests?: number; totalTests?: number } = { status: 'queued' };
  await expect
    .poll(
      async () => {
        run = await (await page.request.get(`/api/test-plan-executions/${runId}`)).json();
        return TERMINAL.includes(run.status);
      },
      { timeout: 150_000, intervals: [2_000] },
    )
    .toBe(true);
  return run;
}

test('a new organization starts from the sample project and its first runs pass', async ({
  page,
  browserName,
}) => {
  // The runs happen in the worker's browsers whatever browser shows the interface: once is enough.
  test.skip(browserName !== 'chromium', 'The sample runs on the worker, not in this browser.');
  test.setTimeout(240_000);

  await register(page);
  const card = page.getByRole('region', { name: 'Start with a sample project' });
  await expect(card).toBeVisible();

  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sample-project') && response.request().method() === 'POST',
  );
  await card.getByRole('button', { name: 'Create sample project', exact: true }).click();
  const body = await (await created).json();
  expect(body.run?.id, body.runError).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/executions/${body.run.id}/report$`));

  // Sign in, place an order, change the shipping: the web journeys against the hosted shop.
  const smoke = await finished(page, body.run.id);
  expect(smoke).toMatchObject({ status: 'completed', passedTests: 3, totalTests: 3 });

  // The API plan: an order placed, then read back by the number the first call returned.
  const run = async (fragment: string) => {
    const plan = body.plans.find((p: { name: string }) => p.name.includes(fragment));
    const started = await page.request.post(`/api/run-test-plan/${plan.id}`, { data: {} });
    expect(started.ok()).toBeTruthy();
    return finished(page, (await started.json()).data.id);
  };
  expect(await run('Orders API')).toMatchObject({
    status: 'completed',
    passedTests: 3,
    totalTests: 3,
  });
  // Every journey on Chromium, Firefox and WebKit.
  expect(await run('Storefront regression')).toMatchObject({
    status: 'completed',
    passedTests: 12,
    totalTests: 12,
  });
  // And the failure it promises: the banner check, and nothing else.
  expect(await run('fails on purpose')).toMatchObject({
    status: 'failed',
    passedTests: 1,
    totalTests: 2,
  });

  // Offered once: with tests in the organization, the dashboard no longer shows it.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(card).toHaveCount(0);
});
