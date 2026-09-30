import { eq, inArray, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { apiTests, mobileTests, tests } from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';

/**
 * A test named by a link row — a suite's item, a requirement's coverage, a case link — which is a
 * web test, an API test or a mobile app test (migrations 0034, 0050, 0051, 0054). Each row keeps
 * the type and exactly one of three ids; these are the few things every such table does with them.
 */

export const TEST_KINDS = ['ui', 'api', 'mobile'] as const;
export type TestKind = (typeof TEST_KINDS)[number];
export interface TestItem {
  type: TestKind;
  id: number;
}

export const itemKey = (type: TestKind, id: number) => `${type}:${id}`;

/** A link row's own columns. */
interface LinkRow {
  testType: string;
  testId: number | null;
  apiTestId: number | null;
  mobileTestId?: number | null;
}

/** The test a link row names. */
export function itemOf(row: LinkRow): TestItem {
  if (row.testType === 'mobile') return { type: 'mobile', id: row.mobileTestId! };
  if (row.testType === 'api') return { type: 'api', id: row.apiTestId! };
  return { type: 'ui', id: row.testId! };
}

/** The columns a new link row names its test with. */
export function linkColumns(item: TestItem) {
  return {
    testType: item.type,
    testId: item.type === 'ui' ? item.id : null,
    apiTestId: item.type === 'api' ? item.id : null,
    mobileTestId: item.type === 'mobile' ? item.id : null,
  };
}

/** The predicate on a link table that finds this test. */
export function linkWhere(
  columns: { testId: AnyPgColumn; apiTestId: AnyPgColumn; mobileTestId: AnyPgColumn },
  item: TestItem,
): SQL {
  const column = item.type === 'ui' ? columns.testId : item.type === 'api' ? columns.apiTestId : columns.mobileTestId;
  return eq(column, item.id);
}

const TABLES = { ui: tests, api: apiTests, mobile: mobileTests } as const;

/**
 * The names of the tests the requester can see, by itemKey. Through RLS: a test in a project they
 * are not on, or of another organization, is missing from the map.
 */
export async function visibleNames(tx: Pick<TenantTx, 'select'>, items: TestItem[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const type of TEST_KINDS) {
    const ids = Array.from(new Set(items.filter((i) => i.type === type).map((i) => i.id)));
    if (ids.length === 0) continue;
    const table = TABLES[type];
    const rows = await tx.select({ id: table.id, name: table.name }).from(table).where(inArray(table.id, ids));
    for (const row of rows) names.set(itemKey(type, row.id), row.name);
  }
  return names;
}

/** The type of the first kind of test named that the requester cannot see; null when all are there. */
export async function firstMissingKind(tx: Pick<TenantTx, 'select'>, items: TestItem[]): Promise<TestKind | null> {
  const names = await visibleNames(tx, items);
  const missing = items.find((item) => !names.has(itemKey(item.type, item.id)));
  return missing ? missing.type : null;
}

/** "One or more … do not exist.", in the words each kind of test goes by. */
export function missingMessage(kind: TestKind): string {
  return kind === 'api' ? 'One or more API tests do not exist.' : kind === 'mobile' ? 'One or more mobile tests do not exist.' : 'One or more tests do not exist.';
}

/** Items as a page lists them: with the name, or null when the requester cannot see the test. */
export async function namedItems(tx: Pick<TenantTx, 'select'>, items: TestItem[]) {
  const names = await visibleNames(tx, items);
  return items.map((item) => ({ type: item.type, id: item.id, name: names.get(itemKey(item.type, item.id)) ?? null }));
}
