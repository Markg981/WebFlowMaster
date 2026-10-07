import { test, expect } from '@playwright/test';
import { register } from './helpers';
import { createMatrixWebTest, runMatrixPlan } from './matrix-helpers';

test('a saved UI plan executes Chromium, Firefox and WebKit and retains actual configuration', async ({
  page,
}, info) => {
  // This journey launches three real target browsers in addition to the UI browser.
  test.setTimeout(180_000);
  await register(page);
  const saved = await createMatrixWebTest(
    page,
    'http://127.0.0.1:5081/matrix',
    '#matrix-title',
    'Matrix fixture',
  );
  const { matrices } = await runMatrixPlan(
    page,
    [{ id: saved.id, type: 'ui' }],
    {
      testMachinesConfig: ['chromium', 'firefox', 'webkit'].map((browserName) => ({
        browserName,
        headless: true,
      })),
    },
    3,
  );
  expect(matrices.map((e) => e.effective.browser).sort()).toEqual([
    'chromium',
    'firefox',
    'webkit',
  ]);
  for (const e of matrices) {
    expect(e.route).toBe('local');
    expect(e.verdict).toBe('matched');
    expect(e.effective.browserVersion).toBeTruthy();
    expect(e.effective.os).toBeTruthy();
  }
  await info.attach('runtime-matrix', {
    body: JSON.stringify(matrices, null, 2),
    contentType: 'application/json',
  });
});
