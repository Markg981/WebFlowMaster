import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { privilegedDb } from './db';
import { projects, testVersions, tests as testsTable } from '@shared/schema';
import { createTestOrganization, createTestUser } from './tests/factories';
import { currentVersionsOf, recordTestVersion } from './test-version-store';
import { runWithTenant, withTenantTransaction } from './middleware/tenancy';

vi.mock('./logger', () => ({
  default: Promise.resolve({
    error: vi.fn(), warn: vi.fn(), info: vi.fn(), http: vi.fn(), verbose: vi.fn(), debug: vi.fn(),
  }),
  updateLogLevel: vi.fn(),
}));

/**
 * Which version each test is on right now.
 *
 * Read once at the start of a run and stamped on every result it produces. Getting it wrong in
 * the harmless-looking direction — answering "version 1" for a test that has no history — would
 * put a number nobody wrote into the data the flaky analysis then reasons about.
 */

let organizationId: number;
let userId: number;
let projectId: number;

beforeAll(async () => {
  organizationId = await createTestOrganization('Version Lookup Org');
  userId = await createTestUser(organizationId, 'version-lookup-user');
  const [project] = await privilegedDb.insert(projects).values({ name: 'Shop', userId, organizationId }).returning();
  projectId = project.id;
});

beforeEach(async () => {
  await privilegedDb.delete(testVersions);
  await privilegedDb.delete(testsTable);
});

async function seedTest(name: string) {
  const [row] = await privilegedDb
    .insert(testsTable)
    .values({ name, url: 'https://shop.test', userId, organizationId, projectId, sequence: [], elements: [] })
    .returning();
  return row;
}

const inTenant = <T>(work: () => Promise<T>) => runWithTenant(organizationId, work);

async function save(testId: number, sequence: unknown[]) {
  return inTenant(() =>
    withTenantTransaction((tx) =>
      recordTestVersion(tx, {
        testId,
        organizationId,
        userId,
        test: { name: 'Checkout', url: 'https://shop.test', sequence, elements: [] },
      }),
    ),
  );
}

const step = (selector: string) => ({
  id: `step-${selector}`,
  action: { id: 'click', type: 'click', name: 'a.click', icon: 'x', description: 'd' },
  targetElement: { id: 'e', type: 'button', selector, tag: 'button', attributes: {} },
});

describe('currentVersionsOf', () => {
  it('answers with the newest version of each test asked about', async () => {
    const first = await seedTest('First');
    const second = await seedTest('Second');
    await save(first.id, [step('#a')]);
    await save(first.id, [step('#a'), step('#b')]);
    await save(second.id, [step('#c')]);

    const versions = await inTenant(() =>
      withTenantTransaction((tx) => currentVersionsOf(tx, [first.id, second.id])),
    );

    expect(versions.get(first.id)).toBe(2);
    expect(versions.get(second.id)).toBe(1);
  });

  it('leaves out a test with no history rather than calling it version 1', async () => {
    // A test saved before versions were recorded has no version, and a result that claims one
    // is a number nobody wrote.
    const untouched = await seedTest('Old');

    const versions = await inTenant(() =>
      withTenantTransaction((tx) => currentVersionsOf(tx, [untouched.id])),
    );

    expect(versions.has(untouched.id)).toBe(false);
  });

  it('asks nothing of the database when there is nothing to ask about', async () => {
    const versions = await inTenant(() => withTenantTransaction((tx) => currentVersionsOf(tx, [])));

    expect(versions.size).toBe(0);
  });

  it('answers for a whole plan in one query, however many times each test appears', async () => {
    // A plan with forty tests on three browsers writes a hundred and twenty rows; asking per
    // row is how a report becomes the slow part of a run.
    const test = await seedTest('Repeated');
    await save(test.id, [step('#a')]);

    const versions = await inTenant(() =>
      withTenantTransaction((tx) => currentVersionsOf(tx, [test.id, test.id, test.id])),
    );

    expect(versions.get(test.id)).toBe(1);
  });
});
