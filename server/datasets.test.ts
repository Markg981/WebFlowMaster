import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { privilegedDb } from './db';
import { tests as testsTable } from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';
import { playwrightService } from './playwright-service';

/**
 * Running one test over several rows of data.
 *
 * The same check against twenty inputs could only be expressed by uploading a spreadsheet
 * to the Test Manager, which maps each row to a *different* saved test. There was no way to
 * say "this one test, these twenty inputs" — so the alternative was twenty near-identical
 * tests, and a change to the flow meant editing all twenty.
 */

let server: http.Server;
let baseUrl: string;
let organizationId: number;
let userId: number;
let submitted: string[];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const sku = url.searchParams.get('sku');
    if (sku) submitted.push(sku);
    // One input the system under test refuses, which is the realistic shape of a dataset
    // failure: most rows are fine and one is not.
    const echoed = sku === 'BAD' ? 'REJECTED' : (sku ?? 'none');
    res
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(`<!doctype html><title>t</title><h1 id="echo">${echoed}</h1>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  organizationId = await createTestOrganization('Dataset Org');
  userId = await createTestUser(organizationId, 'dataset-user');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  submitted = [];
  await privilegedDb.delete(testsTable);
});

/** A test that navigates to ?sku=… and asserts the page echoed it back. */
const testWithDataset = (dataset: unknown) =>
  ({
    id: 1,
    userId,
    organizationId,
    projectId: null,
    name: 'echo the sku',
    url: baseUrl,
    sequence: [
      {
        id: 's1',
        action: { id: 'navigate', type: 'navigate', name: 'Go', icon: 'g', description: 'x' },
        targetElement: null,
        value: `${baseUrl}/?sku={{sku}}`,
      },
      {
        id: 's2',
        action: { id: 'assertTextContains', type: 'assertTextContains', name: 'Echo', icon: 'c', description: 'x' },
        targetElement: { id: 'e1', type: 'heading', selector: '#echo', text: '', tag: 'h1', attributes: {} },
        value: '{{sku}}',
      },
    ],
    elements: [],
    preconditions: null,
    dataset,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
    module: null,
    featureArea: null,
    scenario: null,
    component: null,
    priority: 'Medium',
    severity: 'Major',
  }) as never;

describe('a test with a dataset', () => {
  it('runs once per row, with that row bound to the variables', async () => {
    const result = await playwrightService.executeTestSequence(
      testWithDataset([{ sku: 'A-1' }, { sku: 'B-2' }, { sku: 'C-3' }]),
      userId,
    );

    expect(submitted).toEqual(['A-1', 'B-2', 'C-3']);
    expect(result.success).toBe(true);
  }, 120_000);

  it('reports which row failed, not just that something did', async () => {
    const result = await playwrightService.executeTestSequence(
      // The middle row is the one input the target rejects.
      testWithDataset([{ sku: 'A-1' }, { sku: 'BAD' }, { sku: 'C-3' }]),
      userId,
    );

    expect(result.success).toBe(false);
    // "Row 2 of 3" is the difference between a five-minute diagnosis and rerunning the
    // whole set by hand to find out which input broke it.
    const failed = (result.steps ?? []).filter((s) => s.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.some((s) => /row 2/i.test(s.name) || /row 2/i.test(s.details ?? ''))).toBe(true);
  }, 120_000);

  it('keeps going after a row fails, so one bad input does not hide the rest', async () => {
    await playwrightService.executeTestSequence(
      testWithDataset([{ sku: 'A-1' }, { sku: 'BAD' }, { sku: 'C-3' }]),
      userId,
    );

    // The third row still ran. Stopping at the first failure would mean rerunning the whole
    // set to find out whether anything else was broken.
    expect(submitted).toContain('C-3');
  }, 120_000);

  it('runs a test with no dataset exactly once, as before', async () => {
    const result = await playwrightService.executeTestSequence(
      {
        ...(testWithDataset(null) as any),
        sequence: [
          {
            id: 's1',
            action: { id: 'navigate', type: 'navigate', name: 'Go', icon: 'g', description: 'x' },
            targetElement: null,
            value: `${baseUrl}/?sku=fixed`,
          },
        ],
      } as never,
      userId,
    );

    expect(submitted).toEqual(['fixed']);
    expect(result.success).toBe(true);
  }, 60_000);

  it('ignores an empty dataset rather than running zero times', async () => {
    const result = await playwrightService.executeTestSequence(
      {
        ...(testWithDataset([]) as any),
        sequence: [
          {
            id: 's1',
            action: { id: 'navigate', type: 'navigate', name: 'Go', icon: 'g', description: 'x' },
            targetElement: null,
            value: `${baseUrl}/?sku=fixed`,
          },
        ],
      } as never,
      userId,
    );

    // An empty list is a dataset someone started and did not fill in. Running zero times
    // and reporting success would be a green result for a test that never executed.
    expect(submitted).toEqual(['fixed']);
    expect(result.success).toBe(true);
  }, 60_000);
});

describe('the builder preview with a dataset', () => {
  it('runs once per row too, so the preview and the saved test agree', async () => {
    const result = await playwrightService.executeAdhocSequence(
      {
        name: 'preview with rows',
        url: baseUrl,
        elements: [],
        dataset: [{ sku: 'P-1' }, { sku: 'P-2' }],
        sequence: [
          {
            id: 's1',
            action: { id: 'navigate', type: 'navigate', name: 'Go', icon: 'g', description: 'x' },
            targetElement: undefined,
            value: `${baseUrl}/?sku={{sku}}`,
          },
        ],
      } as never,
      userId,
    );

    // A preview that runs once while the saved test runs twice is the same class of
    // divergence as the two step executors: it passes where the real thing fails.
    expect(submitted).toEqual(['P-1', 'P-2']);
    expect(result.success).toBe(true);
  }, 120_000);
});
