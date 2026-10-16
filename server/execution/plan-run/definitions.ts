/**
 * The tests a run executes, as it executes them: which definition and which version of each,
 * the ones the organization's review policy keeps from running, and the ones in quarantine.
 */
import { eq, inArray } from 'drizzle-orm';
import {
  browserGrids,
  tests as testsTable,
  apiTests as apiTestsTable,
  mobileTests as mobileTestsTable,
  testPlanExecutions as testPlanExecutionsTable,
  type ApiTest,
  type BrowserGrid,
  type MobileTest,
  type Test,
} from '@shared/schema';
import { withTenantTransaction } from '../../platform/middleware/tenancy';
import { currentContentOf, currentVersionsOf } from '../../authoring/test-version-store';
import { publishedContentOf, reviewRequired } from '../../authoring/test-publishing';
import { openQuarantinesOf } from '../../authoring/test-quarantine';
import { SharedDataError, expandWithLoadedSets, loadSharedSets } from '../../authoring/test-data';
import { freezeMobilePlanDefinitions } from '../../mobile/mobile-plan-units';
import type { SnapshotTestReference } from '../execution-snapshot';
import type { FrozenDependencies } from '../../authoring/executable-definition';
import { emit, type PlanRun } from './context';
import type { RunInputs } from './inputs';

export type TestLink = SnapshotTestReference;
export type TestKind = 'ui' | 'api' | 'mobile';

const NOT_PUBLISHED = 'Not published: this organization runs reviewed, published versions only.';

export interface MobileEntry {
  test: MobileTest;
  grid: BrowserGrid | null;
}

export interface FrozenTests {
  /** The plan's tests, in its order. */
  links: TestLink[];
  ui: Map<number, Test>;
  api: Map<number, ApiTest>;
  /** Each mobile test with the grid it names: a plan's browsers do not apply to a device. */
  mobile: Map<number, MobileEntry>;
  /** The version of each test the run executes. Each kind has its own id space. */
  versions: Record<TestKind, Map<number, number>>;
  /** Tests the review policy keeps from running, keyed `kind:id`, with the reason. */
  unpublished: Map<string, string>;
  /** UI tests whose dataset could not be resolved, with the reason. */
  datasetErrors: Map<number, string>;
  /**
   * What each UI test calls, frozen with its definition (server/authoring/executable-definition.ts).
   * Empty for a run queued before R1, whose tests still resolve groups, elements and custom
   * actions when they run.
   */
  dependencies: Map<number, FrozenDependencies>;
}

/** The id of the test a link refers to, whatever its kind. */
export const referencedId = (link: TestLink): number | null | undefined =>
  link.testType === 'ui'
    ? link.testId
    : link.testType === 'api'
      ? link.apiTestId
      : link.mobileTestId;

const idsOf = (links: TestLink[], kind: TestKind): number[] =>
  links
    .filter((link) => link.testType === kind && referencedId(link))
    .map((link) => referencedId(link) as number);

export async function freezeDefinitions(run: PlanRun, inputs: RunInputs): Promise<FrozenTests> {
  const { snapshot, organizationId } = inputs;
  const links = snapshot.selectedTests;

  emit(run, { level: 'info', message: `Found ${links.length} tests to execute in this plan.` });
  // Narrowed to what a change affects, or not and why (server/execution/test-impact.ts).
  if (snapshot.selection) {
    emit(run, {
      level: 'info',
      message: snapshot.selection.reason,
      metadata: {
        selection: snapshot.selection.mode,
        affectedTags: snapshot.selection.affectedTags,
      },
    });
  }

  // ⚡ BOLT OPTIMIZATION: Resolve N+1 query problem by batch-fetching all required
  // UI and API test definitions in a single database roundtrip.
  // Using Map for O(1) in-memory lookups during the sequential execution loop.
  // This significantly reduces DB load and latency for plans with many tests.
  const uiTestIds = idsOf(links, 'ui');
  const apiTestIds = idsOf(links, 'api');
  const mobileTestIds = idsOf(links, 'mobile');
  const unpublished = new Map<string, string>();

  const ui = await uiDefinitions(inputs, uiTestIds, unpublished);
  const datasetErrors = await applyDatasets(inputs, ui.tests);

  const api = new Map<number, ApiTest>();
  if (snapshot.definitions) {
    snapshot.definitions.api.forEach((row) => api.set(row.id, structuredClone(row.definition)));
  } else if (apiTestIds.length > 0) {
    const apiTests = await withTenantTransaction((tx) =>
      tx.select().from(apiTestsTable).where(inArray(apiTestsTable.id, apiTestIds)),
    );
    apiTests.forEach((t) => api.set(t.id, t as ApiTest));
  }

  // Mobile app tests (migration 0053), each with the grid it names: a plan's browsers and its
  // "run on" do not apply to a device, so the test says where it runs.
  const mobile = new Map<number, MobileEntry>();
  if (!snapshot.mobileDefinitions && mobileTestIds.length > 0) {
    const rows = await withTenantTransaction((tx) =>
      tx
        .select({ test: mobileTestsTable, grid: browserGrids })
        .from(mobileTestsTable)
        .leftJoin(browserGrids, eq(browserGrids.id, mobileTestsTable.gridId))
        .where(inArray(mobileTestsTable.id, mobileTestIds)),
    );
    rows.forEach((row) =>
      mobile.set(row.test.id, {
        test: row.test as MobileTest,
        grid: (row.grid as BrowserGrid | null) ?? null,
      }),
    );
  }

  // Each protocol has its own id space; API 4 and mobile 4 are different tests.
  const apiVersions = new Map<number, number>(
    snapshot.definitions?.api.flatMap((row) =>
      row.version === null ? [] : [[row.id, row.version] as [number, number]],
    ) ?? [],
  );
  const mobileVersions = new Map<number, number>();
  await withTenantTransaction(async (tx) => {
    const required = await reviewRequired(tx, organizationId);
    for (const [kind, ids, versions] of [
      ['api', apiTestIds, apiVersions],
      ['mobile', mobileTestIds, mobileVersions],
    ] as const) {
      if (
        (kind === 'api' && snapshot.definitions) ||
        (kind === 'mobile' && snapshot.mobileDefinitions)
      )
        continue;
      if (!ids.length) continue;
      const current = await currentContentOf(tx, ids, kind);
      const published = await publishedContentOf(tx, ids, kind);
      // Pin a saved working definition and its version together, then prefer the publication.
      for (const [id, content] of [...current, ...published]) {
        if (kind === 'api') {
          const working = api.get(id);
          if (working) api.set(id, { ...working, ...content.snapshot } as ApiTest);
        } else {
          const working = mobile.get(id);
          if (working) {
            const test = { ...working.test, ...content.snapshot } as MobileTest;
            // The published version can name a different grid from the working copy.
            const [grid] = test.gridId
              ? await tx
                  .select()
                  .from(browserGrids)
                  .where(eq(browserGrids.id, test.gridId))
                  .limit(1)
              : [];
            mobile.set(id, { test, grid: grid ?? null });
          }
        }
        versions.set(id, content.version);
      }
      if (required)
        for (const id of ids)
          if (!published.has(id)) unpublished.set(`${kind}:${id}`, NOT_PUBLISHED);
    }
  });

  await freezeMobile(run, inputs, mobileTestIds, { mobile, mobileVersions, unpublished });

  return {
    links,
    ui: ui.tests,
    api,
    mobile,
    versions: { ui: ui.versions, api: apiVersions, mobile: mobileVersions },
    unpublished,
    datasetErrors,
    dependencies: new Map(
      (snapshot.definitions?.ui ?? []).flatMap((row) =>
        row.dependencies ? [[row.id, row.dependencies] as const] : [],
      ),
    ),
  };
}

/** UI tests: frozen at enqueue, or read now and laid over with what was published. */
async function uiDefinitions(
  { snapshot, organizationId }: RunInputs,
  uiTestIds: number[],
  unpublished: Map<string, string>,
): Promise<{ tests: Map<number, Test>; versions: Map<number, number> }> {
  const tests = new Map<number, Test>();
  if (snapshot.definitions) {
    snapshot.definitions.ui.forEach((row) => tests.set(row.id, structuredClone(row.definition)));
  } else if (uiTestIds.length > 0) {
    // No organization predicate: RLS supplies it. These ids come from the join rows above, and
    // the create/update handlers validate them against the caller's organization, but this is
    // the query that used to make an unvalidated foreign id executable.
    const uiTests = await withTenantTransaction((tx) =>
      tx.select().from(testsTable).where(inArray(testsTable.id, uiTestIds)),
    );
    uiTests.forEach((t) => tests.set(t.id, t as Test));
  }

  // Which version of each test this run is about to execute, read once and stamped on every
  // result. Without it the history of a test and the runs of it sit side by side and never
  // meet, so "did the application change, or did the test?" stays a question somebody has to
  // answer by reading dates.
  const versions = snapshot.definitions
    ? new Map(
        snapshot.definitions.ui.flatMap((row) =>
          row.version === null ? [] : [[row.id, row.version] as [number, number]],
        ),
      )
    : uiTestIds.length > 0
      ? await withTenantTransaction((tx) => currentVersionsOf(tx, uiTestIds))
      : new Map<number, number>();

  // What was published, not what is being edited (migration 0032). A published test runs its
  // published version, laid over the working copy loaded above, and its results name that
  // version. Where the organization requires review, a test never published does not run at all:
  // running an unreviewed working copy is what the policy exists to prevent.
  if (snapshot.definitions) {
    const required = await withTenantTransaction((tx) => reviewRequired(tx, organizationId));
    if (required)
      for (const row of [
        ...snapshot.definitions.ui.map((row) => ({ ...row, kind: 'ui' })),
        ...snapshot.definitions.api.map((row) => ({ ...row, kind: 'api' })),
      ]) {
        if (row.source !== 'published') unpublished.set(`${row.kind}:${row.id}`, NOT_PUBLISHED);
      }
  } else if (uiTestIds.length > 0) {
    const { published, required } = await withTenantTransaction(async (tx) => ({
      published: await publishedContentOf(tx, uiTestIds),
      required: await reviewRequired(tx, organizationId),
    }));
    for (const [testId, content] of published) {
      const workingCopy = tests.get(testId);
      if (!workingCopy) continue;
      tests.set(testId, {
        ...workingCopy,
        name: content.name,
        url: content.url,
        sequence: content.sequence,
        elements: content.elements,
        preconditions: content.preconditions,
        cleanups: content.cleanups,
        dataset: content.dataset,
        bdd: content.bdd as import('@shared/bdd').BddTest | null,
      } as Test);
      versions.set(testId, content.version);
    }
    if (required) {
      for (const testId of uiTestIds) {
        if (!published.has(testId)) unpublished.set(`ui:${testId}`, NOT_PUBLISHED);
      }
    }
  }
  return { tests, versions };
}

/**
 * Lays each UI test's dataset over it, in place, and returns the tests whose dataset failed.
 *
 * New runs carry data from enqueue, including null/empty datasets and unavailable-set errors.
 * Historical runs without this field retain their original worker-time resolution.
 */
async function applyDatasets(
  { snapshot }: RunInputs,
  tests: Map<number, Test>,
): Promise<Map<number, string>> {
  const errors = new Map<number, string>();
  if (snapshot.datasets) {
    const frozen = new Map(snapshot.datasets.tests.map((entry) => [entry.testId, entry]));
    for (const [testId, test] of tests) {
      const entry = frozen.get(testId);
      // Overlay even errored entries: BDD lane/row counts must not use repaired live data.
      tests.set(testId, {
        ...test,
        dataset: entry ? structuredClone(entry.dataset) : null,
      } as Test);
      if (!entry) errors.set(testId, 'The queued run has no dataset snapshot for this test.');
      else if (entry.error) errors.set(testId, entry.error);
    }
  } else if (tests.size > 0) {
    await withTenantTransaction(async (tx) => {
      const sets = await loadSharedSets(
        tx,
        Array.from(tests.values(), (test) => test.dataset),
      );
      for (const [testId, test] of Array.from(tests)) {
        try {
          tests.set(testId, expandWithLoadedSets(test, sets));
        } catch (error) {
          if (!(error instanceof SharedDataError)) throw error;
          errors.set(testId, error.message);
        }
      }
    });
  }
  return errors;
}

/**
 * Mobile definitions, frozen once: at enqueue for a new run, or here — and written back onto the
 * run's snapshot — for one queued before mobile definitions were part of it.
 */
async function freezeMobile(
  run: PlanRun,
  { snapshot, organizationId }: RunInputs,
  mobileTestIds: number[],
  into: {
    mobile: Map<number, MobileEntry>;
    mobileVersions: Map<number, number>;
    unpublished: Map<string, string>;
  },
): Promise<void> {
  const frozenMobile =
    snapshot.mobileDefinitions ??
    (await withTenantTransaction((tx) => freezeMobilePlanDefinitions(tx, mobileTestIds)));
  await withTenantTransaction(async (tx) => {
    const required = await reviewRequired(tx, organizationId);
    for (const frozen of frozenMobile) {
      const key = `mobile:${frozen.id}`;
      if (required && (!frozen.version || frozen.definition.publishedVersion !== frozen.version)) {
        into.unpublished.set(key, NOT_PUBLISHED);
      } else {
        into.unpublished.delete(key);
      }
      const [grid] = frozen.definition.gridId
        ? await tx.select().from(browserGrids).where(eq(browserGrids.id, frozen.definition.gridId))
        : [];
      into.mobile.set(frozen.id, { test: frozen.definition, grid: grid ?? null });
      if (frozen.version) into.mobileVersions.set(frozen.id, frozen.version);
    }
  });
  if (!snapshot.mobileDefinitions) {
    snapshot.mobileDefinitions = frozenMobile;
    await withTenantTransaction(async (tx) => {
      await tx
        .update(testPlanExecutionsTable)
        .set({ configurationSnapshot: snapshot })
        .where(eq(testPlanExecutionsTable.id, run.executionId));
    });
  }
}

/** The run's tests in quarantine, keyed by `refKey`. */
export type Quarantined = Awaited<ReturnType<typeof openQuarantinesOf>>;

/**
 * Tests in quarantine run like the rest; their failures are recorded and do not count against
 * the run (server/authoring/test-quarantine.ts). Read as the run starts, like the published versions above.
 */
export async function readQuarantine(run: PlanRun, tests: FrozenTests): Promise<Quarantined> {
  const kinds: TestKind[] = ['ui', 'api', 'mobile'];
  const quarantined = await withTenantTransaction((tx) =>
    openQuarantinesOf(
      tx,
      kinds.flatMap((type) => idsOf(tests.links, type).map((id) => ({ type, id }))),
    ),
  );
  if (quarantined.size > 0) {
    emit(run, {
      level: 'info',
      message:
        `${quarantined.size} test(s) in this run are in quarantine: they run and their results are recorded, ` +
        `but a failure of theirs does not fail the run.`,
      metadata: { quarantined: [...quarantined.keys()] },
    });
  }
  return quarantined;
}
