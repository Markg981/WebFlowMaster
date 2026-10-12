import { inArray, sql } from 'drizzle-orm';
import { testDataSets, tests } from '@shared/schema';
import { dataVariables, sharedSetIdOf, sharedSetMarker } from '@shared/test-data';
import type { TenantTx } from './middleware/tenancy';

/**
 * Shared test data at run time (shared/test-data.ts): the {{data.…}} values, and the rows of a
 * shared set put in place of the marker a UI test keeps in its dataset.
 *
 * Everything here runs inside the organization's tenant transaction: the sets are its own, and
 * RLS keeps another organization's out even if an id were guessed.
 */

export class SharedDataError extends Error {}

/** Every set of the organization as {{data.<set>.<column>}} values. */
export async function loadDataVariables(tx: TenantTx): Promise<Record<string, string>> {
  const sets = await tx
    .select({ name: testDataSets.name, columns: testDataSets.columns, rows: testDataSets.rows })
    .from(testDataSets);
  return dataVariables(sets);
}

/** The rows of every shared set these datasets point at, by set id, in one query. */
export async function loadSharedSets(
  tx: TenantTx,
  datasets: unknown[],
): Promise<Map<number, unknown>> {
  const ids = [...new Set(datasets.flatMap((dataset) => sharedSetIdOf(dataset) ?? []))];
  if (ids.length === 0) return new Map();
  const sets = await tx
    .select({ id: testDataSets.id, rows: testDataSets.rows })
    .from(testDataSets)
    .where(inArray(testDataSets.id, ids));
  return new Map(sets.map((set) => [set.id, set.rows]));
}

/**
 * The dataset to run, from sets already loaded (loadSharedSets): the test's own rows, or the
 * shared set's rows when it points at one. A set deleted since is an error that names it, never a
 * silent single run.
 */
export function expandWithLoadedSets<T extends { dataset?: unknown; name?: string }>(
  test: T,
  sets: Map<number, unknown>,
): T {
  const id = sharedSetIdOf(test.dataset);
  if (id === null) return test;
  if (!sets.has(id)) {
    throw new SharedDataError(
      `${test.name ? `${test.name} uses` : 'This test uses'} shared data set ${id}, which no longer exists. Choose another set or give the test its own rows.`,
    );
  }
  return { ...test, dataset: sets.get(id) };
}

/** expandWithLoadedSets for a single test. */
export async function expandSharedDataset<T extends { dataset?: unknown; name?: string }>(
  tx: TenantTx,
  test: T,
): Promise<T> {
  return expandWithLoadedSets(test, await loadSharedSets(tx, [test.dataset]));
}

/** The tests whose working copy runs over this set, by name: what deleting it would break. */
export async function testsUsingSet(tx: TenantTx, id: number): Promise<string[]> {
  const rows = await tx
    .select({ name: tests.name })
    .from(tests)
    .where(sql`${tests.dataset} @> ${JSON.stringify(sharedSetMarker(id))}::jsonb`);
  return rows.map((row) => row.name);
}
