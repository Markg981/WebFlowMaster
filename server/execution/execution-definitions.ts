import { desc, inArray } from 'drizzle-orm';
import { tests, apiTests, testVersions, type Test, type ApiTest } from '@shared/schema';
import type { TenantTx } from '../platform/middleware/tenancy';
import { currentContentOf } from '../authoring/test-version-store';
import { publishedContentOf } from '../authoring/test-publishing';
import {
  captureDependencies,
  readVersionBundle,
  unusableBundleMessage,
  type FrozenDependencies,
} from '../authoring/executable-definition';

export interface FrozenDefinition<T> {
  id: number;
  definition: T;
  version: number | null;
  source: 'published' | 'working';
  /**
   * UI only, from format 2: what the definition calls (groups, elements, custom actions). The
   * runner resolves the test from this and never from the live tables.
   */
  dependencies?: FrozenDependencies;
}
/**
 * 1: definitions only; groups, elements and custom actions are still read when the test runs
 * (runs queued before R1). 2: every UI definition carries its dependencies. A worker that knows
 * neither refuses the run instead of executing a half-understood one.
 */
export const FROZEN_DEFINITIONS_FORMATS = [1, 2] as const;
export interface FrozenTestDefinitions {
  version: (typeof FROZEN_DEFINITIONS_FORMATS)[number];
  ui: FrozenDefinition<Test>[];
  api: FrozenDefinition<ApiTest>[];
}

/**
 * The dependencies a UI definition runs with.
 *
 * A published version runs the bundle recorded with it — the one its review saw — and is never
 * re-captured. A working copy, or a version from before bundles were recorded, gets what is
 * live now, in this (the enqueue) transaction, so the run does not change after it is queued.
 * A recorded bundle that is corrupt or in an unknown format makes the test fail by name.
 */
async function dependenciesOf(
  tx: TenantTx,
  sequence: unknown,
  published: { versionSnapshot?: unknown } | undefined,
): Promise<FrozenDependencies> {
  if (published) {
    const read = readVersionBundle(published.versionSnapshot);
    if (read.kind === 'ok') return { bundle: read.bundle, origin: 'version' };
    if (read.kind !== 'legacy') return unusableBundleMessage(read);
  }
  return { bundle: await captureDependencies(tx, sequence), origin: 'enqueue' };
}

/** Definitions and version numbers are resolved together, inside the enqueue transaction. */
export async function freezeTestDefinitions(
  tx: TenantTx,
  uiIds: number[],
  apiIds: number[],
): Promise<FrozenTestDefinitions> {
  const ui: FrozenDefinition<Test>[] = [];
  const api: FrozenDefinition<ApiTest>[] = [];
  if (uiIds.length) {
    const rows = await tx.select().from(tests).where(inArray(tests.id, uiIds));
    const latest = await tx
      .selectDistinctOn([testVersions.testId])
      .from(testVersions)
      .where(inArray(testVersions.testId, uiIds))
      .orderBy(testVersions.testId, desc(testVersions.version));
    const current = new Map(latest.map((row) => [row.testId, row]));
    const published = await publishedContentOf(tx, uiIds);
    for (const row of rows) {
      const content = published.get(row.id) ?? current.get(row.id);
      const definition = content
        ? ({
            ...row,
            name: content.name,
            url: content.url,
            sequence: content.sequence,
            elements: content.elements,
            preconditions: content.preconditions,
            cleanups: content.cleanups,
            dataset: content.dataset,
            bdd: content.bdd,
          } as Test)
        : row;
      ui.push({
        id: row.id,
        definition,
        version: content?.version ?? null,
        source: published.has(row.id) ? 'published' : 'working',
        dependencies: await dependenciesOf(tx, definition.sequence, published.get(row.id)),
      });
    }
  }
  if (apiIds.length) {
    const rows = await tx.select().from(apiTests).where(inArray(apiTests.id, apiIds));
    const current = await currentContentOf(tx, apiIds, 'api');
    const published = await publishedContentOf(tx, apiIds, 'api');
    for (const row of rows) {
      const content = published.get(row.id) ?? current.get(row.id);
      api.push({
        id: row.id,
        definition: { ...row, ...content?.snapshot } as ApiTest,
        version: content?.version ?? null,
        source: published.has(row.id) ? 'published' : 'working',
      });
    }
  }
  // Use the persisted JSON representation in both the first attempt and subsequent replays.
  return JSON.parse(JSON.stringify({ version: 2, ui, api }));
}
