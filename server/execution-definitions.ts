import { desc, inArray } from 'drizzle-orm';
import { tests, apiTests, testVersions, type Test, type ApiTest } from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';
import { currentContentOf } from './test-version-store';
import { publishedContentOf } from './test-publishing';

export interface FrozenDefinition<T> {
  id: number;
  definition: T;
  version: number | null;
  source: 'published' | 'working';
}
export interface FrozenTestDefinitions {
  version: 1;
  ui: FrozenDefinition<Test>[];
  api: FrozenDefinition<ApiTest>[];
}

/** Definitions and version numbers are resolved together, inside the enqueue transaction. */
export async function freezeTestDefinitions(tx: TenantTx, uiIds: number[], apiIds: number[]): Promise<FrozenTestDefinitions> {
  const ui: FrozenDefinition<Test>[] = [];
  const api: FrozenDefinition<ApiTest>[] = [];
  if (uiIds.length) {
    const rows = await tx.select().from(tests).where(inArray(tests.id, uiIds));
    const latest = await tx.selectDistinctOn([testVersions.testId]).from(testVersions)
      .where(inArray(testVersions.testId, uiIds)).orderBy(testVersions.testId, desc(testVersions.version));
    const current = new Map(latest.map(row => [row.testId, row]));
    const published = await publishedContentOf(tx, uiIds);
    for (const row of rows) {
      const content = published.get(row.id) ?? current.get(row.id);
      const definition = content ? {
        ...row, name: content.name, url: content.url, sequence: content.sequence, elements: content.elements,
        preconditions: content.preconditions, cleanups: content.cleanups, dataset: content.dataset, bdd: content.bdd,
      } as Test : row;
      ui.push({ id: row.id, definition, version: content?.version ?? null, source: published.has(row.id) ? 'published' : 'working' });
    }
  }
  if (apiIds.length) {
    const rows = await tx.select().from(apiTests).where(inArray(apiTests.id, apiIds));
    const current = await currentContentOf(tx, apiIds, 'api');
    const published = await publishedContentOf(tx, apiIds, 'api');
    for (const row of rows) {
      const content = published.get(row.id) ?? current.get(row.id);
      api.push({ id: row.id, definition: { ...row, ...content?.snapshot } as ApiTest,
        version: content?.version ?? null, source: published.has(row.id) ? 'published' : 'working' });
    }
  }
  // Use the persisted JSON representation in both the first attempt and subsequent replays.
  return JSON.parse(JSON.stringify({ version: 1, ui, api }));
}
