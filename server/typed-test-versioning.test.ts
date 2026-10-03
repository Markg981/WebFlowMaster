import { describe, expect, it } from 'vitest';
import * as versioning from '../shared/test-versioning';
import { insertApiTestSchema } from '@shared/schema';

describe('typed executable snapshots', () => {
  it('retains all API execution settings while excluding mutable ownership and publication', () => {
    expect(
      versioning.typedSnapshotOf('api', {
        name: 'Get',
        method: 'GET',
        url: 'https://example.test',
        authParams: { token: 'x' },
        performance: { iterations: 3 },
        protoDefinition: 'proto',
        id: 4,
        organizationId: 2,
        projectId: 7,
        userId: 8,
        publishedVersion: 6,
      }),
    ).toEqual({
      name: 'Get',
      method: 'GET',
      url: 'https://example.test',
      authParams: { token: 'x' },
      performance: { iterations: 3 },
      protoDefinition: 'proto',
    });
  });
  it('preserves mobile grid and device settings but not its author', () => {
    expect(
      versioning.typedSnapshotOf('mobile', {
        name: 'Tap',
        platform: 'android',
        app: 'a',
        deviceName: 'd',
        osVersion: '14',
        gridId: 'g',
        steps: [],
        createdBy: 1,
        projectId: 3,
      }),
    ).toEqual({
      name: 'Tap',
      platform: 'android',
      app: 'a',
      deviceName: 'd',
      osVersion: '14',
      gridId: 'g',
      steps: [],
    });
  });
  it('ignores JSON object ordering but detects content and ordered step changes', () => {
    expect(versioning.describeTypedChange({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe('');
    expect(versioning.describeTypedChange({ steps: [1, 2] }, { steps: [2, 1] })).not.toBe('');
  });
  it('strips a forged API publication pointer from saves', () => {
    expect(
      insertApiTestSchema.parse({
        name: 'Get',
        method: 'GET',
        url: 'https://example.test',
        publishedVersion: 99,
      }),
    ).not.toHaveProperty('publishedVersion');
  });
});
