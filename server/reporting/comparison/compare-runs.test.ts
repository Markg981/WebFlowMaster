import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { PNG } from 'pngjs';
import { privilegedDb } from '../../platform/db';
import {
  comparisonKnownDifferences,
  comparisonResults,
  comparisonRuns,
  executionUnits,
  reportTestCaseResults,
  testPlanExecutions,
  testPlans,
  users,
  type ComparisonRun,
} from '@shared/schema';
import type { UnitCoordinates } from '@shared/execution-identity';
import { createTestOrganization } from '../../tests/factories';
import { runWithTenant, withTenantTransaction } from '../../platform/middleware/tenancy';
import { createCompareRuns, storedScreenshotLoader } from './compare-runs';

/**
 * The engine against stored results: two runs of one plan, paired by their units, compared, and
 * written as one row per test in the caller's transaction.
 */

let organizationId: number;
let planId: string;
let baselineId: string;
let candidateId: string;

const coordinates = (testId: number, bddRow: number | null = null): UnitCoordinates => ({
  testType: 'ui',
  testId,
  occurrence: 0,
  browser: { name: 'chromium', channel: null, device: null },
  locale: null,
  device: null,
  bddRow,
});

function png(dark: number): string {
  const image = new PNG({ width: 10, height: 10 });
  for (let i = 0; i < 100; i += 1)
    image.data.set(i < dark ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  return `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`;
}

const textStep = (texts: string[], extra: Record<string, unknown> = {}) => ({
  name: 'Read total',
  type: 'checkpointText',
  stepId: 'total',
  status: 'passed',
  checkpoint: { name: 'total', kind: 'text', data: { texts }, hash: texts.join('|') },
  ...extra,
});

async function seedRun(executionId: string) {
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId,
    organizationId,
    testPlanId: planId,
    status: 'completed',
    triggeredBy: 'manual',
    startedAt: new Date(),
  } as any);
}

async function seedResult(
  executionId: string,
  unit: { id: string; coordinates: UnitCoordinates; position: number } | null,
  values: Partial<typeof reportTestCaseResults.$inferInsert>,
) {
  if (unit)
    await privilegedDb.insert(executionUnits).values({
      executionId,
      organizationId,
      unitId: unit.id,
      position: unit.position,
      coordinates: unit.coordinates,
      state: 'recorded',
    });
  await privilegedDb.insert(reportTestCaseResults).values({
    id: uuidv4(),
    organizationId,
    testPlanExecutionId: executionId,
    testType: 'ui',
    testName: 'test',
    browser: 'chromium',
    status: 'Passed',
    startedAt: new Date(),
    executionUnitId: unit?.id ?? null,
    ...values,
  });
}

async function comparison(policy: Record<string, unknown> = {}): Promise<ComparisonRun> {
  const [row] = await privilegedDb
    .insert(comparisonRuns)
    .values({
      id: uuidv4(),
      organizationId,
      testPlanId: planId,
      baselineEnvironmentName: 'prod',
      candidateEnvironmentName: 'staging',
      baselineExecutionId: baselineId,
      candidateExecutionId: candidateId,
      status: 'comparing',
      policy,
    })
    .returning();
  return row;
}

const compute = (row: ComparisonRun) =>
  runWithTenant(organizationId, () => withTenantTransaction((tx) => createCompareRuns()(tx, row)));

const unitId = (n: number) => `u_${String(n).padStart(24, '0')}`;

beforeEach(async () => {
  organizationId = await createTestOrganization('Comparison engine');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `engine-${uuidv4().slice(0, 8)}`, password: 'x', organizationId })
    .returning();
  planId = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id: planId, name: 'Parity', userId: user.id, organizationId } as any);
  baselineId = uuidv4();
  candidateId = uuidv4();
  await seedRun(baselineId);
  await seedRun(candidateId);
});

describe('createCompareRuns', () => {
  it('pairs dataset rows by their unit coordinates and reaches a verdict per test and overall', async () => {
    // Row 0 matches; row 1's total changed on the candidate; an API test ran on the baseline only.
    await seedResult(
      baselineId,
      { id: unitId(1), coordinates: coordinates(1, 0), position: 0 },
      {
        module: 'Billing',
        detailedLog: JSON.stringify([textStep(['10,00'])]),
      },
    );
    await seedResult(
      baselineId,
      { id: unitId(2), coordinates: coordinates(1, 1), position: 1 },
      {
        module: 'Billing',
        detailedLog: JSON.stringify([textStep(['20,00'])]),
      },
    );
    await seedResult(baselineId, null, { testType: 'api', browser: null, testName: 'ping' });
    await seedResult(
      candidateId,
      { id: unitId(4), coordinates: coordinates(1, 1), position: 0 },
      {
        module: 'Billing',
        detailedLog: JSON.stringify([textStep(['21,00'])]),
      },
    );
    await seedResult(
      candidateId,
      { id: unitId(3), coordinates: coordinates(1, 0), position: 1 },
      {
        module: 'Billing',
        detailedLog: JSON.stringify([textStep(['10.00'])]),
      },
    );

    const row = await comparison();
    const { verdict, summary } = await compute(row);

    expect(verdict).toBe('regressions');
    expect(summary.total).toBe(3);
    expect(summary.byVerdict).toMatchObject({ identical: 1, different: 1, not_comparable: 1 });
    expect(summary.byModule).toEqual([
      expect.objectContaining({ module: '', total: 1 }),
      expect.objectContaining({ module: 'Billing', total: 2 }),
    ]);

    const stored = await privilegedDb
      .select()
      .from(comparisonResults)
      .where(eq(comparisonResults.comparisonRunId, row.id));
    expect(stored).toHaveLength(3);
    const different = stored.find((r) => r.verdict === 'different')!;
    expect(different.differences).toEqual([
      expect.objectContaining({
        checkpoint: 'total',
        path: 'texts[0]',
        baseline: '20,00',
        candidate: '21,00',
      }),
    ]);
    expect(stored.find((r) => r.verdict === 'not_comparable')!.candidateResultId).toBeNull();
  });

  it('reports an outcome mismatch and a visual change, and stays informative on the image', async () => {
    const unit = { id: unitId(1), coordinates: coordinates(1), position: 0 };
    await seedResult(baselineId, unit, {
      detailedLog: JSON.stringify([{ stepId: 'a', status: 'passed', screenshot: png(0) }]),
    });
    await seedResult(
      candidateId,
      { ...unit, id: unitId(2) },
      {
        detailedLog: JSON.stringify([{ stepId: 'a', status: 'passed', screenshot: png(40) }]),
      },
    );
    await seedResult(baselineId, { id: unitId(3), coordinates: coordinates(2), position: 1 }, {});
    await seedResult(
      candidateId,
      { id: unitId(4), coordinates: coordinates(2), position: 1 },
      {
        status: 'Failed',
      },
    );

    const { verdict, summary } = await compute(await comparison());
    expect(verdict).toBe('regressions');
    expect(summary.byVerdict).toMatchObject({ equivalent: 1, outcome_mismatch: 1 });
  });

  it('writes nothing twice when a computation is repeated, and calls identical runs parity', async () => {
    const unit = { id: unitId(1), coordinates: coordinates(1), position: 0 };
    await seedResult(baselineId, unit, { detailedLog: JSON.stringify([textStep(['ok'])]) });
    await seedResult(
      candidateId,
      { ...unit, id: unitId(2) },
      {
        detailedLog: JSON.stringify([textStep(['ok'])]),
      },
    );
    const row = await comparison();
    await compute(row);
    const second = await compute(row);
    expect(second.verdict).toBe('parity');
    const stored = await privilegedDb
      .select()
      .from(comparisonResults)
      .where(eq(comparisonResults.comparisonRunId, row.id));
    expect(stored).toHaveLength(1);
  });

  it('compares tables and calls, and recognises the known differences on the next comparison', async () => {
    const steps = (total: string, status: number) =>
      JSON.stringify([
        {
          stepId: 'grid',
          status: 'passed',
          checkpoint: {
            name: 'orders',
            kind: 'table',
            data: { rows: [['ORD-1', total]] },
            hash: total,
          },
        },
        {
          stepId: 'calls',
          status: 'passed',
          checkpoint: {
            name: 'api',
            kind: 'network',
            data: {
              entries: [
                { method: 'GET', path: '/api/orders', query: [], requestBodyHash: null, status },
              ],
            },
            hash: String(status),
          },
        },
      ]);
    const unit = { id: unitId(1), coordinates: coordinates(1), position: 0 };
    await seedResult(baselineId, unit, { detailedLog: steps('10.00', 200) });
    await seedResult(candidateId, { ...unit, id: unitId(2) }, { detailedLog: steps('10.01', 204) });

    const first = await compute(await comparison());
    expect(first.summary.byVerdict).toMatchObject({ different: 1 });

    const [cell, status] = [uuidv4(), uuidv4()];
    await privilegedDb.insert(comparisonKnownDifferences).values([
      { id: cell, organizationId, kind: 'table', pathPattern: 'rows[*][1]', reason: 'rounding' },
      {
        id: status,
        organizationId,
        kind: 'network',
        checkpointName: 'api',
        pathPattern: 'requests[*].status',
        reason: 'No content now',
      },
    ]);
    const row = await comparison();
    const second = await compute(row);
    expect(second.summary.byVerdict).toMatchObject({ equivalent: 1 });
    const [stored] = await privilegedDb
      .select()
      .from(comparisonResults)
      .where(eq(comparisonResults.comparisonRunId, row.id));
    expect(stored.differences.map((d) => [d.path, d.knownDifferenceId])).toEqual([
      ['rows[0][1]', cell],
      ['requests[GET /api/orders].status', status],
    ]);
  });
});

describe('storedScreenshotLoader', () => {
  it('reads a data URI itself and refuses a path outside the run directory', async () => {
    const load = storedScreenshotLoader({
      baseline: { executionId: 'run-a', planId: 'plan' },
      candidate: { executionId: 'run-b', planId: 'plan' },
    });
    const image = await load('baseline', png(0));
    expect(image && PNG.sync.read(image).width).toBe(10);
    expect(await load('candidate', 'C:\\elsewhere\\step.png')).toBeNull();
    expect(await load('candidate', '/results/plan/run-a/units/x/step.png')).toBeNull();
  });
});
