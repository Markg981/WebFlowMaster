import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { asc, eq } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import { runWithTenant } from '../platform/middleware/tenancy';
import {
  executionUnitAttempts,
  executionUnits,
  reportTestCaseResults,
  testPlanExecutions,
  testPlanSelectedTests,
  testPlans,
  tests as testsTable,
  users,
  type ExecutionUnit,
  type ExecutionUnitAttempt,
  type ReportTestCaseResult,
} from '@shared/schema';
import { evidenceKey } from '@shared/execution-identity';
import { createTestOrganization } from '../tests/factories';

/**
 * Every browser, language, attempt and dataset row keeps its own evidence (audit C07, lot P08).
 *
 * A UI test with three rows of data, in a plan on two browsers and two languages that re-runs a
 * failure once, run for real in Chromium, four units at a time: the first attempt at each unit
 * fails, the second passes. That is four units, eight attempts and twenty-four row slices, and
 * every slice must have its own trace — under a path made of its identity alone — while the rows
 * stay rows of their attempt rather than becoming units of their own. The traces of each first,
 * failed attempt must still be the files they were once the second attempt has run, a late
 * publish must not change them, and an editor must still be able to open them.
 */

const mocks = vi.hoisted(() => ({
  /** The first-attempt traces of each unit, hashed the moment its second attempt starts. */
  firstTraceHashes: new Map<string, string>(),
}));

const sha256 = async (file: string) =>
  createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');

vi.mock('../web/step-executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/step-executor')>();
  return {
    ...actual,
    executeStep: async (...args: Parameters<typeof actual.executeStep>) => {
      const dir = (args[0].artifactDir ?? '').replace(/\\/g, '/');
      // Every row of a first attempt fails, so the plan re-runs the unit.
      if (/\/attempt_1\/row_\d+$/.test(dir))
        return { status: 'failed', error: 'First attempt: the button was not there.' } as Awaited<
          ReturnType<typeof actual.executeStep>
        >;
      // The second attempt's first row: the first attempt's traces, as they were left.
      const second = /^(.*\/units\/(u_[0-9a-f]{24}))\/attempt_2\/row_0$/.exec(dir);
      if (second && !mocks.firstTraceHashes.has(second[2])) {
        mocks.firstTraceHashes.set(second[2], 'pending');
        for (const row of [0, 1, 2]) {
          const rowDir = path.join(second[1], 'attempt_1', `row_${row}`);
          const [trace] = (await fs.readdir(rowDir)).filter((f) => f.endsWith('_trace.zip'));
          mocks.firstTraceHashes.set(`${second[2]}/${row}`, await sha256(path.join(rowDir, trace)));
        }
      }
      return actual.executeStep(...args);
    },
  };
});

const { processTestPlanJob } = await import('./test-execution-service');
const { runUnitDetail } = await import('../reporting/unit-evidence');
const { artifactStore } = await import('../tenancy/artifact-store');

let organizationId: number;
let planId: string;
let executionId: string;
let units: ExecutionUnit[];
let attempts: ExecutionUnitAttempt[];
let results: ReportTestCaseResult[];

beforeAll(async () => {
  organizationId = await createTestOrganization('Evidence Org');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `evidence-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId })
    .returning();
  planId = uuidv4();
  await privilegedDb.insert(testPlans).values({
    id: planId,
    name: 'Checkout matrix',
    userId: user.id,
    organizationId,
    testMachinesConfig: [
      { browserName: 'chromium', headless: true },
      { browserName: 'chromium', headless: true, device: 'Pixel 7' },
    ],
    locales: ['en-US', 'it-IT'],
    captureTrace: 'always',
    reRunOnFailure: 'once',
    maxParallelTests: 4,
  } as any);
  const [test] = await privilegedDb
    .insert(testsTable)
    .values({
      userId: user.id,
      organizationId,
      name: 'Checkout',
      url: 'about:blank',
      sequence: [
        { id: 's1', action: { id: 'executeScript', name: 'Check' }, value: 'return "{{sku}}";' },
      ],
      elements: [],
      dataset: [{ sku: 'A-1' }, { sku: 'B-2' }, { sku: 'C-3' }],
    } as any)
    .returning();
  await privilegedDb
    .insert(testPlanSelectedTests)
    .values({ testPlanId: planId, testType: 'ui', testId: test.id, organizationId } as any);

  executionId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId,
    organizationId,
    testPlanId: planId,
    status: 'queued',
    triggeredBy: 'manual',
  } as any);
  await processTestPlanJob(planId, executionId, user.id);

  units = await privilegedDb
    .select()
    .from(executionUnits)
    .where(eq(executionUnits.executionId, executionId))
    .orderBy(asc(executionUnits.position));
  attempts = await privilegedDb
    .select()
    .from(executionUnitAttempts)
    .where(eq(executionUnitAttempts.executionId, executionId))
    .orderBy(asc(executionUnitAttempts.unitId), asc(executionUnitAttempts.attempt));
  results = await privilegedDb
    .select()
    .from(reportTestCaseResults)
    .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
}, 300_000);

afterAll(async () => {
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

const local = (url: string) => path.resolve(process.cwd(), url.replace(/^\//, ''));

describe('a dataset test on two browsers and two languages, passing on its re-run', () => {
  it('is four units and eight attempts: the rows stay rows of their attempt', () => {
    expect(units).toHaveLength(4);
    expect(
      new Set(units.map((u) => `${u.coordinates.browser?.device}|${u.coordinates.locale}`)),
    ).toEqual(new Set(['null|en-US', 'null|it-IT', 'Pixel 7|en-US', 'Pixel 7|it-IT']));
    expect(units.every((u) => u.coordinates.bddRow === null)).toBe(true);
    expect(attempts.map((a) => [a.attempt, a.status])).toEqual(
      units.flatMap(() => [
        [1, 'failed'],
        [2, 'passed'],
      ]),
    );
    // One result per unit, standing on its second attempt.
    expect(results).toHaveLength(4);
    for (const result of results)
      expect(result).toMatchObject({ status: 'Passed', attempts: 2, unitAttempt: 2 });
  });

  it('keeps twenty-four row slices, each under a path made of its identity alone', async () => {
    const traces: string[] = [];
    for (const attempt of attempts) {
      expect(attempt.evidence?.rows?.map((row) => row.datasetRow)).toEqual([0, 1, 2]);
      for (const row of attempt.evidence!.rows!) {
        expect(row.status).toBe(attempt.attempt === 1 ? 'failed' : 'passed');
        const slice = evidenceKey(planId, {
          executionId,
          unitId: attempt.unitId,
          attempt: attempt.attempt,
          datasetRow: row.datasetRow,
        });
        expect(path.posix.dirname(row.traceUrl!)).toBe(`/${slice}`);
        expect(await fs.pathExists(local(row.traceUrl!))).toBe(true);
        traces.push(row.traceUrl!);
      }
      // A failed attempt says why, on its own record.
      if (attempt.attempt === 1) expect(attempt.failureReason).toMatch(/button was not there/);
    }
    expect(traces).toHaveLength(24);
    expect(new Set(traces).size).toBe(24);
    // No dataset value in any path.
    expect(traces.join(' ')).not.toMatch(/A-1|B-2|C-3/);
  });

  it('leaves each first attempt’s traces as they were, and a late publish changes nothing', async () => {
    for (const unit of units)
      for (const row of [0, 1, 2]) {
        const before = mocks.firstTraceHashes.get(`${unit.unitId}/${row}`);
        expect(before).toMatch(/^[0-9a-f]{64}$/);
        const first = attempts.find((a) => a.unitId === unit.unitId && a.attempt === 1)!;
        const traceUrl = first.evidence!.rows![row].traceUrl!;
        expect(await sha256(local(traceUrl))).toBe(before);
      }

    // A worker that lost its claim publishing the same attempt again, after the report linked it.
    const first = attempts.find((a) => a.attempt === 1)!;
    const key = first.evidence!.rows![0].traceUrl!.replace(/^\//, '');
    const before = await sha256(local(key));
    await runWithTenant(organizationId, () =>
      artifactStore().write(key, Buffer.from('a late, different trace')),
    );
    expect(await sha256(local(key))).toBe(before);
  });

  it('still opens the first failure for an editor, and withholds its trace from a viewer', async () => {
    const unit = units[0];
    const asEditor = await runWithTenant(organizationId, () =>
      runUnitDetail(executionId, unit.unitId, { role: 'editor' }, 'session'),
    );
    expect(asEditor?.evidence.decidingAttempt).toBe(2);
    const firstFailure = asEditor!.evidence.attempts[0];
    expect(firstFailure).toMatchObject({ attempt: 1, status: 'failed', restricted: false });
    expect(firstFailure.rows).toHaveLength(3);
    for (const row of firstFailure.rows)
      expect(row.traceUrl).toMatch(
        new RegExp(
          `^/api/test-plan-executions/${executionId}/artifacts/units/${unit.unitId}/attempt_1/row_${row.datasetRow}/`,
        ),
      );
    const opened = await runWithTenant(organizationId, () =>
      artifactStore().open(
        `results/${planId}/${executionId}/units/${unit.unitId}/attempt_1/row_0/${path.posix.basename(firstFailure.rows[0].traceUrl!)}`,
      ),
    );
    expect(opened).not.toBeNull();
    opened?.stream.destroy();

    const asViewer = await runWithTenant(organizationId, () =>
      runUnitDetail(executionId, unit.unitId, { role: 'viewer' }, 'session'),
    );
    expect(asViewer!.evidence.attempts[0].rows.every((row) => row.traceUrl === null)).toBe(true);
    expect(asViewer!.evidence.attempts[0].rows.every((row) => row.restricted)).toBe(true);
  });
});
