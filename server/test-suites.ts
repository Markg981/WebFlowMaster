import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { apiTests, testPlanSuites, testSuiteItems, testSuites, testTags, tests, type TestSuite } from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';

/**
 * Suites: a named set of tests, kept once and included by as many plans as need it.
 *
 * A suite exists only up to the moment a run is created. There its tests are worked out — the
 * listed ones of a static suite, the tagged ones of a dynamic suite as they are tagged at that
 * moment — and written into the run's snapshot with the plan's own tests. The runner never sees
 * a suite, and a run stays exactly what it ran even after the suite changes.
 */

export interface TestReference {
  testType: 'ui' | 'api';
  testId: number | null;
  apiTestId: number | null;
}

const keyOf = (ref: TestReference) => (ref.testType === 'ui' ? `ui:${ref.testId}` : `api:${ref.apiTestId}`);

/** The tests of one suite, in the order it runs them. */
export async function testsOfSuite(tx: TenantTx, suite: Pick<TestSuite, 'id' | 'kind' | 'tagIds' | 'projectId'>): Promise<TestReference[]> {
  if (suite.kind === 'static') {
    const items = await tx
      .select({ testType: testSuiteItems.testType, testId: testSuiteItems.testId, apiTestId: testSuiteItems.apiTestId })
      .from(testSuiteItems)
      .where(eq(testSuiteItems.suiteId, suite.id))
      .orderBy(asc(testSuiteItems.position), asc(testSuiteItems.id));
    return items;
  }

  const tagIds = Array.from(new Set(suite.tagIds ?? []));
  // A dynamic suite with no rule matches nothing rather than everything: "all tests" is a plan,
  // not a suite, and a rule emptied by mistake must not turn into running the whole library.
  if (tagIds.length === 0) return [];

  // Tests carrying every one of the tags: one row per tag they carry, counted.
  const tagged = await tx
    .select({ testId: testTags.testId, apiTestId: testTags.apiTestId, matches: sql<number>`count(distinct ${testTags.tagId})` })
    .from(testTags)
    .where(inArray(testTags.tagId, tagIds))
    .groupBy(testTags.testId, testTags.apiTestId);
  const complete = tagged.filter((row) => Number(row.matches) === tagIds.length);
  const uiIds = complete.map((row) => row.testId).filter((id): id is number => id !== null);
  const apiIds = complete.map((row) => row.apiTestId).filter((id): id is number => id !== null);

  // In name order, so the run order of a dynamic suite is stable and readable.
  const ui = uiIds.length
    ? await tx
        .select({ id: tests.id })
        .from(tests)
        .where(and(inArray(tests.id, uiIds), suite.projectId ? eq(tests.projectId, suite.projectId) : undefined))
        .orderBy(asc(tests.name))
    : [];
  const api = apiIds.length
    ? await tx
        .select({ id: apiTests.id })
        .from(apiTests)
        .where(and(inArray(apiTests.id, apiIds), suite.projectId ? eq(apiTests.projectId, suite.projectId) : undefined))
        .orderBy(asc(apiTests.name))
    : [];

  return [
    ...ui.map((row) => ({ testType: 'ui' as const, testId: row.id, apiTestId: null })),
    ...api.map((row) => ({ testType: 'api' as const, testId: null, apiTestId: row.id })),
  ];
}

/**
 * What a run of this plan executes: the plan's own tests, then each included suite's in order,
 * each test once (its first appearance wins, so a test chosen directly keeps its place).
 */
export async function expandPlanTests(tx: TenantTx, planId: string, direct: TestReference[]): Promise<TestReference[]> {
  const included = await tx
    .select({ suite: testSuites })
    .from(testPlanSuites)
    .innerJoin(testSuites, eq(testSuites.id, testPlanSuites.suiteId))
    .where(eq(testPlanSuites.testPlanId, planId))
    .orderBy(asc(testPlanSuites.position));

  const seen = new Set<string>();
  const result: TestReference[] = [];
  const add = (ref: TestReference) => {
    const key = keyOf(ref);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(ref);
  };
  direct.forEach(add);
  for (const { suite } of included) {
    (await testsOfSuite(tx, suite)).forEach(add);
  }
  return result;
}
