import { test, expect } from '@playwright/test';
import { login, register } from './helpers';

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

test('authentication uses the interactive form while DOMContentLoaded is held by a deferred script', async ({
  page,
}) => {
  test.setTimeout(20_000);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/delayed-deferred.js', async (route) => {
    await delayed;
    await route.fulfill({ contentType: 'text/javascript', body: '' });
  });
  await page.route('**/auth', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><head><script defer src="/delayed-deferred.js"></script></head><body>
      <button role="tab">Register</button>
      <input id="register-username"><input id="register-password"><input id="confirm-password">
      <button onclick="history.pushState({}, '', '/dashboard')">Create Account</button>
      <input id="login-username"><input id="login-password">
      <button onclick="history.pushState({}, '', '/dashboard')">Sign In</button>
      </body></html>`,
    }),
  );
  try {
    await register(page, 'deferred_navigation_regression');
    await expect(page.locator('#register-username')).toHaveValue('deferred_navigation_regression');
    // The form was usable before document lifecycle readiness, just as in the CI snapshot.
    expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
    await login(page, 'deferred_navigation_regression');
    await expect(page.locator('#login-username')).toHaveValue('deferred_navigation_regression');
    await expect(page).toHaveURL(/\/dashboard$/);
  } finally {
    release();
  }
});
