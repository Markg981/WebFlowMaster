import { eq, sql } from 'drizzle-orm';
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
  const sets = await tx.select({ name: testDataSets.name, columns: testDataSets.columns, rows: testDataSets.rows }).from(testDataSets);
  return dataVariables(sets);
}

/**
 * The dataset to run: the test's own rows, or the shared set's rows when it points at one.
 * A set deleted since is an error that names it, never a silent single run.
 */
export async function expandSharedDataset<T extends { dataset?: unknown; name?: string }>(tx: TenantTx, test: T): Promise<T> {
  const id = sharedSetIdOf(test.dataset);
  if (id === null) return test;
  const [set] = await tx.select({ rows: testDataSets.rows }).from(testDataSets).where(eq(testDataSets.id, id)).limit(1);
  if (!set) {
    throw new SharedDataError(
      `${test.name ? `${test.name} uses` : 'This test uses'} shared data set ${id}, which no longer exists. Choose another set or give the test its own rows.`,
    );
  }
  return { ...test, dataset: set.rows };
}

/** The tests whose working copy runs over this set, by name: what deleting it would break. */
export async function testsUsingSet(tx: TenantTx, id: number): Promise<string[]> {
  const rows = await tx
    .select({ name: tests.name })
    .from(tests)
    .where(sql`${tests.dataset} @> ${JSON.stringify(sharedSetMarker(id))}::jsonb`);
  return rows.map((row) => row.name);
}
