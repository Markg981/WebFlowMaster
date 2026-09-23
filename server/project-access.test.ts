import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

/**
 * What a member sees of a restricted project, decided by the database.
 *
 * These go straight at row-level security, under the same transaction a request opens, so they
 * hold whichever route a query comes from: a restricted project and everything in it are not
 * there for someone who is not on it; a viewer on it can read and not change; an editor on it
 * can do both; owners and the system see everything; and nothing can be moved into a project
 * the requester cannot edit.
 */

const { privilegedDb } = await import('./db');
const { projectMembers, projects, testVersions, tests, users } = await import('@shared/schema');
const { createTestOrganization } = await import('./tests/factories');
const { runWithTenant, withTenantTransaction } = await import('./middleware/tenancy');

let org: number;
let owner: number;
let alice: number; // editor on the organization, editor on the secret project
let bob: number; // editor on the organization, viewer on the secret project
let carol: number; // editor on the organization, not on the secret project
let openProject: number;
let secretProject: number;
let openTest: number;
let secretTest: number;
let looseTest: number;

async function user(name: string, role: string) {
  const [row] = await privilegedDb.insert(users).values({ username: `${name}-${Date.now()}-${Math.random()}`, password: 'x', organizationId: org, role }).returning();
  return row.id;
}

async function test(name: string, projectId: number | null) {
  const [row] = await privilegedDb
    .insert(tests)
    .values({ name: `${name}-${Math.random()}`, url: 'https://x.test', sequence: [], elements: [], userId: owner, organizationId: org, projectId } as any)
    .returning();
  return row.id;
}

const as = <T>(userId: number, role: string, work: Parameters<typeof withTenantTransaction<T>>[0]) =>
  runWithTenant(org, () => withTenantTransaction(work), { userId, role });
const asSystem = <T>(work: Parameters<typeof withTenantTransaction<T>>[0]) => runWithTenant(org, () => withTenantTransaction(work));

const visibleTests = (userId: number, role: string) =>
  as(userId, role, async (tx) => (await tx.select({ id: tests.id }).from(tests)).map((r) => r.id).sort());

beforeEach(async () => {
  org = await createTestOrganization('Projects Org');
  owner = await user('owner', 'owner');
  alice = await user('alice', 'editor');
  bob = await user('bob', 'editor');
  carol = await user('carol', 'editor');
  [{ id: openProject }] = await privilegedDb.insert(projects).values({ name: 'Open', userId: owner, organizationId: org }).returning();
  [{ id: secretProject }] = await privilegedDb.insert(projects).values({ name: 'Secret', userId: owner, organizationId: org, restricted: true }).returning();
  await privilegedDb.insert(projectMembers).values([
    { projectId: secretProject, userId: alice, organizationId: org, role: 'editor' },
    { projectId: secretProject, userId: bob, organizationId: org, role: 'viewer' },
  ]);
  openTest = await test('open', openProject);
  secretTest = await test('secret', secretProject);
  looseTest = await test('loose', null);
});

describe('seeing', () => {
  it('hides a restricted project, and what is in it, from someone not on it', async () => {
    expect(await visibleTests(carol, 'editor')).toEqual([openTest, looseTest].sort());
    const projectsSeen = await as(carol, 'editor', (tx) => tx.select({ id: projects.id }).from(projects));
    expect(projectsSeen.map((p) => p.id)).toEqual([openProject]);
  });

  it('shows it to its members, to owners, and to the system', async () => {
    const all = [openTest, secretTest, looseTest].sort();
    expect(await visibleTests(alice, 'editor')).toEqual(all);
    expect(await visibleTests(bob, 'editor')).toEqual(all);
    expect(await visibleTests(owner, 'owner')).toEqual(all);
    expect((await asSystem((tx) => tx.select({ id: tests.id }).from(tests))).map((r) => r.id).sort()).toEqual(all);
  });

  it("hides a hidden test's history too", async () => {
    await privilegedDb.insert(testVersions).values({ testId: secretTest, organizationId: org, version: 1, name: 'secret', url: 'https://x.test', sequence: [], elements: [] } as any);

    expect(await as(carol, 'editor', (tx) => tx.select().from(testVersions).where(eq(testVersions.testId, secretTest)))).toHaveLength(0);
    expect(await as(alice, 'editor', (tx) => tx.select().from(testVersions).where(eq(testVersions.testId, secretTest)))).toHaveLength(1);
  });
});

describe('changing', () => {
  const rename = (userId: number, testId: number) =>
    as(userId, 'editor', (tx) => tx.update(tests).set({ name: `renamed-${Math.random()}` }).where(eq(tests.id, testId)).returning());

  it('lets an editor on the project change its tests, and a viewer on it not', async () => {
    expect(await rename(alice, secretTest)).toHaveLength(1);
    expect(await rename(bob, secretTest)).toHaveLength(0);
    expect(await as(bob, 'editor', (tx) => tx.delete(tests).where(eq(tests.id, secretTest)).returning())).toHaveLength(0);
  });

  it('leaves open projects and loose tests to the organization role', async () => {
    expect(await rename(bob, openTest)).toHaveLength(1);
    expect(await rename(carol, looseTest)).toHaveLength(1);
  });

  it('refuses to create or move a test into a project the requester cannot edit', async () => {
    await expect(
      as(bob, 'editor', (tx) =>
        tx.insert(tests).values({ name: 'sneaky', url: 'https://x.test', sequence: [], elements: [], userId: bob, organizationId: org, projectId: secretProject } as any),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(carol, 'editor', (tx) => tx.update(tests).set({ projectId: secretProject }).where(eq(tests.id, openTest))),
    ).rejects.toThrow(/row-level security/);
  });

  it('lets an owner do anything, as always', async () => {
    expect(await rename(owner, secretTest)).toHaveLength(0); // as an 'editor' role binding: not on the project
    expect(await as(owner, 'owner', (tx) => tx.update(tests).set({ name: `o-${Math.random()}` }).where(eq(tests.id, secretTest)).returning())).toHaveLength(1);
  });
});
