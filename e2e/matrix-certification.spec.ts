import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { register, unique } from './helpers';
import { createMatrixWebTest, runMatrixPlan } from './matrix-helpers';

// Dedicated command: absent infrastructure fails explicitly, never becomes a green skipped test.
const filename = process.env.WFM_MATRIX_CERTIFICATION_FILE;
if (!filename)
  throw new Error(
    'Set WFM_MATRIX_CERTIFICATION_FILE to the real grid/Appium acceptance configuration. See collaudo/real-matrix-certification.md.',
  );
const configuration = JSON.parse(readFileSync(filename, 'utf8'));
if (
  !configuration.web?.grid ||
  !configuration.web?.machines?.length ||
  !configuration.mobile?.grid ||
  !configuration.mobile?.test?.deviceMatrix?.length
) {
  throw new Error('Certification requires web grid/machines and a mobile grid/test/deviceMatrix.');
}

test('real browser grid: requested OS/version, actual session, report and exports', async ({
  page,
}, info) => {
  await register(page);
  const config = configuration.web;
  const grid = await page.request.post('/api/browser-grids', {
    data: { ...config.grid, name: unique('cert_grid') },
  });
  expect(grid.status()).toBe(201);
  const saved = await createMatrixWebTest(page, config.url, config.selector, config.expected);
  const { matrices } = await runMatrixPlan(
    page,
    [{ id: saved.id, type: 'ui' }],
    {
      browserGridId: (await grid.json()).id,
      testMachinesConfig: config.machines,
    },
    config.machines.length,
  );
  for (const e of matrices) {
    expect(e.route).toBe('grid');
    expect(e.verdict).toBe('matched');
    expect(e.effective.os).toBeTruthy();
    expect(e.effective.osVersion).toBeTruthy();
    expect(e.effective.browserVersion).toBeTruthy();
  }
  await info.attach('grid-matrix', {
    body: JSON.stringify(matrices, null, 2),
    contentType: 'application/json',
  });
});

test('real Appium matrix: devices, steps, actual capabilities and retained report', async ({
  page,
}, info) => {
  await register(page);
  const config = configuration.mobile;
  let agent: ChildProcess | undefined;
  let agentId: string | undefined;
  try {
    const pool = unique('matrix').slice(0, 39);
    if (config.grid.provider === 'local_appium') {
      const created = await page.request.post('/api/agents', {
        data: { name: unique('matrix_agent'), pool },
      });
      expect(created.status()).toBe(201);
      const registration = await created.json();
      const token = registration.token;
      agentId = registration.agent.id;
      agent = spawn(process.execPath, ['dist/wfm-agent.js'], {
        env: { ...process.env, WFM_URL: 'http://127.0.0.1:5080', WFM_AGENT_TOKEN: token },
        stdio: 'ignore',
        windowsHide: true,
      });
      await expect
        .poll(
          async () => {
            const result = await page.request.get('/api/agents');
            const agents = await result.json();
            return (
              agents.agents?.some(
                (a: { pool: string; connected: boolean }) => a.pool === pool && a.connected,
              ) ?? false
            );
          },
          { timeout: 30_000 },
        )
        .toBeTruthy();
    }
    const grid = await page.request.post('/api/browser-grids', {
      data: {
        ...config.grid,
        name: unique('appium_grid'),
        ...(config.grid.provider === 'local_appium' ? { agentPool: pool } : {}),
      },
    });
    expect(grid.status()).toBe(201);
    const saved = await page.request.post('/api/mobile-tests', {
      data: { ...config.test, name: unique('matrix_mobile'), gridId: (await grid.json()).id },
    });
    expect(saved.status()).toBe(201);
    const mobile = await saved.json();
    expect(
      (await page.request.post(`/api/mobile-tests/${mobile.id}/publish`, { data: {} })).ok(),
    ).toBeTruthy();
    const { matrices } = await runMatrixPlan(
      page,
      [{ id: mobile.id, type: 'mobile' }],
      { testMachinesConfig: [] },
      config.test.deviceMatrix.length,
    );
    for (const e of matrices) {
      expect(e.route).toBe('appium');
      expect(e.verdict).toBe('matched');
      expect(e.effective.device).toBeTruthy();
      expect(e.effective.osVersion).toBeTruthy();
    }
    await info.attach('appium-matrix', {
      body: JSON.stringify(matrices, null, 2),
      contentType: 'application/json',
    });
  } finally {
    agent?.kill('SIGTERM');
    if (agentId)
      expect((await page.request.post(`/api/agents/${agentId}/revoke`)).ok()).toBeTruthy();
  }
});
