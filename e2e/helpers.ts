import { errors, expect, type Browser, type Page } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';

export const password = 'E2e-Installation!2026';
export const unique = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

/**
 * Opens the sign-in page, also on a page that was just created.
 *
 * Firefox in CI sometimes never reports the first navigation of a new page to Playwright, not
 * even its commit, although the page loads: in the traces /auth answered 200 in a few
 * milliseconds, the app rendered and called its APIs, and page.goto still timed out after 30
 * seconds. When the navigation does not report in time, the form decides: visible means loaded.
 * The fallback runs only after the timeout, so it never sees a previous document's form.
 */
export async function openAuth(page: Page, url = '/auth') {
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 15_000 });
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error;
    await expect(page.getByRole('tab', { name: 'Register', exact: true })).toBeVisible({ timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe('/auth');
  }
}

export async function register(page: Page, username = unique('critical'), invitation?: string) {
  await openAuth(page, invitation ? `/auth?invitation=${invitation}&username=${username}` : '/auth');
  await page.getByRole('tab', { name: 'Register', exact: true }).click();
  if (!invitation) await page.locator('#register-username').fill(username);
  await page.locator('#register-password').fill(password);
  await page.locator('#confirm-password').fill(password);
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return username;
}

export async function logout(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
}

export async function login(page: Page, username: string) {
  await openAuth(page);
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}

export async function member(owner: Page, browser: Browser, role: 'editor' | 'viewer') {
  const username = unique(role);
  const response = await owner.request.post('/api/organization/invitations', {
    data: { username, role },
  });
  expect(response.status()).toBe(201);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5080', locale: 'en-US' });
  try {
    const page = await context.newPage();
    await register(page, username, (await response.json()).token);
    return { page, context };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function saveApiTest(page: Page, name: string, url = 'http://127.0.0.1:5081/echo') {
  await page.goto('/dashboard/api-tester');
  await page.getByLabel('Base URL', { exact: true }).fill(url);
  await page.getByRole('button', { name: 'Save Test', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Test Name', { exact: true }).fill(name);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/api-tests') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Save Test', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  await expect(dialog).not.toBeVisible();
  return response.json() as Promise<{ id: number }>;
}

export async function history(page: Page, name: string) {
  await page.goto('/dashboard/api-tester');
  await page.getByRole('tab', { name: 'Saved Tests', exact: true }).click();
  await page.getByRole('button', { name: `History of ${name}`, exact: true }).click();
  await expect(page.getByTestId('publishing-panel')).toBeVisible();
  return page.getByRole('dialog');
}

// Independent authenticator implementation: the test does not import server/mfa or its database.
export function authenticatorCode(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/\s/g, '')]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0'))
    .join('');
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac('sha1', bytes).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}
