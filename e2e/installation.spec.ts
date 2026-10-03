import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const password = 'E2e-Installation!2026';
const target = 'http://127.0.0.1:5081/echo';

async function register(page: Page) {
  const username = `ci_${randomUUID().replaceAll('-', '')}`;
  await page.goto('/auth');
  await page.getByRole('tab', { name: 'Register', exact: true }).click();
  await page.locator('#register-username').fill(username);
  await page.locator('#register-password').fill(password);
  await page.locator('#confirm-password').fill(password);
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return username;
}

async function saveApiTest(page: Page, name: string) {
  await page.goto('/dashboard/api-tester');
  await page.getByLabel('Base URL', { exact: true }).fill(target);
  await page.getByRole('button', { name: 'Save Test', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Test Name', { exact: true }).fill(name);
  const saved = page.waitForResponse(res => res.url().endsWith('/api/api-tests') && res.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Save Test', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  await expect(dialog).not.toBeVisible();
  return response.json() as Promise<{ id: number }>;
}

test('registration, logout and login keep the session across a reload', async ({ page }) => {
  const username = await register(page);
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByText(username, { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/auth$/);
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.reload();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByText(username, { exact: true })).toBeVisible();
});

test('an API test saved through the editor survives a reload and sends a real request', async ({ page }) => {
  await register(page);
  const name = `CI persisted API ${randomUUID()}`;
  await saveApiTest(page, name);
  await page.reload();
  await page.getByRole('tab', { name: 'Saved Tests', exact: true }).click();
  await page.getByText(name, { exact: true }).click();
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue(target);
  const sent = page.waitForResponse(res => res.url().endsWith('/api/proxy-api-request') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const response = await sent;
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ status: 200, body: { source: 'ci-real-http' } });
  await expect(page.getByText('200', { exact: true })).toBeVisible();
});

test('a plan started in the interface runs on the worker and renders its persisted report', async ({ page }) => {
  await register(page);
  const name = `CI worker API ${randomUUID()}`;
  const saved = await saveApiTest(page, name);
  // Publish and arrange the plan through the real API; the browser starts the run and reads
  // its report. No route interception, injected database rows or mocked product services.
  const configured = await page.request.put(`/api/api-tests/${saved.id}`, { data: {
    name, method: 'GET', url: target, module: 'CI E2E', component: 'HTTP',
    assertions: [{ id: randomUUID(), source: 'body_json_path', property: 'source', comparison: 'equals', targetValue: 'ci-real-http', enabled: true }],
    extractions: [{ id: randomUUID(), name: 'fixtureSource', source: 'body_json_path', property: 'source' }],
  } });
  expect(configured.ok()).toBeTruthy();
  const published = await page.request.post(`/api/api-tests/${saved.id}/publish`, { data: {} });
  expect(published.ok()).toBeTruthy();
  const created = await page.request.post('/api/test-plans', { data: {
    name: `CI plan ${randomUUID()}`,
    selectedTests: [{ id: saved.id, type: 'api' }],
    testMachinesConfig: [{ browserName: 'chromium', headless: true }],
    maxParallelTests: 1,
  } });
  expect(created.status()).toBe(201);
  const plan = await created.json();
  await page.goto(`/test-plan/${plan.id}/run`);
  await expect(page.getByTestId('plan-contents')).toContainText(name);
  const started = page.waitForResponse(res => res.url().endsWith(`/api/run-test-plan/${plan.id}`) && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start Execution', exact: true }).click();
  const response = await started;
  expect(response.ok()).toBeTruthy();
  const runId = (await response.json()).data.id;
  await page.getByRole('link', { name: 'View detailed report', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/test-plans/${plan.id}/executions/${runId}/report$`));
  await expect.poll(async () => {
    const run = await page.request.get(`/api/test-plan-executions/${runId}`);
    expect(run.ok()).toBeTruthy();
    return (await run.json()).status;
  }, { timeout: 60_000 }).toBe('completed');
  const run = await (await page.request.get(`/api/test-plan-executions/${runId}`)).json();
  expect(run.results).toHaveLength(1);
  expect(run.results[0]).toMatchObject({ success: true, status: 'passed', extracted: { fixtureSource: 'ci-real-http' } });
  await expect(page.getByText('100.00% Pass Rate', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^CI E2E / }).click();
  await page.getByRole('button', { name: /^HTTP / }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Passed');
  await page.reload();
  await page.getByRole('button', { name: /^CI E2E / }).click();
  await page.getByRole('button', { name: /^HTTP / }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Passed');
});
