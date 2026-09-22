import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { STEP_GROUP_ACTION_ID } from '@shared/recording';
import { stepGroups } from '@shared/schema';
import { privilegedDb } from './db';
import { runWithTenant } from './middleware/tenancy';
import { createTestOrganization, createTestUser } from './tests/factories';
import {
  expandSequenceForRun,
  expandStepGroups,
  groupIdOf,
  isGroupCall,
  referencedGroupIds,
  type LoadedStepGroup,
} from './step-groups';

/**
 * A login written once used to be written once per test. These are the rules by which a test
 * now calls it instead — and the rule that matters most: a call that cannot be expanded fails
 * the test rather than quietly shortening it.
 */

const step = (id: string, name = id) => ({ action: { id, name }, targetElement: { selector: `#${id}` } });
const call = (groupId: string, name = 'Login') => ({ action: { id: STEP_GROUP_ACTION_ID, name }, value: groupId });

const loginGroup: LoadedStepGroup = {
  id: 'group-1',
  name: 'Login',
  sequence: [step('input', 'Type username'), step('click', 'Submit')],
};

describe('recognising a call', () => {
  it('knows a call from an ordinary step, and which group it names', () => {
    expect(isGroupCall(call('group-1'))).toBe(true);
    expect(isGroupCall(step('click'))).toBe(false);
    expect(groupIdOf(call('group-1'))).toBe('group-1');
    expect(groupIdOf({ action: { id: STEP_GROUP_ACTION_ID }, value: { groupId: 'group-2' } })).toBe('group-2');
    expect(groupIdOf({ action: { id: STEP_GROUP_ACTION_ID } })).toBeNull();
  });

  it('lists what a sequence needs, once each and in order', () => {
    expect(referencedGroupIds([call('b'), step('click'), call('a'), call('b')])).toEqual(['b', 'a']);
    expect(referencedGroupIds([step('click')])).toEqual([]);
    expect(referencedGroupIds('not a sequence')).toEqual([]);
  });
});

describe('expandStepGroups', () => {
  it("replaces a call with the group's steps, in place", () => {
    const { steps, expanded, errors } = expandStepGroups(
      [step('navigate', 'Open app'), call('group-1'), step('click', 'Log out')],
      [loginGroup],
    );

    expect(errors).toEqual([]);
    expect(expanded).toBe(true);
    expect(steps.map((s) => s.action?.name)).toEqual([
      'Open app',
      'Login › Type username',
      'Login › Submit',
      'Log out',
    ]);
  });

  it('keeps what each step does, and only renames it', () => {
    const { steps } = expandStepGroups([call('group-1')], [loginGroup]);

    expect(steps[0].action?.id).toBe('input');
    expect(steps[0].targetElement).toEqual({ selector: '#input' });
  });

  it('says where a step came from, so a failure points at the group', () => {
    const { steps } = expandStepGroups([call('group-1')], [loginGroup]);

    expect(steps[0].action?.name).toContain('Login');
  });

  it('expands the same group twice when a test calls it twice', () => {
    const { steps } = expandStepGroups([call('group-1'), call('group-1')], [loginGroup]);

    expect(steps).toHaveLength(4);
  });

  it('fails the test when the group was deleted, rather than running a shorter test', () => {
    const { steps, errors } = expandStepGroups([step('navigate'), call('gone', 'Login')], []);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no longer exists');
    expect(steps.map((s) => s.action?.id)).toEqual(['navigate']);
  });

  it('refuses a group that calls another group, rather than risking a cycle', () => {
    const nested: LoadedStepGroup = { id: 'group-2', name: 'Outer', sequence: [call('group-1')] };

    const { errors } = expandStepGroups([call('group-2', 'Outer')], [nested, loginGroup]);

    expect(errors.join(' ')).toContain('not supported');
  });

  it('refuses an empty group instead of expanding it into nothing', () => {
    const empty: LoadedStepGroup = { id: 'group-3', name: 'Empty', sequence: [] };

    const { errors } = expandStepGroups([call('group-3', 'Empty')], [empty]);

    expect(errors.join(' ')).toContain('no steps');
  });

  it('refuses a call that names no group', () => {
    const { errors } = expandStepGroups([{ action: { id: STEP_GROUP_ACTION_ID, name: 'Login' } }], [loginGroup]);

    expect(errors.join(' ')).toContain('does not say which one');
  });

  it('leaves a sequence that calls nothing exactly as it was', () => {
    const sequence = [step('click'), step('input')];

    const { steps, expanded, errors } = expandStepGroups(sequence, []);

    expect(steps).toEqual(sequence);
    expect(expanded).toBe(false);
    expect(errors).toEqual([]);
  });

  it('reads a sequence that came back from the column as text', () => {
    const { steps } = expandStepGroups(JSON.stringify([call('group-1')]), [loginGroup]);

    expect(steps).toHaveLength(2);
  });
});

describe('expandSequenceForRun, against the database', () => {
  let organizationId: number;
  let otherOrganizationId: number;
  let userId: number;
  let otherUserId: number;

  beforeAll(async () => {
    organizationId = await createTestOrganization('Expand Org');
    userId = await createTestUser(organizationId, 'expand-user');
    otherOrganizationId = await createTestOrganization('Other Expand Org');
    otherUserId = await createTestUser(otherOrganizationId, 'other-expand-user');
  });

  beforeEach(async () => {
    await privilegedDb.delete(stepGroups);
  });

  async function seedGroup(ownerOrg: number, ownerUser: number, name = 'Login') {
    const id = uuidv4();
    await privilegedDb.insert(stepGroups).values({
      id,
      organizationId: ownerOrg,
      userId: ownerUser,
      name,
      sequence: [step('input', 'Type username'), step('click', 'Submit')],
    });
    return id;
  }

  it('loads the group and expands the call', async () => {
    const id = await seedGroup(organizationId, userId);

    const result = await runWithTenant(organizationId, () => expandSequenceForRun([call(id)]));

    expect(result.errors).toEqual([]);
    expect(result.steps).toHaveLength(2);
    expect(result.expanded).toBe(true);
  });

  it("cannot expand another organization's group, and says the group is gone", async () => {
    const id = await seedGroup(otherOrganizationId, otherUserId);

    const result = await runWithTenant(organizationId, () => expandSequenceForRun([call(id)]));

    expect(result.steps).toEqual([]);
    expect(result.errors.join(' ')).toContain('no longer exists');
  });

  it('touches the database at all only when something calls a group', async () => {
    // No tenant context here on purpose: a sequence with no calls must not reach a tenant
    // query, which is what every test written before step groups existed looks like.
    const result = await expandSequenceForRun([step('click', 'Submit')]);

    expect(result.expanded).toBe(false);
    expect(result.steps).toHaveLength(1);
  });
});
