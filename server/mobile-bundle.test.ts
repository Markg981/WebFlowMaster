import { describe, it, expect } from 'vitest';
import { exportBundle, parseBundle, BUNDLE_KIND } from './test-bundle';
import type { MobileTest } from '@shared/schema';
describe('portable native catalog', () => {
  it('reads old bundles without native sections', () => {
    expect(parseBundle(JSON.stringify({ kind: BUNDLE_KIND, version: 1 }))).toMatchObject({
      mobileTests: [],
      mobileStepGroups: [],
    });
  });
  it('round trips native steps and matrix with portable group names', () => {
    const test = {
      name: 'Login',
      platform: 'android',
      app: 'bs://app',
      deviceName: 'Pixel',
      steps: [{ id: 'c', action: 'callGroup', value: 'local-id' }],
      deviceMatrix: [{ deviceName: 'Pixel 9', osVersion: '15' }],
      organizationId: 45,
      gridId: 'secret-grid',
    } as unknown as MobileTest;
    const group = {
      id: 'local-id',
      name: 'Login group',
      platform: 'android' as const,
      steps: [{ id: 'tap', action: 'tap' as const, target: '~login' }],
    };
    for (const format of ['yaml', 'json'] as const) {
      const result = exportBundle(
        { project: null, tests: [], apiTests: [], mobileTests: [test], mobileStepGroups: [group] },
        format,
      );
      const bundle = parseBundle(result.content);
      expect(bundle.version).toBe(2);
      expect(bundle.mobileTests).toHaveLength(1);
      expect(bundle.mobileStepGroups).toHaveLength(1);
      expect(bundle.mobileTests[0].steps).toEqual([
        { id: 'c', action: 'callGroup', value: '["android","Login group"]' },
      ]);
      expect(result.content).not.toContain('local-id');
      expect(result.content).not.toContain('secret-grid');
    }
  });
});
