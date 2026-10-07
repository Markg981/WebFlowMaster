import { expect, type Page } from '@playwright/test';
import { unique } from './helpers';
import { readMatrixEvidence } from '../shared/matrix-evidence';

export async function createMatrixWebTest(
  page: Page,
  url: string,
  selector: string,
  expected: string,
) {
  const response = await page.request.post('/api/tests', {
    data: {
      name: unique('matrix_web'),
      url,
      elements: [],
      sequence: [
        {
          id: 'assert',
          action: { id: 'assertTextContains', type: 'assertTextContains', name: 'Assert fixture' },
          targetElement: {
            id: 'target',
            selector,
            type: 'heading',
            tag: 'h1',
            text: '',
            attributes: {},
          },
          value: expected,
        },
      ],
    },
  });
  expect(response.status()).toBe(201);
  const test = await response.json();
  expect(
    (await page.request.post(`/api/tests/${test.id}/publish`, { data: {} })).ok(),
  ).toBeTruthy();
  return test;
}

export async function runMatrixPlan(
  page: Page,
  selectedTests: { id: number; type: string }[],
  configuration: Record<string, unknown>,
  expectedCount: number,
) {
  const response = await page.request.post('/api/test-plans', {
    data: {
      name: unique('matrix_plan'),
      selectedTests,
      maxParallelTests: 1,
      captureScreenshots: 'never',
      ...configuration,
    },
  });
  expect(response.status()).toBe(201);
  const plan = await response.json();
  await page.goto(`/test-plan/${plan.id}/run`);
  const started = page.waitForResponse(
    (r) => r.url().endsWith(`/api/run-test-plan/${plan.id}`) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Start Execution', exact: true }).click();
  const start = await started;
  expect(start.ok()).toBeTruthy();
  const id = (await start.json()).data.id;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/test-plan-executions/${id}`);
        expect(response.ok()).toBeTruthy();
        return (await response.json()).status;
      },
      { timeout: 300_000 },
    )
    .toBe('completed');
  const report = await page.request.get(`/api/test-plan-executions/${id}/report`);
  expect(report.ok()).toBeTruthy();
  const data = await report.json();
  const rows: any[] = Object.values(data.testGroupings).flatMap((g: any) =>
    Object.values(g.components).flatMap((c: any) => c.tests),
  );
  expect(rows).toHaveLength(expectedCount);
  for (const row of rows) expect(row.status).toBe('Passed');
  const matrices = rows.flatMap((row) => readMatrixEvidence(row.detailedLog));
  expect(matrices).toHaveLength(expectedCount);
  await page.goto(`/test-plans/${plan.id}/executions/${id}/report`);
  await expect(page.getByText('Requested and effective matrix', { exact: true })).toBeVisible();
  const html = await page.request.get(`/api/test-plan-executions/${id}/export/html`);
  expect(html.ok()).toBeTruthy();
  expect(await html.text()).toContain('Requested and effective matrix');
  const junit = await page.request.get(`/api/test-plan-executions/${id}/junit`);
  expect(junit.ok()).toBeTruthy();
  expect(await junit.text()).toContain('wfm.matrix');
  return { matrices, id };
}
