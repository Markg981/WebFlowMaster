import { test, expect, openPage } from './fixtures';
import {
  authenticatorCode,
  login,
  logout,
  member,
  nextAuthenticatorCode,
  password,
  register,
  unique,
} from './helpers';
import type { Browser, Page } from '@playwright/test';

async function openMembers(page: Page) {
  await page.goto('/settings#members');
  await page.getByRole('button', { name: 'Members', exact: true }).click();
}

async function invite(page: Page, username: string, role: 'viewer' | 'editor') {
  await page.locator('#inviteUsername').fill(username);
  await page.getByRole('combobox', { name: 'Role', exact: true }).click();
  await page.getByRole('option', { name: role, exact: true }).click();
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const link = await page
    .getByTestId('invitation-link')
    .getByLabel('Invitation link', { exact: true })
    .inputValue();
  return new URL(link).searchParams.get('invitation')!;
}

async function newSession(browser: Browser) {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5080', locale: 'en-US' });
  return { context, page: await openPage(context) };
}

async function enableMfa(page: Page) {
  await page.getByRole('button', { name: 'Set up two-factor authentication', exact: true }).click();
  const secret = await page.getByTestId('mfa-secret').innerText();
  const code = authenticatorCode(secret);
  await page.getByLabel('Code from the app', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  await page.getByRole('button', { name: 'I have saved them', exact: true }).click();
  return { secret, code };
}

test('an owner invites through the interface, the link joins with the chosen role, and a revoked link is refused', async ({
  page,
  browser,
}) => {
  await register(page);
  await openMembers(page);

  const viewer = unique('invited');
  const token = await invite(page, viewer, 'viewer');
  await expect(page.getByTestId('invitation-link')).toContainText(viewer);
  const joined = await newSession(browser);
  try {
    await register(joined.page, viewer, token);
    // The role chosen in the invitation, not a default: a viewer cannot create.
    await joined.page.goto('/mobile-tests');
    await expect(joined.page.getByText('No mobile test yet.', { exact: false })).toBeVisible();
    await expect(
      joined.page.getByRole('button', { name: 'New mobile test', exact: true }),
    ).toHaveCount(0);
  } finally {
    await joined.context.close();
  }
  await page.reload();
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await expect(page.getByRole('combobox', { name: `Role of ${viewer}`, exact: true })).toHaveText(
    'viewer',
  );
  await expect(
    page.getByRole('button', { name: `Revoke the invitation for ${viewer}`, exact: true }),
  ).toHaveCount(0);

  const revoked = unique('revoked');
  const revokedToken = await invite(page, revoked, 'editor');
  const revoke = page.getByRole('button', {
    name: `Revoke the invitation for ${revoked}`,
    exact: true,
  });
  await revoke.click();
  await expect(revoke).toHaveCount(0);
  const refused = await newSession(browser);
  try {
    await refused.page.goto(`/auth?invitation=${revokedToken}&username=${revoked}`, {
      waitUntil: 'commit',
    });
    await refused.page.getByRole('tab', { name: 'Register', exact: true }).click();
    await refused.page.locator('#register-password').fill(password);
    await refused.page.locator('#confirm-password').fill(password);
    await refused.page.getByRole('button', { name: 'Create Account', exact: true }).click();
    await expect(
      refused.page
        .getByRole('tabpanel', { name: 'Register' })
        .getByText('That invitation is not valid.', { exact: true }),
    ).toBeVisible();
    await expect(refused.page).toHaveURL(/\/auth/);
  } finally {
    await refused.context.close();
  }
});

test('an organization that requires two-factor holds a member without it until they enroll', async ({
  page,
  browser,
}) => {
  await register(page);
  await page.goto('/settings#security');
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await enableMfa(page);
  const policy = page.getByRole('switch', { name: 'Require it of every member', exact: true });
  await policy.click();
  await expect(policy).toBeChecked();

  const { page: colleague, context, username } = await member(page, browser, 'editor');
  try {
    // Registration lands on the enrollment screen, not the application.
    await expect(
      colleague.getByText('Your organization requires a code from an authenticator app', {
        exact: false,
      }),
    ).toBeVisible();
    await colleague.goto('/dashboard');
    await expect(
      colleague.getByRole('button', { name: 'Set up two-factor authentication', exact: true }),
    ).toBeVisible();
    const blocked = await colleague.request.get('/api/projects');
    expect(blocked.status()).toBe(403);

    const { secret, code } = await enableMfa(colleague);
    await expect(colleague.getByRole('banner')).toBeVisible();
    expect((await colleague.request.get('/api/projects')).ok()).toBeTruthy();

    // From now on the code is asked for at every sign-in, and cannot be turned off.
    await logout(colleague);
    await login(colleague, username);
    await colleague
      .getByLabel('Code from your authenticator app', { exact: true })
      .fill(await nextAuthenticatorCode(secret, code));
    await colleague.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(colleague).toHaveURL(/\/dashboard$/);
    await colleague.goto('/settings#security');
    await colleague.getByRole('button', { name: 'Security', exact: true }).click();
    await expect(
      colleague.getByText('Your organization requires it, so it cannot be turned off.'),
    ).toBeVisible();
    await expect(colleague.getByRole('button', { name: 'Turn off', exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
