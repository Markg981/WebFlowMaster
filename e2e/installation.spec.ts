import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { distributedWsdl, requestXsd, baseXsd } from '../server/tests/soap-bundle-fixtures';

const password = 'E2e-Installation!2026';
const target = 'http://127.0.0.1:5081/echo';

test('gRPC stream settings persist and a real service completes through the interface', async ({ page }) => {
  await register(page); await page.goto('/dashboard/api-tester');
  await page.getByLabel('Method', { exact: true }).click(); await page.getByRole('option', { name: 'GRPC', exact: true }).click();
  await page.getByLabel('Base URL', { exact: true }).fill('grpc://127.0.0.1:5082/installation.Test/Stream');
  await page.getByLabel('Service definition (.proto)', { exact: true }).fill(readFileSync('e2e/protocol.proto', 'utf8'));
  await page.getByLabel('gRPC mode', { exact: true }).selectOption('server_stream');
  await page.getByLabel('Maximum received messages', { exact: true }).fill('5');
  const name = `CI gRPC stream ${randomUUID()}`;
  await page.getByRole('button', { name: 'Save Test', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Test Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save Test', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.reload(); await page.getByRole('tab', { name: 'Saved Tests', exact: true }).click(); await page.getByText(name, { exact: true }).click();
  await expect(page.getByLabel('gRPC mode', { exact: true })).toHaveValue('server_stream');
  await expect(page.getByLabel('Maximum received messages', { exact: true })).toHaveValue('5');
  const sent = page.waitForResponse(res => res.url().endsWith('/api/proxy-api-request'));
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect(await (await sent).json()).toMatchObject({ status: 0, body: { count: 2, last: { value: 'complete' } } });
  await expect(page.getByTestId('protocol-transcript')).toContainText('complete');
  const saved = (await (await page.request.get('/api/api-tests')).json()).find((item: { name: string }) => item.name === name);
  expect((await page.request.post(`/api/api-tests/${saved.id}/publish`, { data: {} })).ok()).toBeTruthy();
  // The worker must execute the published five-message limit, not this newer one-message draft.
  expect((await page.request.put(`/api/api-tests/${saved.id}`, { data: { protocolConfig: { grpcMode: 'server_stream', maxMessages: 1 } } })).ok()).toBeTruthy();
  const created = await page.request.post('/api/test-plans', { data: {
    name: `CI published stream ${randomUUID()}`, selectedTests: [{ id: saved.id, type: 'api' }],
    testMachinesConfig: [{ browserName: 'chromium', headless: true }], maxParallelTests: 1,
  } });
  expect(created.status()).toBe(201); const plan = await created.json();
  await page.goto(`/test-plan/${plan.id}/run`);
  await expect(page.getByTestId('plan-contents')).toContainText(name);
  const started = page.waitForResponse(res => res.url().endsWith(`/api/run-test-plan/${plan.id}`) && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start Execution', exact: true }).click();
  const start = await started; expect(start.ok()).toBeTruthy(); const runId = (await start.json()).data.id;
  await page.getByRole('link', { name: 'View detailed report', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/test-plan-executions/${runId}`)).json()).status, { timeout: 60000 }).toBe('completed');
  const run = await (await page.request.get(`/api/test-plan-executions/${runId}`)).json();
  expect(run.results[0]).toMatchObject({ success: true, protocol: { status: 0, body: { count: 2 } } });
  await expect(page.getByText('100.00% Pass Rate', { exact: true })).toBeVisible();
});

test('WebSocket conversation captures an immediate challenge and sends the dependent message', async ({ page }) => {
  await register(page); await page.goto('/dashboard/api-tester');
  await page.getByLabel('Method', { exact: true }).click(); await page.getByRole('option', { name: 'WEBSOCKET', exact: true }).click();
  await page.getByLabel('Base URL', { exact: true }).fill('ws://127.0.0.1:5081');
  await page.getByRole('tab', { name: 'Body', exact: true }).first().click();
  await page.getByRole('radio', { name: 'Raw (JSON, XML, Text, etc.)', exact: true }).click();
  await page.getByRole('button', { name: 'Edit conversation JSON', exact: true }).click();
  await page.getByLabel('Conversation JSON', { exact: true }).fill(JSON.stringify({ steps: [{ type: 'receive' }, { type: 'capture', name: 'token', property: 'token' }, { type: 'send', message: '{{capture.token}}' }, { type: 'receive', property: 'accepted', equals: true }, { type: 'end' }] }));
  const sent = page.waitForResponse(res => res.url().endsWith('/api/proxy-api-request'));
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect(await (await sent).json()).toMatchObject({ status: 101, body: { count: 2, last: { accepted: true }, captures: { token: 'installation-challenge' } } });
  await expect(page.getByTestId('protocol-transcript')).toContainText('installation-challenge');
});

test('SOAP bundle files and logical locations produce saved tests through the import interface', async ({ page }) => {
  await register(page); await page.goto('/dashboard/api-tester');
  await page.getByRole('tab', { name: 'Saved Tests', exact: true }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#import-file').setInputFiles([
    { name: 'service.wsdl', mimeType: 'text/xml', buffer: Buffer.from(distributedWsdl) },
    { name: 'request.xsd', mimeType: 'text/xml', buffer: Buffer.from(requestXsd) },
    { name: 'base.xsd', mimeType: 'text/xml', buffer: Buffer.from(baseXsd) },
  ]);
  await dialog.getByLabel('Document 2 logical location', { exact: true }).fill('types/request.xsd');
  await dialog.getByLabel('Document 3 logical location', { exact: true }).fill('types/base.xsd');
  await dialog.getByRole('button', { name: 'Show what it makes', exact: true }).click();
  await expect(dialog.getByTestId('import-preview')).toBeVisible();
  const imported = page.waitForResponse(res => res.url().endsWith('/api/api-tests/import') && res.request().method() === 'POST');
  await dialog.getByTestId('import-confirm').click();
  expect((await imported).status()).toBe(201);
  const saved = await (await page.request.get('/api/api-tests')).json();
  expect(saved).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'POST', requestBody: expect.stringContaining('OrderId') })]));
});

test('organization email settings and edited templates persist and stay isolated from another organization', async ({ page, browser }) => {
  await register(page);
  await page.goto('/settings#security');
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await page.getByRole('combobox', { name: 'Email sending', exact: true }).selectOption('disabled');
  await page.getByRole('combobox', { name: 'Tracking provider', exact: true }).selectOption('generic');
  const secret = 'e2e-disposable-signing-secret-at-least-32-characters';
  await page.getByLabel('Webhook signing secret', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Save email settings', exact: true }).click();
  await expect(page.getByText('Email settings saved.', { exact: true })).toBeVisible();
  const callback = await page.getByLabel('Provider callback URL', { exact: true }).inputValue();
  expect(callback).toMatch(/\/api\/mail-deliveries\/providers\/[0-9a-f-]{36}$/);
  await page.getByLabel('Message type', { exact: true }).selectOption('password_reset');
  await page.getByLabel('Subject', { exact: true }).fill('Organization-specific reset');
  await page.getByLabel('HTML source', { exact: true }).fill('<h1>Organization email</h1><p>{{username}}</p><a href="{{actionUrl}}">Reset password</a>');
  await page.getByLabel('Plain-text alternative', { exact: true }).fill('Organization email: {{actionUrl}}');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Email preview"]');
  await expect(preview.getByRole('heading', { name: 'Organization email' })).toBeVisible();
  await expect(preview.locator('a')).not.toHaveAttribute('href');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('Template saved.', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Email sending', exact: true })).toHaveValue('disabled');
  await expect(page.getByRole('combobox', { name: 'Tracking provider', exact: true })).toHaveValue('generic');
  await expect(page.getByLabel('Webhook signing secret', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Provider callback URL', { exact: true })).toHaveValue(callback);
  await page.getByLabel('Message type', { exact: true }).selectOption('password_reset');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Organization-specific reset');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5080' });
  try {
    const other = await context.newPage(); await register(other);
    await other.goto('/settings#security'); await other.getByRole('button', { name: 'Security', exact: true }).click();
    await expect(other.getByRole('combobox', { name: 'Email sending', exact: true })).toHaveValue('inherit');
    await expect(other.getByRole('combobox', { name: 'Tracking provider', exact: true })).toHaveValue('none');
    await other.getByLabel('Message type', { exact: true }).selectOption('password_reset');
    await expect(other.getByLabel('Subject', { exact: true })).toHaveValue('Choose a new WebFlowMaster password');
    const foreign = await context.request.get('/api/mail-settings');
    expect(foreign.ok()).toBeTruthy(); expect(JSON.stringify(await foreign.json())).not.toContain(secret);
  } finally { await context.close(); }
});

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

test('a test conversation persists replies, member mentions and resolution through the interface', async ({ page }) => {
  const username = await register(page);
  await saveApiTest(page, `CI discussion ${randomUUID()}`);
  await page.getByRole('tab', { name: 'Saved Tests', exact: true }).click();
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New comment', { exact: true }).fill('Investigate the failing assertion');
  await dialog.locator('summary').filter({ hasText: /^Mention members$/ }).click();
  await dialog.getByRole('checkbox', { name: `Mention ${username}`, exact: true }).check();
  await dialog.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(dialog.getByText('Investigate the failing assertion', { exact: true })).toBeVisible();
  await expect(dialog.getByText(`@${username}`, { exact: true }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Reply', exact: true }).click();
  await dialog.getByLabel('Reply message', { exact: true }).fill('Confirmed against the production endpoint');
  await dialog.getByRole('button', { name: 'Add reply', exact: true }).click();
  await expect(dialog.getByText('Confirmed against the production endpoint', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Resolve conversation', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Reopen conversation', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Saved Tests', exact: true }).click();
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await dialog.getByLabel('Conversation filter', { exact: true }).selectOption('resolved');
  await expect(dialog.getByText('Confirmed against the production endpoint', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Reopen conversation', exact: true }).click();
  await dialog.getByLabel('Conversation filter', { exact: true }).selectOption('mentions');
  await expect(dialog.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
});

test('multiple configured dashboards persist and are shared read-only with another organization member', async ({ page, browser }) => {
  await register(page);
  const name = `CI shared dashboard ${randomUUID()}`;
  await page.getByRole('button', { name: 'Create dashboard', exact: true }).click();
  await page.getByLabel('Dashboard name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByLabel('Dashboard', { exact: true }).locator('option:checked')).toContainText(name);
  await page.getByRole('button', { name: 'Customize dashboard', exact: true }).click();
  await page.getByLabel('Widget type', { exact: true }).selectOption('reports');
  await page.getByRole('button', { name: 'Add widget', exact: true }).click();
  await page.getByLabel('Widget title 6', { exact: true }).fill('Team report window');
  await page.getByLabel('Period in days 6', { exact: true }).fill('7');
  await page.getByLabel('Result limit 6', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page.getByText('Team report window', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Share with organization', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Make private', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Make default', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Make default', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('Dashboard', { exact: true }).locator('option:checked')).toContainText(name);
  await expect(page.getByText('Team report window', { exact: true })).toBeVisible();
  const username = `viewer_${randomUUID().replaceAll('-', '')}`;
  const invitation = await page.request.post('/api/organization/invitations', { data: { username, role: 'viewer' } });
  expect(invitation.status()).toBe(201);
  const { token } = await invitation.json();
  const readerContext = await browser.newContext();
  try {
    const reader = await readerContext.newPage();
    await reader.goto(`http://127.0.0.1:5080/auth?invitation=${token}&username=${username}`);
    await reader.getByRole('tab', { name: 'Register', exact: true }).click();
    await reader.locator('#register-password').fill(password);
    await reader.locator('#confirm-password').fill(password);
    await reader.getByRole('button', { name: 'Create Account', exact: true }).click();
    await expect(reader).toHaveURL(/\/dashboard$/);
    const shared = (await (await reader.request.get('/api/dashboards')).json()).dashboards.find((dashboard: { id: string; name: string }) => dashboard.name === name);
    expect(shared).toBeTruthy();
    await reader.getByLabel('Dashboard', { exact: true }).selectOption(shared.id);
    await expect(reader.getByText('Team report window', { exact: true })).toBeVisible();
    await expect(reader.getByRole('button', { name: 'Customize dashboard', exact: true })).toHaveCount(0);
    await reader.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await reader.getByLabel('Dashboard name', { exact: true }).fill('My private team copy');
    await reader.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(reader.getByRole('button', { name: 'Customize dashboard', exact: true })).toBeVisible();
  } finally { await readerContext.close(); }
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
