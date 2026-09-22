import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { privilegedDb } from './db';
import { apiTests, projects, tags, testTags, tests as testsTable } from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';
import { normaliseTagName, setTagsForTest, tagsOfTests, testIdsWithTags } from './test-tags';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';

vi.mock('./logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * Finding tests by what they are for.
 *
 * The part that decides whether a filter is useful is what several tags mean together. "Smoke
 * and checkout" is the tests that are both — an OR would hand back a longer list than the one
 * the person was narrowing down, which is the opposite of what they asked for.
 */

let organizationId: number;
let userId: number;
let projectId: number;

beforeAll(async () => {
  organizationId = await createTestOrganization('Tag Query Org');
  userId = await createTestUser(organizationId, 'tag-query-user');
  const [project] = await privilegedDb.insert(projects).values({ name: 'Shop', userId, organizationId }).returning();
  projectId = project.id;
});

beforeEach(async () => {
  await privilegedDb.delete(testTags);
  await privilegedDb.delete(tags);
  await privilegedDb.delete(testsTable);
  await privilegedDb.delete(apiTests);
});

const inTenant = <T>(work: () => Promise<T>) => runWithTenant(organizationId, work);

async function seedTag(name: string) {
  const [row] = await privilegedDb.insert(tags).values({ id: uuidv4(), organizationId, name }).returning();
  return row;
}

async function seedTest(name: string) {
  const [row] = await privilegedDb
    .insert(testsTable)
    .values({ name, url: 'https://shop.test', userId, organizationId, projectId, sequence: [], elements: [] })
    .returning();
  return row;
}

async function seedApiTest(name: string) {
  const [row] = await privilegedDb
    .insert(apiTests)
    .values({ name, method: 'GET', url: 'https://shop.test/api', userId, organizationId, projectId })
    .returning();
  return row;
}

describe('normaliseTagName', () => {
  it('keeps the case a team chose and tidies the rest', () => {
    // The unique index compares without case, so "Smoke" and "smoke" are one tag; what is
    // stored is what the first person typed.
    expect(normaliseTagName('  Smoke   Suite ')).toBe('Smoke Suite');
  });
});

describe('testIdsWithTags', () => {
  it('returns the tests carrying every tag, not any of them', async () => {
    const smoke = await seedTag('smoke');
    const checkout = await seedTag('checkout');
    const both = await seedTest('Both');
    const onlySmoke = await seedTest('Only smoke');

    await inTenant(() =>
      withTenantTransaction(async (tx) => {
        await setTagsForTest(tx, { organizationId, testType: 'ui', testId: both.id, tagIds: [smoke.id, checkout.id] });
        await setTagsForTest(tx, { organizationId, testType: 'ui', testId: onlySmoke.id, tagIds: [smoke.id] });
      }),
    );

    const matches = await inTenant(() =>
      withTenantTransaction((tx) => testIdsWithTags(tx, { tagIds: [smoke.id, checkout.id], testType: 'ui' })),
    );

    expect(matches).toEqual([both.id]);
  });

  it('does not confuse a UI test with an API test that has the same id', async () => {
    const smoke = await seedTag('smoke');
    const uiTest = await seedTest('UI');
    const apiTest = await seedApiTest('API');

    await inTenant(() =>
      withTenantTransaction(async (tx) => {
        await setTagsForTest(tx, { organizationId, testType: 'api', testId: apiTest.id, tagIds: [smoke.id] });
      }),
    );

    const uiMatches = await inTenant(() =>
      withTenantTransaction((tx) => testIdsWithTags(tx, { tagIds: [smoke.id], testType: 'ui' })),
    );

    expect(uiMatches).not.toContain(uiTest.id);
  });

  it('asks nothing of the database when no tag was named', async () => {
    const matches = await inTenant(() =>
      withTenantTransaction((tx) => testIdsWithTags(tx, { tagIds: [], testType: 'ui' })),
    );

    expect(matches).toEqual([]);
  });
});

describe('tagsOfTests', () => {
  it('answers for a whole list at once, keyed by kind of test', async () => {
    const smoke = await seedTag('smoke');
    const slow = await seedTag('slow');
    const uiTest = await seedTest('UI');
    const apiTest = await seedApiTest('API');

    await inTenant(() =>
      withTenantTransaction(async (tx) => {
        await setTagsForTest(tx, { organizationId, testType: 'ui', testId: uiTest.id, tagIds: [slow.id, smoke.id] });
        await setTagsForTest(tx, { organizationId, testType: 'api', testId: apiTest.id, tagIds: [smoke.id] });
      }),
    );

    const result = await inTenant(() =>
      withTenantTransaction((tx) => tagsOfTests(tx, { testIds: [uiTest.id], apiTestIds: [apiTest.id] })),
    );

    expect(result.ui.get(uiTest.id)?.map((tag) => tag.name)).toEqual(['slow', 'smoke']);
    expect(result.api.get(apiTest.id)?.map((tag) => tag.name)).toEqual(['smoke']);
  });

  it('asks nothing when there is nothing to ask about', async () => {
    const result = await inTenant(() =>
      withTenantTransaction((tx) => tagsOfTests(tx, { testIds: [], apiTestIds: [] })),
    );

    expect(result.ui.size).toBe(0);
    expect(result.api.size).toBe(0);
  });
});
