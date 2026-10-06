import { and, asc, count, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { apiTests, mobileTestRuns, mobileTests, testDataSets, testTags, tests } from '@shared/schema';
import type { CatalogQuery } from '@shared/catalog';
import { isManualSequence } from '@shared/manual-tests';
import type { TenantTx } from './middleware/tenancy';
import { tagsOfTests } from './test-tags';

export type CatalogType = 'tests' | 'api-tests' | 'mobile-tests' | 'test-data';

function filters(table: { id: AnyPgColumn; name: AnyPgColumn; projectId?: AnyPgColumn; status?: AnyPgColumn }, query: CatalogQuery, type?: 'ui' | 'api' | 'mobile') {
  const conditions: SQL[] = [];
  // strpos treats %, _ and backslashes as characters, rather than LIKE wildcards.
  if (query.search) conditions.push(sql`strpos(lower(${table.name}), lower(${query.search})) > 0`);
  if (query.projectId !== undefined && table.projectId) conditions.push(eq(table.projectId, query.projectId));
  if (query.status && table.status) conditions.push(eq(table.status, query.status));
  if (type) {
    const column = { ui: testTags.testId, api: testTags.apiTestId, mobile: testTags.mobileTestId }[type];
    for (const tagId of query.tagIds) {
      conditions.push(sql`exists (select 1 from ${testTags} where ${column} = ${table.id} and ${testTags.testType} = ${type} and ${testTags.tagId} = ${tagId})`);
    }
  }
  return and(...conditions);
}

async function page<T>(tx: TenantTx, table: PgTable, where: SQL | undefined, query: CatalogQuery, load: (offset: number, limit: number) => PromiseLike<T[]>) {
  const [matched] = await tx.select({ total: count() }).from(table).where(where);
  const items = await load((query.page - 1) * query.pageSize, query.pageSize);
  return { items, total: matched.total, page: query.page, pageSize: query.pageSize };
}

const uiColumns = {
  id: tests.id, name: tests.name, url: tests.url, status: tests.status, projectId: tests.projectId,
  publishedVersion: tests.publishedVersion, createdAt: tests.createdAt, updatedAt: tests.updatedAt,
  kind: sql<'browser' | 'manual' | 'bdd' | 'cucumber'>`case
    when ${tests.bdd} ->> 'mode' = 'cucumber' then 'cucumber'
    when ${tests.bdd} is not null and ${tests.bdd} <> 'null'::jsonb then 'bdd'
    when jsonb_typeof(${tests.sequence}) = 'array' then
      case when jsonb_array_length(${tests.sequence}) > 0 and not exists (
        select 1 from jsonb_array_elements(${tests.sequence}) step
        where step -> 'action' ->> 'id' is distinct from 'manualStep'
      ) then 'manual' else 'browser' end
    else 'browser' end`,
  // Old releases persisted JSON as a string. Only that legacy form needs parsing in Node,
  // and only for the requested page. Modern lists never transfer their sequences from SQL.
  legacySequence: sql<unknown>`case when jsonb_typeof(${tests.sequence}) = 'string' then ${tests.sequence} else null end`,
};

export async function catalogPage(tx: TenantTx, type: CatalogType, query: CatalogQuery) {
  if (type === 'test-data') {
    const where = filters(testDataSets, query);
    return page(tx, testDataSets, where, query, (offset, limit) => tx.select({
      id: testDataSets.id, name: testDataSets.name, description: testDataSets.description,
      columns: testDataSets.columns, createdAt: testDataSets.createdAt, updatedAt: testDataSets.updatedAt,
      rowCount: sql<number>`jsonb_array_length(${testDataSets.rows})`,
    }).from(testDataSets).where(where).orderBy(asc(testDataSets.name), asc(testDataSets.id)).limit(limit).offset(offset));
  }
  if (type === 'tests') {
    const where = filters(tests, query, 'ui');
    const result = await page(tx, tests, where, query, (offset, limit) => tx.select(uiColumns).from(tests).where(where).orderBy(asc(tests.name), asc(tests.id)).limit(limit).offset(offset));
    const tagged = await tagsOfTests(tx, { testIds: result.items.map(row => row.id) });
    return { ...result, items: result.items.map(({ legacySequence, ...row }) => ({
      ...row, kind: row.kind === 'browser' && isManualSequence(legacySequence) ? 'manual' : row.kind,
      tags: tagged.ui.get(row.id) ?? [],
    })) };
  }
  if (type === 'api-tests') {
    const where = filters(apiTests, query, 'api');
    const result = await page(tx, apiTests, where, query, (offset, limit) => tx.select({
      id: apiTests.id, name: apiTests.name, method: apiTests.method, url: apiTests.url, projectId: apiTests.projectId,
      module: apiTests.module, featureArea: apiTests.featureArea, scenario: apiTests.scenario, component: apiTests.component,
      priority: apiTests.priority, severity: apiTests.severity, publishedVersion: apiTests.publishedVersion,
      createdAt: apiTests.createdAt, updatedAt: apiTests.updatedAt,
    }).from(apiTests).where(where).orderBy(asc(apiTests.name), asc(apiTests.id)).limit(limit).offset(offset));
    const tagged = await tagsOfTests(tx, { apiTestIds: result.items.map(row => row.id) });
    return { ...result, items: result.items.map(row => ({ ...row, tags: tagged.api.get(row.id) ?? [] })) };
  }
  const where = filters(mobileTests, query, 'mobile');
  const result = await page(tx, mobileTests, where, query, (offset, limit) => tx.select({
    id: mobileTests.id, name: mobileTests.name, platform: mobileTests.platform, app: mobileTests.app,
    deviceName: mobileTests.deviceName, osVersion: mobileTests.osVersion, gridId: mobileTests.gridId,
    projectId: mobileTests.projectId, publishedVersion: mobileTests.publishedVersion,
    createdAt: mobileTests.createdAt, updatedAt: mobileTests.updatedAt,
    stepCount: sql<number>`jsonb_array_length(${mobileTests.steps})`,
    deviceCount: sql<number>`jsonb_array_length(${mobileTests.deviceMatrix})`,
  }).from(mobileTests).where(where).orderBy(asc(mobileTests.name), asc(mobileTests.id)).limit(limit).offset(offset));
  const ids = result.items.map(row => row.id);
  const tagged = await tagsOfTests(tx, { mobileTestIds: ids });
  const latest = ids.length ? await tx.selectDistinctOn([mobileTestRuns.mobileTestId], {
    mobileTestId: mobileTestRuns.mobileTestId, status: mobileTestRuns.status, createdAt: mobileTestRuns.createdAt,
  }).from(mobileTestRuns).where(inArray(mobileTestRuns.mobileTestId, ids))
    .orderBy(mobileTestRuns.mobileTestId, sql`${mobileTestRuns.createdAt} desc`, sql`${mobileTestRuns.id} desc`) : [];
  const lastRuns = new Map(latest.map(run => [run.mobileTestId, run]));
  return { ...result, items: result.items.map(row => ({ ...row, tags: tagged.mobile.get(row.id) ?? [], lastRun: lastRuns.get(row.id) ?? null })) };
}
