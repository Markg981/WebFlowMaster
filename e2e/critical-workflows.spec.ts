import { test, expect, type Page } from '@playwright/test';
import { history, member, password, register, saveApiTest, unique } from './helpers';

test('an author requests review and a different member approves and publishes through the interface', async ({
  page,
  browser,
}) => {
  await register(page);
  await page.goto('/reviews');
  const policy = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/organization/test-review-policy') &&
      response.request().method() === 'PUT',
  );
  await page.getByRole('switch', { name: 'Require a review to publish', exact: true }).click();
  expect((await policy).ok()).toBeTruthy();
  await expect(
    page.getByRole('switch', { name: 'Require a review to publish', exact: true }),
  ).toBeChecked();
  const author = await member(page, browser, 'editor');
  const viewer = await member(page, browser, 'viewer');
  try {
    const name = unique('review');
    await saveApiTest(author.page, name);
    const dialog = await history(author.page, name);
    await expect(dialog.getByTestId('publishing-panel')).toContainText('plans skip this test');
    await expect(dialog.getByRole('button', { name: /^Publish version/ })).toHaveCount(0);
    await dialog
      .getByLabel('Note for the reviewer', { exact: true })
      .fill('Verify the echo endpoint');
    await dialog.getByRole('button', { name: 'Ask for review of version 1', exact: true }).click();
    await expect(dialog.getByTestId('publishing-panel')).toContainText(
      'Version 1 is waiting for review.',
    );
    await author.page.goto('/reviews');
    const own = author.page.getByRole('listitem').filter({ hasText: name });
    await expect(own).toContainText('Someone other than its author');
    await expect(own.getByRole('button', { name: 'Approve and publish', exact: true })).toHaveCount(
      0,
    );
    await viewer.page.goto('/reviews');
    const readOnly = viewer.page.getByRole('listitem').filter({ hasText: name });
    await expect(readOnly).toBeVisible();
    await expect(
      readOnly.getByRole('button', { name: 'Approve and publish', exact: true }),
    ).toHaveCount(0);
    await expect(
      viewer.page.getByRole('switch', { name: 'Require a review to publish', exact: true }),
    ).toHaveCount(0);
    await page.reload();
    const review = page.getByRole('listitem').filter({ hasText: name });
    await review
      .getByLabel(`Comment on ${name}`, { exact: true })
      .fill('Approved against the fixture');
    await review.getByRole('button', { name: 'Approve and publish', exact: true }).click();
    await expect(review).toHaveCount(0);
    const approved = await history(author.page, name);
    await expect(approved.getByTestId('publishing-panel')).toContainText('Plans run version 1.');
    await expect(approved.getByTestId('published-1')).toBeVisible();
    const viewed = await history(viewer.page, name);
    await expect(viewed.getByTestId('published-1')).toBeVisible();
    await expect(
      viewed.getByRole('button', { name: /^Publish version|^Ask for review|^Roll back/ }),
    ).toHaveCount(0);
  } finally {
    await author.context.close();
    await viewer.context.close();
  }
});

test('publication through history survives reload with review policy disabled', async ({
  page,
}) => {
  await register(page);
  const name = unique('publication');
  await saveApiTest(page, name);
  const dialog = await history(page, name);
  await dialog.getByRole('button', { name: 'Publish version 1', exact: true }).click();
  await expect(dialog.getByTestId('published-1')).toBeVisible();
  const reloaded = await history(page, name);
  await expect(reloaded.getByTestId('publishing-panel')).toContainText('Plans run version 1.');
  await expect(reloaded.getByTestId('published-1')).toBeVisible();
});

async function createMobile(page: Page, name: string) {
  await page.goto('/mobile-tests');
  await page.getByRole('button', { name: 'New mobile test', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('App', { exact: true }).fill('/opt/e2e/shop.apk');
  await dialog.getByLabel('Device', { exact: true }).fill('Google Pixel 8');
  await dialog.getByLabel('Element of step 1', { exact: true }).fill('~sign-in');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  return page.getByRole('row').filter({ hasText: name });
}

test('mobile editor persists device matrix and steps while a viewer sees read-only history', async ({
  page,
  browser,
}) => {
  await register(page);
  const editor = await member(page, browser, 'editor');
  const viewer = await member(page, browser, 'viewer');
  try {
    const name = unique('mobile');
    const row = await createMobile(editor.page, name);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
    const dialog = editor.page.getByRole('dialog');
    await dialog.getByLabel('Device', { exact: true }).fill('Google Pixel 9');
    await dialog.getByRole('button', { name: 'Add device', exact: true }).click();
    await dialog.getByLabel('Device 1', { exact: true }).fill('Google Pixel 8');
    await dialog.getByLabel('OS version 1', { exact: true }).fill('14');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await editor.page.reload();
    await row.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
    await expect(dialog.getByLabel('Device', { exact: true })).toHaveValue('Google Pixel 9');
    await expect(dialog.getByLabel('Device 1', { exact: true })).toHaveValue('Google Pixel 8');
    await expect(dialog.getByLabel('OS version 1', { exact: true })).toHaveValue('14');
    await expect(dialog.getByLabel('Element of step 1', { exact: true })).toHaveValue('~sign-in');
    await viewer.page.goto('/mobile-tests');
    const readOnly = viewer.page.getByRole('row').filter({ hasText: name });
    await expect(readOnly).toContainText('1 device/OS targets');
    await expect(
      viewer.page.getByRole('button', { name: 'New mobile test', exact: true }),
    ).toHaveCount(0);
    await expect(readOnly.getByRole('button', { name: `Edit ${name}`, exact: true })).toHaveCount(
      0,
    );
    await expect(readOnly.getByRole('button', { name: `Delete ${name}`, exact: true })).toHaveCount(
      0,
    );
    await readOnly.getByRole('button', { name: `History of ${name}`, exact: true }).click();
    const viewed = viewer.page.getByRole('dialog');
    await expect(viewed.getByTestId('test-history-list')).toContainText('Version 2');
    await expect(viewed.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0);
    await expect(viewed.getByRole('button', { name: /^Publish version/ })).toHaveCount(0);
  } finally {
    await editor.context.close();
    await viewer.context.close();
  }
});

test('mobile deletion requires confirmation and removes the resource after reload', async ({
  page,
}) => {
  await register(page);
  const name = unique('delete');
  const row = await createMobile(page, name);
  await row.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
  const removed = page.waitForResponse(
    (response) =>
      response.url().includes('/api/mobile-tests/') && response.request().method() === 'DELETE',
  );
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await removed).ok()).toBeTruthy();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(row).toHaveCount(0);
});

test('quota administrator saves an enforced test limit and the interface refuses the next test', async ({
  page,
  browser,
}) => {
  // One named installation operator; ordinary tenant owners must not acquire this permission.
  const signedIn = await page.request.post('/api/login', {
    data: { username: 'e2e_operator', password },
  });
  if (signedIn.ok()) await page.goto('/dashboard');
  else await register(page, 'e2e_operator');
  const tenant = await member(page, browser, 'editor');
  const outsider = await browser.newContext({ baseURL: 'http://127.0.0.1:5080' });
  try {
    const other = await outsider.newPage();
    await register(other);
    await other.goto('/settings#runUsage');
    await other.getByRole('button', { name: 'Run usage', exact: true }).click();
    await expect(other.getByTestId('usage-tests')).toBeVisible();
    await expect(other.getByLabel('Find an organization', { exact: true })).toHaveCount(0);
    const user = await (await page.request.get('/api/user')).json();
    const overview = await (
      await page.request.get('/api/admin/organization-quotas?limit=100')
    ).json();
    const org = overview.items.find(
      (item: { organizationId: number }) => item.organizationId === user.organizationId,
    );
    expect(org).toBeTruthy();
    await page.goto('/settings#runUsage');
    await page.getByRole('button', { name: 'Run usage', exact: true }).click();
    await page.getByLabel('Find an organization', { exact: true }).fill(org.name);
    await page.getByRole('button', { name: org.name, exact: true }).click();
    await page.getByLabel('Quota mode', { exact: true }).selectOption('enforce');
    await page.getByRole('checkbox', { name: 'Inherit Saved tests', exact: true }).uncheck();
    await page.getByLabel('Saved tests', { exact: true }).fill(String(org.usage.tests + 1));
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes('/api/admin/organization-quotas/') &&
        response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save quotas', exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
    await page.reload();
    await page.getByRole('button', { name: 'Run usage', exact: true }).click();
    await page.getByLabel('Find an organization', { exact: true }).fill(org.name);
    await page.getByRole('button', { name: org.name, exact: true }).click();
    await expect(page.getByLabel('Quota mode', { exact: true })).toHaveValue('enforce');
    await expect(page.getByLabel('Saved tests', { exact: true })).toHaveValue(
      String(org.usage.tests + 1),
    );
    await saveApiTest(tenant.page, unique('within_quota'));
    await tenant.page.goto('/settings#runUsage');
    await tenant.page.getByRole('button', { name: 'Run usage', exact: true }).click();
    await expect(tenant.page.getByTestId('usage-tests')).toContainText(
      `${org.usage.tests + 1} / ${org.usage.tests + 1}`,
    );
    await expect(tenant.page.getByLabel('Find an organization', { exact: true })).toHaveCount(0);
    await tenant.page.goto('/dashboard/api-tester');
    await tenant.page.getByLabel('Base URL', { exact: true }).fill('http://127.0.0.1:5081/echo');
    await tenant.page.getByRole('button', { name: 'Save Test', exact: true }).click();
    const dialog = tenant.page.getByRole('dialog');
    const refusedName = unique('over_quota');
    await dialog.getByLabel('Test Name', { exact: true }).fill(refusedName);
    const refused = tenant.page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/api-tests') && response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Save Test', exact: true }).click();
    expect((await refused).status()).toBe(429);
    await expect(tenant.page.getByRole('status').filter({ hasText: 'Failed' })).toBeVisible();
    await tenant.page.reload();
    await tenant.page.getByRole('tab', { name: 'Saved Tests', exact: true }).click();
    await expect(tenant.page.getByText(refusedName, { exact: true })).toHaveCount(0);
  } finally {
    await tenant.context.close();
    await outsider.close();
  }
});

test('cancelling a running plan through its report persists cancellation and skips subsequent tests', async ({
  page,
}) => {
  await register(page);
  const slowKey = unique('slow');
  const first = await saveApiTest(page, slowKey, `http://127.0.0.1:5081/slow?run=${slowKey}`);
  const second = await saveApiTest(page, unique('after_cancel'));
  for (const item of [first, second])
    expect(
      (await page.request.post(`/api/api-tests/${item.id}/publish`, { data: {} })).ok(),
    ).toBeTruthy();
  const created = await page.request.post('/api/test-plans', {
    data: {
      name: unique('cancel_plan'),
      selectedTests: [first, second].map((item) => ({ id: item.id, type: 'api' })),
      testMachinesConfig: [{ browserName: 'chromium', headless: true }],
      maxParallelTests: 1,
    },
  });
  expect(created.status()).toBe(201);
  const plan = await created.json();
  await page.goto(`/test-plan/${plan.id}/run`);
  const started = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/run-test-plan/${plan.id}`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Start Execution', exact: true }).click();
  const response = await started;
  expect(response.ok()).toBeTruthy();
  const runId = (await response.json()).data.id;
  await page.getByRole('link', { name: 'View detailed report', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/test-plan-executions/${runId}`)).json()).status,
    )
    .toBe('running');
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`http://127.0.0.1:5081/slow-state?run=${slowKey}`)).json())
          .started,
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Keep running', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Cancel run', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  const cancelled = page.waitForResponse(
    (reply) =>
      reply.url().endsWith(`/api/test-plan-executions/${runId}/cancel`) &&
      reply.request().method() === 'POST',
  );
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel run', exact: true })
    .click();
  expect((await cancelled).ok()).toBeTruthy();
  // Acceptance of the request precedes the worker's heartbeat. Wait for its acknowledgement.
  await expect
    .poll(
      async () => {
        const logs = await (
          await page.request.get(`/api/test-plan-executions/${runId}/logs`)
        ).json();
        return logs.some(
          (entry: { message: string }) =>
            entry.message === 'Stopping the run: the run was cancelled.',
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  expect(
    (await page.request.post(`http://127.0.0.1:5081/slow-release?run=${slowKey}`)).ok(),
  ).toBeTruthy();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/test-plan-executions/${runId}`)).json()).status,
      { timeout: 60_000 },
    )
    .toBe('cancelled');
  await page.reload();
  await expect(page.getByText('Cancelled:', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel run', exact: true })).toHaveCount(0);
  const run = await (await page.request.get(`/api/test-plan-executions/${runId}`)).json();
  expect(run.results).toEqual(
    expect.arrayContaining([expect.objectContaining({ testId: first.id })]),
  );
  const reportResponse = await page.request.get(`/api/test-plan-executions/${runId}/report`);
  expect(reportResponse.ok()).toBeTruthy();
  const report = await reportResponse.json();
  type ReportTest = { apiTestId: number; status: string; reasonForFailure: string };
  const rows = Object.values(
    report.testGroupings as Record<string, { components: Record<string, { tests: ReportTest[] }> }>,
  ).flatMap((group) => Object.values(group.components).flatMap((component) => component.tests));
  expect(rows.find((item) => item.apiTestId === second.id)).toMatchObject({
    status: 'Skipped',
    reasonForFailure: expect.stringMatching(/cancelled/i),
  });
});
