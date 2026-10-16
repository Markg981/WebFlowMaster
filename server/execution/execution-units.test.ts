import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  type ReportTestCaseResult,
  type Test,
} from '@shared/schema';
import { evidenceKey, isUnitId } from '@shared/execution-identity';
import { MANUAL_STEP_ACTION_ID } from '@shared/manual-tests';
import type { BrowserChoice } from '../runtime/browsers';
import { createTestOrganization } from '../tests/factories';
import type { FrozenTests, TestLink } from './plan-run/definitions';
import {
  AttemptRefusedError,
  ManifestMismatchError,
  beginAttempt,
  finishAttempt,
  planManifest,
  unaccountedUnits,
  unitReport,
  writeManifest,
  type PassTarget,
} from './execution-units';

/**
 * Which unit a result belongs to is written down before the run starts, never worked out after
 * (audit C02/C07/C08, lot P07). Two occurrences of one test, two browsers or channels, two
 * languages, two devices and two BDD rows are five different units; a browser that would not start
 * is still owed its units; and a result names its unit rather than its position or its name.
 */

const executeTestSequence = vi.fn();
vi.mock('../web/playwright-service', () => ({
  playwrightService: { executeTestSequence: (...args: any[]) => executeTestSequence(...args) },
}));
vi.mock('../runtime/precondition-runner', () => ({
  runPreconditions: async () => ({ ok: true, steps: [] }),
}));

const { processTestPlanJob } = await import('./test-execution-service');

const chromium = { label: 'chromium', engine: 'chromium', headless: true } as BrowserChoice;
const chrome = {
  label: 'chrome',
  name: 'chrome',
  engine: 'chromium',
  channel: 'chrome',
  headless: true,
} as BrowserChoice;
const firefox = { label: 'firefox', engine: 'firefox', headless: true } as BrowserChoice;

const ui = (testId: number): TestLink => ({ testType: 'ui', testId, apiTestId: null });
const api = (apiTestId: number): TestLink => ({ testType: 'api', testId: null, apiTestId });
const mobile = (mobileTestId: number): TestLink => ({
  testType: 'mobile',
  testId: null,
  apiTestId: null,
  mobileTestId,
});
const uiTest = (id: number, extra: Partial<Test> = {}) =>
  ({ id, name: `UI ${id}`, sequence: [], ...extra }) as Test;
const cucumberTest = (id: number, rows: Array<Record<string, string>>) =>
  uiTest(id, { bdd: { mode: 'cucumber' } as Test['bdd'], dataset: rows as Test['dataset'] });

function frozen(
  links: TestLink[],
  uiTests: Test[] = [],
  mobileTests: Array<{ id: number; deviceName?: string; deviceMatrix?: unknown[] }> = [],
): Pick<FrozenTests, 'links' | 'ui' | 'mobile'> {
  return {
    links,
    ui: new Map(uiTests.map((t) => [t.id, t])),
    mobile: new Map(
      mobileTests.map((t) => [
        t.id,
        { test: { id: t.id, name: `Mobile ${t.id}`, ...t } as never, grid: null },
      ]),
    ),
  };
}

const started = (...passes: BrowserChoice[]): PassTarget[] =>
  passes.map((pass) => ({ requested: pass, started: pass }));

const ids = (manifest: ReturnType<typeof planManifest>) =>
  manifest.entries.map((entry) => entry.unitId);

describe('planManifest: one identity per unit', () => {
  it('two occurrences of the same test are two units', () => {
    const plan = frozen([ui(1), api(2), ui(1)], [uiTest(1)]);
    const manifest = planManifest('run-1', plan, started(chromium), null);

    expect(manifest.entries.map((e) => [e.coordinates.testId, e.coordinates.occurrence])).toEqual([
      [1, 0],
      [2, 0],
      [1, 1],
    ]);
    expect(new Set(ids(manifest)).size).toBe(3);
  });

  it('browsers, channels and languages are each their own unit', () => {
    const manifest = planManifest(
      'run-1',
      frozen([ui(1)], [uiTest(1)]),
      started(chromium, chrome, firefox),
      ['en', 'it'],
    );

    expect(manifest.entries).toHaveLength(6);
    expect(new Set(ids(manifest)).size).toBe(6);
    expect(
      manifest.entries.map((e) => [e.coordinates.browser?.channel, e.coordinates.locale]),
    ).toEqual([
      [null, 'en'],
      [null, 'it'],
      ['chrome', 'en'],
      ['chrome', 'it'],
      [null, 'en'],
      [null, 'it'],
    ]);
  });

  it('a mobile test on two devices is two units', () => {
    const manifest = planManifest(
      'run-1',
      frozen(
        [mobile(5)],
        [],
        [{ id: 5, deviceMatrix: [{ deviceName: 'Pixel 8' }, { deviceName: 'iPhone 15' }] }],
      ),
      started(chromium),
      null,
    );
    expect(manifest.entries.map((e) => e.coordinates.device)).toEqual(['device-0', 'device-1']);
    expect(new Set(ids(manifest)).size).toBe(2);
  });

  it('each BDD row is a unit, named by its index and never by its values', () => {
    const manifest = planManifest(
      'run-1',
      frozen([ui(3)], [cucumberTest(3, [{ user: 'alice' }, { user: 's3cr3t-value' }])]),
      [{ requested: undefined, started: undefined }],
      null,
    );
    expect(manifest.entries.map((e) => e.coordinates.bddRow)).toEqual([0, 1]);
    expect(new Set(ids(manifest)).size).toBe(2);
    expect(JSON.stringify(manifest.entries)).not.toMatch(/alice|s3cr3t/);
  });

  it('is stable for the same run and opaque, and not a fingerprint across runs', () => {
    const plan = frozen([ui(1), ui(1)], [uiTest(1)]);
    const first = planManifest('run-1', plan, started(chromium, firefox), ['en']);
    const again = planManifest('run-1', plan, started(chromium, firefox), ['en']);
    const other = planManifest('run-2', plan, started(chromium, firefox), ['en']);

    expect(ids(again)).toEqual(ids(first));
    expect(ids(first).every(isUnitId)).toBe(true);
    expect(ids(other).some((id) => ids(first).includes(id))).toBe(false);
  });

  it('carries the ids into the lanes without changing their order or their captures', () => {
    const plan = frozen([ui(1), api(2)], [uiTest(1)]);
    const manifest = planManifest('run-1', plan, started(chromium, firefox), ['en', 'it']);

    expect(manifest.lanes.map((lane) => [lane.browserChoice?.label, lane.captured])).toEqual([
      ['chromium', { locale: 'en' }],
      ['chromium', { locale: 'it' }],
      ['firefox', { locale: 'en' }],
      ['firefox', { locale: 'it' }],
    ]);
    expect(manifest.lanes.flatMap((lane) => lane.units.map((unit) => unit.unitId))).toEqual(
      ids(manifest),
    );
    // Each lane still has its own captured values.
    manifest.lanes[0].captured.token = 'chromium-en';
    expect(manifest.lanes[1].captured.token).toBeUndefined();
    // And the link object, which shared runs index by, is the plan's own.
    expect(manifest.lanes[0].units[0].link).toBe(plan.links[0]);
  });

  it('two requests for the very same browser do not collide', () => {
    const manifest = planManifest(
      'run-1',
      frozen([ui(1)], [uiTest(1)]),
      started(chromium, { ...chromium }),
      null,
    );
    expect(new Set(ids(manifest)).size).toBe(2);
    expect(manifest.entries[1].coordinates.duplicate).toBe(1);
  });
});

describe('planManifest: what the plan asked for, not only what started', () => {
  it('expects the units of a browser that would not start, with the reason', () => {
    const plan = frozen(
      [ui(1), ui(2), mobile(3)],
      [uiTest(1), uiTest(2)],
      [{ id: 3, deviceName: 'Pixel 8' }],
    );
    const manifest = planManifest(
      'run-1',
      plan,
      [
        { requested: chromium, started: chromium },
        { requested: firefox, started: null, failure: 'firefox is not installed' },
      ],
      null,
    );

    expect(
      manifest.entries.map((e) => [
        e.coordinates.browser?.name ?? null,
        e.coordinates.testId,
        e.state,
      ]),
    ).toEqual([
      ['chromium', 1, 'planned'],
      ['chromium', 2, 'planned'],
      [null, 3, 'planned'],
      ['firefox', 1, 'not_startable'],
      ['firefox', 2, 'not_startable'],
    ]);
    expect(manifest.entries.at(-1)?.reason).toBe('firefox is not installed');
    // Only what can run is in the lanes.
    expect(manifest.lanes).toHaveLength(1);
  });

  it('names a fallback by the browser that was asked for', () => {
    const plan = frozen([ui(1)], [uiTest(1)]);
    const asked = planManifest('run-1', plan, started(chrome), null);
    const fellBack = planManifest(
      'run-1',
      plan,
      [{ requested: chrome, started: { ...chrome, channel: undefined } }],
      null,
    );
    expect(ids(fellBack)).toEqual(ids(asked));
    expect(fellBack.entries[0].coordinates.browser?.channel).toBe('chrome');
  });

  it('when no browser starts, still expects all of them', () => {
    const manifest = planManifest(
      'run-1',
      frozen([ui(1)], [uiTest(1)]),
      [
        { requested: chromium, started: null, failure: 'no display' },
        { requested: firefox, started: null, failure: 'no display' },
      ],
      ['en'],
    );
    expect(manifest.lanes).toEqual([]);
    expect(manifest.entries.map((e) => e.state)).toEqual(['not_startable', 'not_startable']);
  });
});

describe('evidenceKey', () => {
  it('is made of ids and numbers only', () => {
    const [unit] = planManifest(
      'run-1',
      frozen([ui(1)], [uiTest(1)]),
      started(chromium),
      null,
    ).entries;
    expect(
      evidenceKey('plan-9', {
        executionId: 'run-1',
        unitId: unit.unitId,
        attempt: 2,
        datasetRow: 3,
      }),
    ).toBe(`results/plan-9/run-1/units/${unit.unitId}/attempt_2/row_3`);
    expect(() =>
      evidenceKey('p', { executionId: 'r', unitId: '../x', attempt: 1, datasetRow: null }),
    ).toThrow();
    expect(() =>
      evidenceKey('p', { executionId: 'r', unitId: unit.unitId, attempt: 0, datasetRow: null }),
    ).toThrow();
  });
});

describe('unitReport: legacy and new rows in one model', () => {
  const row = (extra: Partial<ReportTestCaseResult>) =>
    ({
      id: uuidv4(),
      testName: 'Login',
      status: 'Passed',
      executionUnitId: null,
      ...extra,
    }) as ReportTestCaseResult;

  it('puts results under their unit, and never matches a legacy row to one', () => {
    const units = [
      {
        unitId: 'u_b',
        position: 1,
        state: 'not_startable' as const,
        coordinates: {} as never,
        reason: 'x',
      },
      {
        unitId: 'u_a',
        position: 0,
        state: 'recorded' as const,
        coordinates: {} as never,
        reason: null,
      },
    ];
    const recorded = row({ executionUnitId: 'u_a' });
    const legacy = row({ testName: 'Login' });

    const report = unitReport(units, [legacy, recorded]);

    expect(report.map((entry) => [entry.unitId, entry.state, entry.result?.id ?? null])).toEqual([
      ['u_a', 'recorded', recorded.id],
      ['u_b', 'not_startable', null],
      [null, 'legacy', legacy.id],
    ]);
    expect(unaccountedUnits(report).map((entry) => entry.unitId)).toEqual(['u_b']);
  });

  it('reads a run from before the manifest as it always was', () => {
    const report = unitReport([], [row({}), row({})]);
    expect(report.every((entry) => entry.state === 'legacy')).toBe(true);
    expect(unaccountedUnits(report)).toEqual([]);
  });
});

// ─── The database ───────────────────────────────────────────────────────────

let organizationId: number;
let otherOrganizationId: number;
let userId: number;
let planId: string;

async function seedExecution(org: number, plan: string) {
  const executionId = uuidv4();
  await privilegedDb.insert(testPlanExecutions).values({
    id: executionId,
    organizationId: org,
    testPlanId: plan,
    status: 'queued',
    triggeredBy: 'manual',
  } as any);
  return executionId;
}

async function seedPlan(org: number, user: number, extra: Record<string, unknown> = {}) {
  const id = uuidv4();
  await privilegedDb
    .insert(testPlans)
    .values({ id, name: 'Nightly', userId: user, organizationId: org, ...extra } as any);
  return id;
}

const asOrg = <T>(org: number, fn: () => Promise<T>) => runWithTenant(org, fn);

const manifestOf = (executionId: string) =>
  planManifest(
    executionId,
    frozen([ui(1), ui(2)], [uiTest(1), uiTest(2)]),
    [
      { requested: chromium, started: chromium },
      { requested: firefox, started: null, failure: 'firefox is not installed' },
    ],
    null,
  );

beforeEach(async () => {
  organizationId = await createTestOrganization('Units Org');
  otherOrganizationId = await createTestOrganization('Other Units Org');
  const [user] = await privilegedDb
    .insert(users)
    .values({ username: `units-${uuidv4().slice(0, 8)}`, password: 'hashed', organizationId })
    .returning();
  userId = user.id;
  planId = await seedPlan(organizationId, userId);
  executeTestSequence.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (planId) await fs.remove(path.resolve(process.cwd(), 'results', planId));
});

describe('writeManifest', () => {
  it('writes every expected unit once, and refuses a different manifest', async () => {
    const executionId = await seedExecution(organizationId, planId);
    const manifest = manifestOf(executionId);

    await asOrg(organizationId, () => writeManifest(executionId, organizationId, manifest.entries));
    await asOrg(organizationId, () => writeManifest(executionId, organizationId, manifest.entries));

    const rows = await privilegedDb
      .select()
      .from(executionUnits)
      .where(eq(executionUnits.executionId, executionId))
      .orderBy(asc(executionUnits.position));
    expect(rows.map((r) => [r.unitId, r.state])).toEqual(
      manifest.entries.map((e) => [e.unitId, e.state]),
    );

    await expect(
      asOrg(organizationId, () =>
        writeManifest(executionId, organizationId, manifest.entries.slice(1)),
      ),
    ).rejects.toBeInstanceOf(ManifestMismatchError);
  });
});

describe('attempts', () => {
  it('are numbered 1, 2… and only for a unit of the manifest that still owes its result', async () => {
    const executionId = await seedExecution(organizationId, planId);
    const manifest = manifestOf(executionId);
    await asOrg(organizationId, () => writeManifest(executionId, organizationId, manifest.entries));
    const [planned, , blocked] = manifest.entries;
    const ref = { executionId, unitId: planned.unitId };

    const first = await asOrg(organizationId, () => beginAttempt(ref));
    await asOrg(organizationId, () => finishAttempt(first, 'failed'));
    const second = await asOrg(organizationId, () => beginAttempt(ref));
    expect([first.attempt, second.attempt]).toEqual([1, 2]);

    await expect(
      asOrg(organizationId, () =>
        beginAttempt({ executionId, unitId: 'u_000000000000000000000000' }),
      ),
    ).rejects.toBeInstanceOf(AttemptRefusedError);
    await expect(
      asOrg(organizationId, () => beginAttempt({ executionId, unitId: blocked.unitId })),
    ).rejects.toThrow(/not startable/);
    // Another organization cannot see the unit at all.
    await expect(asOrg(otherOrganizationId, () => beginAttempt(ref))).rejects.toThrow(
      /not in the run/,
    );
  });
});

describe('tenancy and integrity', () => {
  async function insertUnit(executionId: string, org: number, unitId: string, position = 0) {
    await privilegedDb.insert(executionUnits).values({
      executionId,
      organizationId: org,
      unitId,
      position,
      coordinates: {} as never,
    });
  }
  const unitA = 'u_aaaaaaaaaaaaaaaaaaaaaaaa';

  it('refuses a unit, attempt or result pointing across organizations', async () => {
    const executionId = await seedExecution(organizationId, planId);
    // A unit of organization B on a run of organization A.
    await expect(insertUnit(executionId, otherOrganizationId, unitA)).rejects.toThrow();

    await insertUnit(executionId, organizationId, unitA);
    await expect(
      privilegedDb.insert(executionUnitAttempts).values({
        executionId,
        organizationId: otherOrganizationId,
        unitId: unitA,
        attempt: 1,
      }),
    ).rejects.toThrow();

    // A result of organization B's run claiming organization A's unit.
    const otherPlan = await seedPlan(otherOrganizationId, userId);
    const otherExecution = await seedExecution(otherOrganizationId, otherPlan);
    await expect(
      privilegedDb.insert(reportTestCaseResults).values({
        id: uuidv4(),
        organizationId: otherOrganizationId,
        testPlanExecutionId: otherExecution,
        testType: 'ui',
        testName: 'Login',
        status: 'Passed',
        startedAt: new Date(),
        executionUnitId: unitA,
      }),
    ).rejects.toThrow();
  });

  it('refuses a malformed unit id and an attempt below 1', async () => {
    const executionId = await seedExecution(organizationId, planId);
    await expect(insertUnit(executionId, organizationId, 'Login on chromium')).rejects.toThrow();
    await insertUnit(executionId, organizationId, unitA);
    await expect(
      privilegedDb
        .insert(executionUnitAttempts)
        .values({ executionId, organizationId, unitId: unitA, attempt: 0 }),
    ).rejects.toThrow();
  });

  it('keeps one final result per unit, and accepts results with no unit', async () => {
    const executionId = await seedExecution(organizationId, planId);
    await insertUnit(executionId, organizationId, unitA);
    const result = (unit: string | null) => ({
      id: uuidv4(),
      organizationId,
      testPlanExecutionId: executionId,
      testType: 'ui',
      testName: 'Login',
      status: 'Passed',
      startedAt: new Date(),
      executionUnitId: unit,
    });

    await privilegedDb.insert(reportTestCaseResults).values(result(unitA));
    await expect(
      privilegedDb.insert(reportTestCaseResults).values(result(unitA)),
    ).rejects.toThrow();
    // Historical rows: no unit, as many as there were.
    await privilegedDb.insert(reportTestCaseResults).values([result(null), result(null)]);
    // An attempt always belongs to a unit.
    await expect(
      privilegedDb.insert(reportTestCaseResults).values({ ...result(null), unitAttempt: 1 }),
    ).rejects.toThrow();
  });

  it('shows each organization only its own units and attempts', async () => {
    const executionId = await seedExecution(organizationId, planId);
    await insertUnit(executionId, organizationId, unitA);
    await privilegedDb
      .insert(executionUnitAttempts)
      .values({ executionId, organizationId, unitId: unitA, attempt: 1 });

    const { withTenantTransaction } = await import('../platform/middleware/tenancy');
    const seen = (org: number) =>
      asOrg(org, () =>
        withTenantTransaction(async (tx) => ({
          units: (await tx.select().from(executionUnits)).length,
          attempts: (await tx.select().from(executionUnitAttempts)).length,
        })),
      );
    expect((await seen(organizationId)).units).toBeGreaterThan(0);
    expect(await seen(otherOrganizationId)).toEqual({ units: 0, attempts: 0 });
  });
});

describe('a run', () => {
  const passed = {
    success: true,
    steps: [{ name: 'Click', type: 'click', status: 'passed' }],
    duration: 5,
  };
  const failed = {
    success: false,
    steps: [{ name: 'Click', type: 'click', status: 'failed', error: 'Button not found' }],
    duration: 5,
  };

  async function selectTests(plan: string, testIds: number[]) {
    for (const testId of testIds)
      await privilegedDb
        .insert(testPlanSelectedTests)
        .values({ testPlanId: plan, testType: 'ui', testId, organizationId } as any);
  }
  async function newTest(name: string) {
    const [test] = await privilegedDb
      .insert(testsTable)
      .values({
        userId,
        organizationId,
        name,
        url: 'https://example.test/',
        sequence: [],
        elements: [],
      })
      .returning();
    return test.id;
  }
  async function run(plan: string) {
    const executionId = await seedExecution(organizationId, plan);
    await processTestPlanJob(plan, executionId, userId);
    const units = await privilegedDb
      .select()
      .from(executionUnits)
      .where(eq(executionUnits.executionId, executionId))
      .orderBy(asc(executionUnits.position));
    const results = await privilegedDb
      .select()
      .from(reportTestCaseResults)
      .where(eq(reportTestCaseResults.testPlanExecutionId, executionId));
    const attempts = await privilegedDb
      .select()
      .from(executionUnitAttempts)
      .where(eq(executionUnitAttempts.executionId, executionId))
      .orderBy(asc(executionUnitAttempts.unitId), asc(executionUnitAttempts.attempt));
    return { executionId, units, results, attempts };
  }

  it('writes its manifest and ties every result to its own unit, the same test twice included', async () => {
    const login = await newTest('Login');
    const search = await newTest('Search');
    await selectTests(planId, [login, search, login]);
    executeTestSequence.mockResolvedValue(passed);

    const { units, results, attempts } = await run(planId);

    expect(executeTestSequence).toHaveBeenCalledTimes(3);
    expect(units.map((u) => [u.coordinates.testId, u.coordinates.occurrence, u.state])).toEqual([
      [login, 0, 'recorded'],
      [search, 0, 'recorded'],
      [login, 1, 'recorded'],
    ]);
    // Every result names a unit of the manifest, each a different one: no name or count needed.
    expect(new Set(results.map((r) => r.executionUnitId))).toEqual(
      new Set(units.map((u) => u.unitId)),
    );
    expect(results.every((r) => r.unitAttempt === 1)).toBe(true);
    expect(attempts.map((a) => [a.attempt, a.state, a.status])).toEqual(
      units.map(() => [1, 'finished', 'passed']),
    );
  });

  it('gives a re-run its own attempt, and the result the attempt that decided it', async () => {
    const flaky = await newTest('Flaky');
    const rerunPlan = await seedPlan(organizationId, userId, { reRunOnFailure: 'once' });
    await selectTests(rerunPlan, [flaky]);
    executeTestSequence.mockResolvedValueOnce(failed).mockResolvedValueOnce(passed);

    const { units, results, attempts } = await run(rerunPlan);
    await fs.remove(path.resolve(process.cwd(), 'results', rerunPlan));

    expect(units).toHaveLength(1);
    expect(attempts.map((a) => [a.attempt, a.status])).toEqual([
      [1, 'failed'],
      [2, 'passed'],
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: 'Passed',
      attempts: 2,
      executionUnitId: units[0].unitId,
      unitAttempt: 2,
    });
  });

  it('records a unit nothing was tried for without inventing an attempt', async () => {
    const [manual] = await privilegedDb
      .insert(testsTable)
      .values({
        userId,
        organizationId,
        name: 'Checkout by hand',
        url: 'https://example.test/',
        sequence: [{ action: { id: MANUAL_STEP_ACTION_ID }, value: 'Pay' }],
        elements: [],
      } as any)
      .returning();
    await selectTests(planId, [manual.id]);

    const { units, results, attempts } = await run(planId);

    expect(executeTestSequence).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: 'Pending',
      executionUnitId: units[0].unitId,
      unitAttempt: null,
    });
    expect(units[0].state).toBe('recorded');
    expect(attempts).toEqual([]);
  });
});
