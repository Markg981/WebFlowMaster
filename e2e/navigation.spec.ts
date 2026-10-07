import { test, expect } from '@playwright/test';
import { register } from './helpers';

test('registration proceeds when a nonessential image has not finished loading', async ({
  page,
}) => {
  test.setTimeout(20_000);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/slow-decoration.png', async (route) => {
    await delayed;
    await route.abort();
  });
  await page.route('**/auth', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body><img src="/slow-decoration.png">
      <button role="tab">Register</button>
      <input id="register-username"><input id="register-password"><input id="confirm-password">
      <button onclick="history.pushState({}, '', '/dashboard')">Create Account</button>
      </body></html>`,
    }),
  );
  try {
    await register(page, 'navigation_regression');
    await expect(page.locator('#register-username')).toHaveValue('navigation_regression');
  } finally {
    release();
  }
});
