import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { desc, eq } from 'drizzle-orm';
import { privilegedDb } from '../platform/db';
import {
  customActions,
  projectElements,
  projects,
  stepGroups,
  testVersions,
  tests,
} from '@shared/schema';
import { runWithTenant, withTenantTransaction } from '../platform/middleware/tenancy';
import { createTestOrganization, createTestUser } from '../tests/factories';
import {
  DEPENDENCY_PROTOCOL,
  captureDependencies,
  expandWithBundle,
  prepareSequence,
  readBundle,
  readVersionBundle,
  versionSnapshotWith,
  type DependencyBundle,
} from './executable-definition';
import { recordTestVersion } from './test-version-store';

/**
 * What a test calls, written down with it (C04): a group, element or custom action edited or
 * deleted after the capture cannot change what the captured definition runs, and the runner
 * never reads them live for a frozen definition.
 */

const call = (groupId: string) => ({ action: { id: 'callGroup', name: 'Call' }, value: groupId });
const click = (selector: string, elementId?: string) => ({
  action: { id: 'click', name: 'Click' },
  targetElement: { selector, ...(elementId ? { elementId } : {}) },
});
const custom = (actionId: string) => ({
  action: { id: `customAction:${actionId}`, name: 'Custom' },
  value: '',
});

let organizationId: number;
let otherOrganizationId: number;
let userId: number;
let otherUserId: number;
let projectId: number;

beforeAll(async () => {
  organizationId = await createTestOrganization('Bundle Org');
  otherOrganizationId = await createTestOrganization('Other Bundle Org');
  userId = await createTestUser(organizationId, `bundle-${uuidv4().slice(0, 6)}`);
  otherUserId = await createTestUser(otherOrganizationId, `other-${uuidv4().slice(0, 6)}`);
  const [project] = await privilegedDb
    .insert(projects)
    .values({ name: 'Shop', userId, organizationId })
    .returning();
  projectId = project.id;
});

beforeEach(async () => {
  await privilegedDb.delete(projectElements);
  await privilegedDb.delete(customActions);
  await privilegedDb.delete(stepGroups);
});

async function group(
  sequence: unknown[],
  name = `Group ${uuidv4().slice(0, 4)}`,
  org = organizationId,
) {
  const id = uuidv4();
  await privilegedDb.insert(stepGroups).values({
    id,
    organizationId: org,
    userId: org === organizationId ? userId : otherUserId,
    name,
    sequence,
  });
  return id;
}
async function element(selector: string) {
  const id = uuidv4();
  await privilegedDb
    .insert(projectElements)
    .values({ id, organizationId, projectId, name: `El ${id.slice(0, 4)}`, selector });
  return id;
}
async function action(script: string) {
  const id = uuidv4();
  await privilegedDb.insert(customActions).values({
    id,
    organizationId,
    userId,
    name: `Action ${id.slice(0, 4)}`,
    script,
  });
  return id;
}
const capture = (sequence: unknown, org = organizationId) =>
  runWithTenant(org, () => withTenantTransaction((tx) => captureDependencies(tx, sequence)));

describe('capturing what a test calls', () => {
  it("keeps a group's own elements and custom actions, and each repeated call once", async () => {
    const button = await element('#buy');
    const seed = await action('return 1');
    const login = await group([click('#stale', button), custom(seed)], 'Login');
    const bundle = await capture([call(login), call(login), click('#x')]);

    expect(bundle.groups.map((g) => g.id)).toEqual([login]);
    expect(bundle.elements).toEqual([expect.objectContaining({ id: button, selector: '#buy' })]);
    expect(bundle.customActions).toEqual([
      expect.objectContaining({ id: seed, script: 'return 1' }),
    ]);
    expect(bundle.missing).toEqual({ groups: [], elements: [], customActions: [] });

    const prepared = expandWithBundle([call(login), call(login)], bundle);
    expect(prepared.errors).toEqual([]);
    expect(prepared.steps).toHaveLength(4);
    expect((prepared.steps[0].targetElement as { selector: string }).selector).toBe('#buy');
    expect(prepared.steps[1]).toMatchObject({ action: { id: 'executeScript' }, value: 'return 1' });
  });

  it('captures nested groups and ends on a cycle; the nested call still fails the test', async () => {
    const a = uuidv4();
    const b = uuidv4();
    await privilegedDb.insert(stepGroups).values([
      { id: a, organizationId, userId, name: 'A', sequence: [click('#a'), call(b)] },
      { id: b, organizationId, userId, name: 'B', sequence: [call(a)] },
    ]);
    const bundle = await capture([call(a)]);

    expect(bundle.groups.map((g) => g.id).sort()).toEqual([a, b].sort());
    expect(expandWithBundle([call(a)], bundle).errors).toEqual([
      'The step group "A" calls another step group, which is not supported.',
    ]);
  });

  it('records what is missing, and fails or falls back exactly as the live path does', async () => {
    const gone = uuidv4();
    const goneElement = uuidv4();
    const goneAction = uuidv4();
    const bundle = await capture([call(gone), click('#own', goneElement), custom(goneAction)]);

    expect(bundle.missing).toEqual({
      groups: [gone],
      elements: [goneElement],
      customActions: [goneAction],
    });
    const withoutGroup = expandWithBundle([click('#own', goneElement)], bundle);
    expect(withoutGroup.errors).toEqual([]);
    expect(withoutGroup.unresolved).toEqual([goneElement]);
    expect((withoutGroup.steps[0].targetElement as { selector: string }).selector).toBe('#own');
    expect(expandWithBundle([call(gone)], bundle).errors[0]).toMatch(/no longer exists/);
  });

  it("does not capture another organization's group", async () => {
    const theirs = await group([click('#theirs')], 'Theirs', otherOrganizationId);
    const bundle = await capture([call(theirs)]);
    expect(bundle.groups).toEqual([]);
    expect(bundle.missing.groups).toEqual([theirs]);
  });

  it('keeps placeholders as written: no secret value is ever in a bundle', async () => {
    const login = await group([
      {
        action: { id: 'type', name: 'Type' },
        targetElement: { selector: '#p' },
        value: '{{password}}',
      },
    ]);
    const bundle = await capture([call(login)]);
    expect(JSON.stringify(bundle)).toContain('{{password}}');
  });

  it('sees the capturing transaction, and nothing committed after it', async () => {
    const login = await group([click('#before')]);
    const bundle = await runWithTenant(organizationId, () =>
      withTenantTransaction(async (tx) => {
        await tx
          .update(stepGroups)
          .set({ sequence: [click('#in-tx')] })
          .where(eq(stepGroups.id, login));
        return captureDependencies(tx, [call(login)]);
      }),
    );
    await privilegedDb
      .update(stepGroups)
      .set({ sequence: [click('#after')] })
      .where(eq(stepGroups.id, login));

    expect(bundle.groups[0].sequence).toEqual([click('#in-tx')]);
    const prepared = await prepareSequence([call(login)], { bundle, origin: 'enqueue' });
    expect((prepared.steps[0].targetElement as { selector: string }).selector).toBe('#in-tx');
  });
});

describe('running from a bundle', () => {
  it('reads nothing live: edits and deletions after the capture change nothing', async () => {
    const button = await element('#v1-button');
    const seed = await action('return "v1"');
    const login = await group([click('#x', button), custom(seed)], 'Login');
    const bundle = await capture([call(login)]);

    await privilegedDb
      .update(projectElements)
      .set({ selector: '#v2' })
      .where(eq(projectElements.id, button));
    await privilegedDb.delete(customActions).where(eq(customActions.id, seed));
    await privilegedDb.delete(stepGroups).where(eq(stepGroups.id, login));

    // No tenant context: a live read would throw or find nothing.
    const prepared = await prepareSequence([call(login)], { bundle, origin: 'version' });
    expect(prepared.errors).toEqual([]);
    expect((prepared.steps[0].targetElement as { selector: string }).selector).toBe('#v1-button');
    expect(prepared.steps[1]).toMatchObject({ value: 'return "v1"' });
  });

  it('fails a definition whose recorded dependencies are unusable, by name', async () => {
    const prepared = await prepareSequence([click('#x')], {
      error: 'unreadable',
      reason: 'corrupt',
    });
    expect(prepared).toMatchObject({ steps: [], errors: ['unreadable'] });
  });
});

describe('reading a recorded bundle', () => {
  const empty = async () => capture([]);

  it('tells legacy, corrupt, unsupported and tampered apart', async () => {
    const bundle = await empty();
    expect(readVersionBundle(null)).toEqual({ kind: 'legacy' });
    expect(readVersionBundle({ steps: [] })).toEqual({ kind: 'legacy' });
    expect(readVersionBundle(versionSnapshotWith(bundle))).toEqual({ kind: 'ok', bundle });
    expect(readVersionBundle('nope').kind).toBe('corrupt');
    expect(readVersionBundle({ executable: 'x' }).kind).toBe('corrupt');
    expect(readVersionBundle({ executable: { protocol: 99, dependencies: bundle } })).toEqual({
      kind: 'unsupported',
      protocol: 99,
    });
    expect(readBundle({ ...bundle, protocol: 2 }).kind).toBe('unsupported');
    expect(readBundle({ ...bundle, groups: undefined }).kind).toBe('corrupt');
    const tampered: DependencyBundle = {
      ...bundle,
      customActions: [{ id: 'x', name: 'x', parameters: [], script: 'evil()', updatedAt: null }],
    };
    expect(readBundle(tampered)).toMatchObject({ kind: 'corrupt' });
    expect(bundle.protocol).toBe(DEPENDENCY_PROTOCOL);
  });
});

describe('versions', () => {
  async function newTest(sequence: unknown[]) {
    const [row] = await privilegedDb
      .insert(tests)
      .values({
        userId,
        organizationId,
        name: `T ${uuidv4().slice(0, 4)}`,
        url: 'https://t',
        sequence,
        elements: [],
      })
      .returning();
    return row;
  }
  const save = (test: Awaited<ReturnType<typeof newTest>>) =>
    runWithTenant(organizationId, () =>
      withTenantTransaction((tx) =>
        recordTestVersion(tx, { testId: test.id, organizationId, userId, test }),
      ),
    );
  const latest = async (testId: number) =>
    (
      await privilegedDb
        .select()
        .from(testVersions)
        .where(eq(testVersions.testId, testId))
        .orderBy(desc(testVersions.version))
        .limit(1)
    )[0];

  it('record their dependencies, and a dependency change is a reason for a new version', async () => {
    const login = await group([click('#one')], 'Login');
    const test = await newTest([call(login)]);
    expect(await save(test)).toMatchObject({ version: 1 });
    const first = readVersionBundle((await latest(test.id)).snapshot);
    expect(first).toMatchObject({ kind: 'ok', bundle: { groups: [{ id: login }] } });

    // Same test, same group: nothing to record.
    expect(await save(test)).toBeNull();

    await privilegedDb
      .update(stepGroups)
      .set({ sequence: [click('#two')] })
      .where(eq(stepGroups.id, login));
    expect(await save(test)).toEqual({ version: 2, summary: 'Step group "Login" changed.' });
    // Touching the group without changing what it runs is not a change.
    await privilegedDb
      .update(stepGroups)
      .set({ updatedAt: new Date() })
      .where(eq(stepGroups.id, login));
    expect(await save(test)).toBeNull();
  });

  it('give a legacy version its record on the next save, and only when it calls something', async () => {
    const login = await group([click('#one')], 'Login');
    const plain = await newTest([click('#x')]);
    const calling = await newTest([call(login)]);
    for (const test of [plain, calling])
      await privilegedDb.insert(testVersions).values({
        organizationId,
        testId: test.id,
        version: 1,
        name: test.name,
        url: test.url,
        sequence: test.sequence,
        elements: [],
      });

    expect(await save(plain)).toBeNull();
    expect(await save(calling)).toEqual({ version: 2, summary: 'Shared dependencies recorded.' });
  });
});
