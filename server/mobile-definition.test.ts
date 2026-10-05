import { describe, it, expect } from 'vitest';
import { mobileTestSchema, mobileDeviceTargets } from '@shared/mobile';
import { mobileGroupSchema } from '@shared/mobile-groups';

const test = { name: 'Login', platform: 'android', app: 'bs://app', deviceName: 'Pixel 8', osVersion: '14', steps: [] };
describe('native flow and device definitions', () => {
  it('keeps the legacy target and normalizes matrix targets', () => {
    expect(mobileDeviceTargets(test)).toEqual([{ deviceName: 'Pixel 8', osVersion: '14' }]);
    expect(mobileDeviceTargets({ ...test, deviceMatrix: [{ deviceName: ' Pixel 9 ', osVersion: '' }] })).toEqual([{ deviceName: 'Pixel 9', osVersion: null }]);
  });
  it('rejects duplicate targets and more than twenty', () => {
    expect(mobileTestSchema.safeParse({ ...test, deviceMatrix: [{ deviceName: 'Pixel', osVersion: '' }, { deviceName: ' Pixel ', osVersion: null }] }).success).toBe(false);
    expect(mobileTestSchema.safeParse({ ...test, deviceMatrix: Array.from({ length: 21 }, (_, i) => ({ deviceName: `Pixel ${i}` })) }).success).toBe(false);
  });
  it('checks balanced flow blocks and optional native conditions', () => {
    expect(mobileTestSchema.safeParse({ ...test, steps: [{ id: 'i', action: 'if', value: 'true' }] }).success).toBe(false);
    expect(mobileTestSchema.safeParse({ ...test, steps: [{ id: 'i', action: 'if', target: '~banner', value: 'visible' }, { id: 'e', action: 'endIf' }] }).success).toBe(true);
    expect(mobileTestSchema.safeParse({ ...test, steps: [{ id: 'r', action: 'repeat', value: '201' }, { id: 'e', action: 'endLoop' }] }).success).toBe(false);
  });
  it('rejects nested group calls and cross-platform locators', () => {
    expect(mobileGroupSchema.safeParse({ name: 'Login', platform: 'android', steps: [{ id: 'g', action: 'callGroup', value: 'id' }] }).success).toBe(false);
    expect(mobileTestSchema.safeParse({ ...test, steps: [{ id: 'i', action: 'if', target: 'ios=label == ok', value: 'visible' }, { id: 'e', action: 'endIf' }] }).success).toBe(false);
  });
});
