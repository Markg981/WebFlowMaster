import { test, expect } from '@playwright/test';
import { authenticatorCode, login, logout, openAuth, register, unique } from './helpers';

test('MFA enrollment gates login, rejects a wrong code and consumes a recovery code once', async ({
  page,
}) => {
  const username = await register(page);
  await page.goto('/settings#security');
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await page.getByRole('button', { name: 'Set up two-factor authentication', exact: true }).click();
  const secret = await page.getByTestId('mfa-secret').innerText();
  await page.getByLabel('Code from the app', { exact: true }).fill(authenticatorCode(secret));
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();
  const codes = page.getByTestId('recovery-codes').locator('li');
  await expect(codes).toHaveCount(10);
  const recovery = await codes.first().innerText();
  await page.getByRole('button', { name: 'I have saved them', exact: true }).click();
  await expect(page.getByTestId('mfa-status')).toBeVisible();
  await logout(page);
  await login(page, username);
  await expect(page.getByLabel('Code from your authenticator app', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/auth$/);
  await page
    .getByLabel('Code from your authenticator app', { exact: true })
    .fill('invalid-recovery-code');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('That code is not valid.');
  await expect(page).toHaveURL(/\/auth$/);
  await page.getByLabel('Code from your authenticator app', { exact: true }).fill(recovery);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await logout(page);
  await login(page, username);
  await page.getByLabel('Code from your authenticator app', { exact: true }).fill(recovery);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('That code is not valid.');
  await expect(page).toHaveURL(/\/auth$/);
});

test('OIDC login returns from a real HTTPS provider and preserves the viewer permissions', async ({
  page,
  browser,
}) => {
  await register(page);
  const domain = `${unique('sso').replaceAll('_', '-')}.example.test`;
  await page.goto('/settings#security');
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await page.locator('#sso-issuer').fill('https://localhost:5083');
  await page.locator('#sso-client-id').fill('installation-e2e');
  await page.locator('#sso-client-secret').fill('installation-e2e-secret');
  await page.getByLabel('E-mail domains', { exact: true }).fill(domain);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/organization/sso') && response.request().method() === 'PUT',
  );
  await page
    .locator('form')
    .filter({ has: page.locator('#sso-issuer') })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await expect(page.locator('#sso-issuer')).toHaveValue('https://localhost:5083');
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:5080',
    ignoreHTTPSErrors: true,
  });
  try {
    const reader = await context.newPage();
    await openAuth(reader);
    await reader.getByRole('button', { name: 'Sign in with SSO', exact: true }).click();
    await reader.getByLabel('Work e-mail address', { exact: true }).fill(`viewer@${domain}`);
    await reader
      .getByRole('button', { name: 'Continue to your identity provider', exact: true })
      .click();
    await expect(reader).toHaveURL(/^https:\/\/localhost:5083\/authorize/);
    await reader.getByLabel('Provider email', { exact: true }).fill(`viewer@${domain}`);
    await reader.getByLabel('Provider password', { exact: true }).fill('provider-e2e-password');
    await reader.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(reader).toHaveURL(/\/dashboard$/);
    await reader.reload();
    await expect(reader).toHaveURL(/\/dashboard$/);
    await reader.goto('/mobile-tests');
    await expect(reader.getByText('No mobile test yet.', { exact: false })).toBeVisible();
    await expect(reader.getByRole('button', { name: 'New mobile test', exact: true })).toHaveCount(
      0,
    );
    await reader.goto('/settings#security');
    await reader.getByRole('button', { name: 'Security', exact: true }).click();
    await expect(reader.locator('#sso-issuer')).toHaveCount(0);
    await reader.goto('/reviews');
    await expect(reader.getByText('Nothing is waiting for review.', { exact: true })).toBeVisible();
    await expect(
      reader.getByRole('switch', { name: 'Require a review to publish', exact: true }),
    ).toHaveCount(0);
    await logout(reader);
    await reader.goto('/mobile-tests');
    await expect(reader).toHaveURL(/\/auth$/);
  } finally {
    await context.close();
  }
});

test('SSO refuses an unknown email domain and keeps protected pages behind login', async ({
  page,
}) => {
  // SSO availability is installed through the real settings API solely as setup.
  await register(page);
  const configured = await page.request.put('/api/organization/sso', {
    data: {
      protocol: 'oidc',
      issuer: 'https://localhost:5083',
      clientId: 'installation-e2e',
      clientSecret: 'installation-e2e-secret',
      domains: [`${unique('offered').replaceAll('_', '-')}.example.test`],
      defaultRole: 'viewer',
      enabled: true,
      required: false,
    },
  });
  expect(configured.ok(), await configured.text()).toBeTruthy();
  await logout(page);
  await page.getByRole('button', { name: 'Sign in with SSO', exact: true }).click();
  await page
    .getByLabel('Work e-mail address', { exact: true })
    .fill(`nobody@${unique('unknown').replaceAll('_', '-')}.example.test`);
  await page
    .getByRole('button', { name: 'Continue to your identity provider', exact: true })
    .click();
  await expect(page.getByTestId('sso-sign-in-error')).toContainText('No organization here');
  await page.goto('/reviews');
  await expect(page).toHaveURL(/\/auth/);
});
