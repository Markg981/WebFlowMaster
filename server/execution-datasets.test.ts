import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { privilegedDb } from './db';
import { tests, testDataSets, testVersions } from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';
import { runAsOrganization, withTenantTransaction } from './middleware/tenancy';
import { freezeExecutionDatasets } from './execution-datasets';

async function fixture() {
  const organizationId = await createTestOrganization();
  const userId = await createTestUser(organizationId);
  const [test] = await privilegedDb
    .insert(tests)
    .values({
      organizationId,
      userId,
      name: 'Data test',
      url: 'https://example.test',
      sequence: [],
      elements: [],
    })
    .returning();
  const freeze = (ids = [test.id]) =>
    runAsOrganization(organizationId, () =>
      withTenantTransaction((tx) => freezeExecutionDatasets(tx, organizationId, ids)),
    );
  return { organizationId, userId, test, freeze };
}

describe('enqueue datasets', () => {
  it('uses the published dataset instead of the draft', async () => {
    const f = await fixture();
    await privilegedDb
      .insert(testVersions)
      .values({
        organizationId: f.organizationId,
        testId: f.test.id,
        version: 1,
        name: f.test.name,
        url: f.test.url,
        sequence: [],
        elements: [],
        dataset: [{ sku: 'published' }],
      });
    await privilegedDb
      .update(tests)
      .set({ publishedVersion: 1, dataset: [{ sku: 'draft' }] })
      .where(eq(tests.id, f.test.id));
    expect((await f.freeze()).tests).toEqual([
      { testId: f.test.id, dataset: [{ sku: 'published' }] },
    ]);
  });

  it('captures only its organization, including when a foreign marker is guessed', async () => {
    const f = await fixture();
    const other = await fixture();
    const [foreign] = await privilegedDb
      .insert(testDataSets)
      .values({
        organizationId: other.organizationId,
        name: 'foreign',
        columns: ['value'],
        rows: [{ value: 'must-not-leak' }],
      })
      .returning();
    await privilegedDb
      .update(tests)
      .set({ dataset: [{ $sharedSet: String(foreign.id) }] })
      .where(eq(tests.id, f.test.id));
    const snapshot = await f.freeze([f.test.id, other.test.id]);
    expect(snapshot.variables).toEqual({});
    expect(snapshot.tests).toHaveLength(1);
    expect(snapshot.tests[0].error).toContain('unavailable when this run was queued');
    expect(JSON.stringify(snapshot)).not.toContain('must-not-leak');
  });

  it('records null and empty datasets explicitly', async () => {
    const f = await fixture();
    expect((await f.freeze()).tests).toEqual([{ testId: f.test.id, dataset: null }]);
    await privilegedDb.update(tests).set({ dataset: [] }).where(eq(tests.id, f.test.id));
    expect((await f.freeze()).tests).toEqual([{ testId: f.test.id, dataset: [] }]);
  });

  it('freezes shared first-row values for API/mobile-only plans with no web dataset', async () => {
    const f = await fixture();
    const [set] = await privilegedDb
      .insert(testDataSets)
      .values({
        organizationId: f.organizationId,
        name: 'products',
        columns: ['sku'],
        rows: [{ sku: 'original' }],
      })
      .returning();
    const original = await f.freeze([]);
    await privilegedDb
      .update(testDataSets)
      .set({ name: 'renamed', rows: [{ sku: 'changed' }] })
      .where(eq(testDataSets.id, set.id));
    expect(original).toEqual({
      version: 1,
      variables: { 'data.products.sku': 'original' },
      tests: [],
    });
    expect((await f.freeze([])).variables).toEqual({ 'data.renamed.sku': 'changed' });
  });
});
