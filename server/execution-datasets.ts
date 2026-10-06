import { and, eq, inArray } from 'drizzle-orm';
import { testDataSets, tests } from '@shared/schema';
import { dataVariables, sharedSetIdOf } from '@shared/test-data';
import type { TenantTx } from './middleware/tenancy';
import { publishedContentOf } from './test-publishing';

/** Data only: credentials and environment variables are deliberately not copied. */
export interface FrozenExecutionDatasets {
  version: 1;
  variables: Record<string, string>;
  tests: Array<{
    testId: number;
    dataset: unknown;
    source?: { id: number; name: string; updatedAt: string };
    error?: string;
  }>;
}

/** Read shared rows and first-row variables once, inside the enqueue tenant transaction. */
export async function freezeExecutionDatasets(
  tx: TenantTx,
  organizationId: number,
  testIds: number[],
): Promise<FrozenExecutionDatasets> {
  const sets = await tx
    .select()
    .from(testDataSets)
    .where(eq(testDataSets.organizationId, organizationId));
  const ids = [...new Set(testIds)];
  const rows = ids.length
    ? await tx
        .select()
        .from(tests)
        .where(and(inArray(tests.id, ids), eq(tests.organizationId, organizationId)))
    : [];
  // Match the worker's dataset choice: publication wins over the working copy.
  const published = await publishedContentOf(
    tx,
    rows.map((row) => row.id),
  );
  const byId = new Map(sets.map((set) => [set.id, set]));
  return structuredClone({
    version: 1 as const,
    variables: dataVariables(sets),
    tests: rows.map((row) => {
      const dataset = (published.get(row.id) ?? row).dataset ?? null;
      const id = sharedSetIdOf(dataset);
      if (id === null) return { testId: row.id, dataset };
      const set = byId.get(id);
      if (!set)
        return {
          testId: row.id,
          dataset: null,
          error: `${row.name} uses shared data set ${id}, which was unavailable when this run was queued. Choose another set or give the test its own rows.`,
        };
      return {
        testId: row.id,
        dataset: set.rows,
        source: { id: set.id, name: set.name, updatedAt: set.updatedAt.toISOString() },
      };
    }),
  });
}
