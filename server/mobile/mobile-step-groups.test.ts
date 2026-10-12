import { describe, it, expect } from 'vitest';
import { expandMobileGroups } from './mobile-step-groups';
const group = {
  id: 'g',
  name: 'Login',
  platform: 'android' as const,
  steps: [{ id: 'tap', action: 'tap' as const, target: '~login' }],
};
describe('native group expansion', () => {
  it('keeps source metadata and refuses missing/platform-incompatible groups', () => {
    expect(
      expandMobileGroups([{ id: 'call', action: 'callGroup', value: 'g' }], [group], 'android'),
    ).toEqual([{ ...group.steps[0], sourceIndex: 0, groupId: 'g', groupName: 'Login' }]);
    expect(() =>
      expandMobileGroups([{ id: 'call', action: 'callGroup', value: 'g' }], [], 'android'),
    ).toThrow(/unavailable/);
    expect(() =>
      expandMobileGroups([{ id: 'call', action: 'callGroup', value: 'g' }], [group], 'ios'),
    ).toThrow(/platform/);
  });
  it('refuses nested calls and expansion beyond the limit', () => {
    expect(() =>
      expandMobileGroups(
        [{ id: 'call', action: 'callGroup', value: 'g' }],
        [{ ...group, steps: [{ id: 'call', action: 'callGroup', value: 'g' }] }],
        'android',
      ),
    ).toThrow();
    expect(() =>
      expandMobileGroups(
        Array.from({ length: 2001 }, () => ({
          id: 'tap',
          action: 'tap' as const,
          target: '~login',
        })),
        [],
        'android',
      ),
    ).toThrow(/2000/);
  });
});
