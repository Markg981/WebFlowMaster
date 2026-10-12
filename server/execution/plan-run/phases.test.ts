/**
 * The pure phases of a plan run, on their own: how tests are laid out in lanes, the verdict, and
 * the report row. The phases that touch the database or a browser are exercised end to end by
 * the plan execution suites (run-test-plan, run-shards, quarantine-execution and the rest).
 */
import { describe, expect, it } from 'vitest';
import type { ApiTest, Test } from '@shared/schema';
import { LOCALE_VARIABLE } from '@shared/locales';
import { MANUAL_STEP_ACTION_ID } from '@shared/manual-tests';
import type { BrowserChoice } from '../../runtime/browsers';
import type { FrozenTests, TestLink } from './definitions';
import { lanesAreChained, onlyBdd, planLanes } from './lanes';
import { tallyResults, verdictOf } from './finalize';
import { buildReportEntry, type UnitOutcome } from './report-entry';

const chromium = { label: 'chromium', engine: 'chromium' } as BrowserChoice;
const firefox = { label: 'firefox', engine: 'firefox' } as BrowserChoice;

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
const manualTest = (id: number) =>
  uiTest(id, { sequence: [{ action: { id: MANUAL_STEP_ACTION_ID } }] as Test['sequence'] });
const cucumberTest = (id: number, rows: number) =>
  uiTest(id, {
    bdd: { mode: 'cucumber' } as Test['bdd'],
    dataset: Array.from({ length: rows }, (_, i) => ({ row: String(i) })) as Test['dataset'],
  });

function frozen(
  links: TestLink[],
  uiTests: Test[] = [],
): Pick<FrozenTests, 'links' | 'ui' | 'mobile'> {
  return { links, ui: new Map(uiTests.map((t) => [t.id, t])), mobile: new Map() };
}

describe('planLanes', () => {
  it('makes one lane per browser and language, each the whole plan with its own {{locale}}', () => {
    const lanes = planLanes(
      frozen([ui(1), api(2)], [uiTest(1)]),
      [chromium, firefox],
      ['en', 'it'],
    );

    expect(lanes).toHaveLength(4);
    expect(
      lanes.map((lane) => [lane.browserChoice?.label, lane.captured[LOCALE_VARIABLE]]),
    ).toEqual([
      ['chromium', 'en'],
      ['chromium', 'it'],
      ['firefox', 'en'],
      ['firefox', 'it'],
    ]);
    for (const lane of lanes) {
      expect(lane.units.map((unit) => unit.link)).toEqual([ui(1), api(2)]);
      expect(lane.units.every((unit) => unit.browserChoice === lane.browserChoice)).toBe(true);
    }
  });

  it('gives each lane its own captured values, not one shared object', () => {
    const [first, second] = planLanes(frozen([api(1)]), [chromium, firefox], []);
    first.captured.token = 'from chromium';
    expect(second.captured).toEqual({});
  });

  it('puts manual and mobile tests in the first lane only, with no browser', () => {
    const lanes = planLanes(
      frozen([ui(1), ui(2), mobile(3)], [uiTest(1), manualTest(2)]),
      [chromium, firefox],
      null,
    );

    expect(lanes[0].units).toEqual([
      { browserChoice: chromium, locale: undefined, link: ui(1) },
      { link: ui(2) },
      { link: mobile(3) },
    ]);
    expect(lanes[1].units).toEqual([{ browserChoice: firefox, locale: undefined, link: ui(1) }]);
  });

  it('runs a cucumber test once per dataset row', () => {
    const lanes = planLanes(frozen([ui(1)], [cucumberTest(1, 3)]), [undefined], null);
    expect(lanes[0].units).toEqual([
      { link: ui(1), bddRowIndex: 0 },
      { link: ui(1), bddRowIndex: 1 },
      { link: ui(1), bddRowIndex: 2 },
    ]);
  });

  it('with no browser that starts, still runs the tests that need none', () => {
    const lanes = planLanes(
      frozen([ui(1), ui(2), mobile(3)], [uiTest(1), cucumberTest(2, 1)]),
      [],
      ['en'],
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0].units.map((unit) => unit.link)).toEqual([ui(2), mobile(3)]);
  });

  it('with no browser that starts and only browser tests, has nothing to run', () => {
    expect(planLanes(frozen([ui(1)], [uiTest(1)]), [], null)).toEqual([]);
  });
});

describe('onlyBdd', () => {
  it('is true only for a non-empty plan of cucumber tests', () => {
    expect(onlyBdd(frozen([ui(1), ui(2)], [cucumberTest(1, 1), cucumberTest(2, 2)]))).toBe(true);
    expect(onlyBdd(frozen([ui(1), api(2)], [cucumberTest(1, 1)]))).toBe(false);
    expect(onlyBdd(frozen([]))).toBe(false);
  });
});

describe('lanesAreChained', () => {
  const withExtractions = (extractions: unknown) => ({ id: 1, extractions }) as unknown as ApiTest;

  it('is true when an API test captures a value, as an array or as text', () => {
    expect(lanesAreChained([withExtractions([{ name: 'id' }])])).toBe(true);
    expect(lanesAreChained([withExtractions('[{"name":"id"}]')])).toBe(true);
  });

  it('is false for no extractions, empty ones, or text that is not an array', () => {
    expect(lanesAreChained([])).toBe(false);
    expect(lanesAreChained([withExtractions([]), withExtractions(null)])).toBe(false);
    expect(lanesAreChained([withExtractions('not json'), withExtractions('{}')])).toBe(false);
  });
});

describe('verdictOf', () => {
  const rows = (...statuses: Array<string | [string, boolean]>) =>
    tallyResults(
      statuses.map((s) => (Array.isArray(s) ? { status: s[0], quarantined: s[1] } : { status: s })),
    );

  it('counts the results', () => {
    expect(rows('Passed', 'Failed', 'Skipped', 'Error', ['Failed', true])).toMatchObject({
      total: 5,
      passed: 1,
      failed: 2,
      skipped: 1,
      failures: { holding: 2, quarantined: 1 },
    });
  });

  it('completes a run whose tests passed, were skipped or wait for a person', () => {
    expect(verdictOf(rows('Passed', 'Passed'), 2, false)).toBe('completed');
    expect(verdictOf(rows('Passed', 'Skipped', 'Pending'), 3, false)).toBe('completed');
    expect(verdictOf(rows(), 0, false)).toBe('completed');
  });

  it('fails a run with a failure that is not in quarantine', () => {
    expect(verdictOf(rows('Passed', 'Failed'), 2, false)).toBe('failed');
    expect(verdictOf(rows('Passed', 'Error'), 2, false)).toBe('failed');
    expect(verdictOf(rows('Passed', ['Failed', true]), 2, false)).toBe('completed');
  });

  it('is an error when nothing was recorded, or something did not run', () => {
    expect(verdictOf(rows(), 3, false)).toBe('error');
    expect(verdictOf(rows('Passed'), 1, true)).toBe('error');
    // An incomplete run that also failed says it failed.
    expect(verdictOf(rows('Failed'), 1, true)).toBe('failed');
  });
});

describe('buildReportEntry', () => {
  const versions = {
    ui: new Map([[7, 3]]),
    api: new Map([[7, 9]]),
    mobile: new Map<number, number>(),
  };
  const outcome: UnitOutcome = { status: 'Passed' };
  const base = {
    organizationId: 1,
    executionId: 'run-1',
    testName: 'Login',
    definition: undefined,
    mobile: undefined,
    versions,
    inQuarantine: false,
    outcome,
    startedAt: 1_000,
    completedAt: 1_250,
  };

  it('names the browser and language, and the version of its own kind', () => {
    const entry = buildReportEntry({
      ...base,
      unit: { link: ui(7), browserChoice: chromium, locale: 'it-IT' },
    });
    expect(entry).toMatchObject({
      uiTestId: 7,
      apiTestId: null,
      mobileTestId: null,
      testType: 'ui',
      browser: 'chromium · it-IT',
      testVersion: 3,
      attempts: 1,
      durationMs: 250,
      videoUrl: null,
    });

    const apiEntry = buildReportEntry({ ...base, unit: { link: api(7) } });
    expect(apiEntry).toMatchObject({ uiTestId: null, apiTestId: 7, browser: null, testVersion: 9 });
  });

  it('carries what the outcome says', () => {
    const entry = buildReportEntry({
      ...base,
      inQuarantine: true,
      unit: { link: ui(8) },
      outcome: {
        status: 'Failed',
        failureReason: 'boom',
        attempts: 2,
        screenshotUrl: '/results/x.png',
      },
    });
    expect(entry).toMatchObject({
      status: 'Failed',
      reasonForFailure: 'boom',
      attempts: 2,
      quarantined: true,
      screenshotUrl: '/results/x.png',
      testVersion: null,
    });
  });
});
