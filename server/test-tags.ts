import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import { tags, testTags, type TaggableType } from '@shared/schema';
import type { TenantTx } from './middleware/tenancy';

/**
 * What a test is for, in the organization's own words.
 *
 * A test could be filed under a project and nothing else, so "the smoke tests" and "the slow
 * ones" existed only in people's heads and in the names they typed. A plan was then assembled
 * by hand, one test at a time, and a test written next week belonged to none of them.
 *
 * Nothing here filters by organization: RLS does, and every call arrives inside a transaction
 * already bound to one tenant. Naming another organization's tag finds nothing rather than
 * borrowing it.
 */

export interface TagRef {
  id: string;
  name: string;
}

/**
 * A tag name as it will be stored: trimmed, with runs of whitespace collapsed.
 *
 * Case is deliberately kept — a team that writes "Smoke" sees "Smoke" — while the unique index
 * compares without it, so the second person to type "smoke" gets the existing tag instead of a
 * twin nobody can tell apart in a list.
 */
export function normaliseTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export interface TagsByTest {
  ui: Map<number, TagRef[]>;
  api: Map<number, TagRef[]>;
}

/**
 * The tags on a batch of tests, in one query.
 *
 * Batched because the alternative is a query per row, and the lists this feeds — the library,
 * the plan's test picker — are exactly where that becomes hundreds of them.
 */
export async function tagsOfTests(
  tx: TenantTx,
  input: { testIds?: number[]; apiTestIds?: number[] },
): Promise<TagsByTest> {
  const result: TagsByTest = { ui: new Map(), api: new Map() };
  const testIds = input.testIds ?? [];
  const apiTestIds = input.apiTestIds ?? [];
  if (testIds.length === 0 && apiTestIds.length === 0) return result;

  const conditions: SQL[] = [];
  if (testIds.length > 0) conditions.push(inArray(testTags.testId, testIds));
  if (apiTestIds.length > 0) conditions.push(inArray(testTags.apiTestId, apiTestIds));

  const rows = await tx
    .select({
      testId: testTags.testId,
      apiTestId: testTags.apiTestId,
      tagId: tags.id,
      tagName: tags.name,
    })
    .from(testTags)
    .innerJoin(tags, eq(testTags.tagId, tags.id))
    .where(conditions.length === 1 ? conditions[0] : or(...conditions));

  for (const row of rows) {
    const bucket = row.testId != null ? result.ui : result.api;
    const key = row.testId ?? row.apiTestId;
    if (key == null) continue;
    const existing = bucket.get(key) ?? [];
    existing.push({ id: row.tagId, name: row.tagName });
    bucket.set(key, existing);
  }

  for (const bucket of [result.ui, result.api]) {
    for (const list of bucket.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}

export type SetTagsResult = { ok: true; tags: TagRef[] } | { ok: false; unknownTagIds: string[] };

/**
 * Replaces the tags on one test with exactly this set.
 *
 * Replace rather than add-and-remove, because the caller is a picker showing the whole set:
 * sending what the test should carry is one statement of intent, while a sequence of adds and
 * removes leaves the result depending on the order they arrive in.
 *
 * A tag id that this organization does not have is reported, not ignored — RLS makes it
 * invisible rather than forbidden, and silently dropping it would tell the author their tag
 * was applied.
 */
export async function setTagsForTest(
  tx: TenantTx,
  input: {
    organizationId: number;
    testType: TaggableType;
    testId: number;
    tagIds: string[];
  },
): Promise<SetTagsResult> {
  const wanted = Array.from(new Set(input.tagIds));

  const found = wanted.length === 0
    ? []
    : await tx.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.id, wanted));

  if (found.length !== wanted.length) {
    const known = new Set(found.map((tag) => tag.id));
    return { ok: false, unknownTagIds: wanted.filter((id) => !known.has(id)) };
  }

  const isUi = input.testType === 'ui';
  const owner = isUi ? eq(testTags.testId, input.testId) : eq(testTags.apiTestId, input.testId);
  await tx.delete(testTags).where(and(owner, eq(testTags.testType, input.testType)));

  if (found.length > 0) {
    await tx.insert(testTags).values(
      found.map((tag) => ({
        organizationId: input.organizationId,
        tagId: tag.id,
        testId: isUi ? input.testId : null,
        apiTestId: isUi ? null : input.testId,
        testType: input.testType,
      })),
    );
  }

  return { ok: true, tags: found.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** The ids of the tests carrying every one of these tags — an AND, not an OR. */
export async function testIdsWithTags(
  tx: TenantTx,
  input: { tagIds: string[]; testType: TaggableType },
): Promise<number[]> {
  const tagIds = Array.from(new Set(input.tagIds));
  if (tagIds.length === 0) return [];

  const column = input.testType === 'ui' ? testTags.testId : testTags.apiTestId;
  const rows = await tx
    .select({ testId: column, tagId: testTags.tagId })
    .from(testTags)
    .where(and(inArray(testTags.tagId, tagIds), eq(testTags.testType, input.testType)));

  // Every tag, not any of them: "smoke and checkout" means the tests that are both, which is
  // what somebody narrowing a list down is asking for. Counting distinct tags per test is what
  // makes a duplicated tag id in the query harmless.
  const perTest = new Map<number, Set<string>>();
  for (const row of rows) {
    if (row.testId == null) continue;
    const set = perTest.get(row.testId) ?? new Set<string>();
    set.add(row.tagId);
    perTest.set(row.testId, set);
  }

  return Array.from(perTest.entries())
    .filter(([, set]) => set.size === tagIds.length)
    .map(([testId]) => testId);
}
