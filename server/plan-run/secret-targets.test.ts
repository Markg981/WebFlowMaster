/**
 * Secrets substituted into a plan's API test before it runs: only the assertion targets, which
 * the runner compares as saved. The request is resolved by the runner itself, and the test's
 * name and assertion properties are not values and must come through untouched.
 */
import { describe, expect, it } from 'vitest';
import type { ApiTest } from '@shared/schema';
import { mapStrings, withSecretTargets } from './run-unit';

const secrets = { TOKEN: 's3cret', USER: 'alice' };

const apiTest = (overrides: Partial<ApiTest> = {}): ApiTest =>
  ({
    id: 1,
    name: 'Login as {{USER}}',
    method: 'GET',
    url: 'https://example.test/{{USER}}',
    requestHeaders: { Authorization: 'Bearer {{TOKEN}}' },
    assertions: [
      {
        id: 'a1',
        source: 'body_json_path',
        property: '$.{{USER}}',
        comparison: 'equals',
        targetValue: '{{TOKEN}}',
        enabled: true,
      },
    ],
    ...overrides,
  }) as ApiTest;

describe('withSecretTargets', () => {
  it('substitutes secrets into assertion targets only', () => {
    const result = withSecretTargets(apiTest(), secrets);
    const [assertion] = result.assertions as Array<{ property: string; targetValue: string }>;
    expect(assertion.targetValue).toBe('s3cret');
    expect(assertion.property).toBe('$.{{USER}}');
    expect(result.name).toBe('Login as {{USER}}');
    // Left for the runner, where a captured value can still override a secret.
    expect(result.url).toBe('https://example.test/{{USER}}');
    expect(result.requestHeaders).toEqual({ Authorization: 'Bearer {{TOKEN}}' });
  });

  it('keeps unknown names and does not touch the original', () => {
    const original = apiTest({
      assertions: [{ id: 'a1', targetValue: '{{MISSING}}-{{TOKEN}}' }] as ApiTest['assertions'],
    });
    const result = withSecretTargets(original, secrets);
    expect((result.assertions as Array<{ targetValue: string }>)[0].targetValue).toBe(
      '{{MISSING}}-s3cret',
    );
    expect((original.assertions as Array<{ targetValue: string }>)[0].targetValue).toBe(
      '{{MISSING}}-{{TOKEN}}',
    );
  });

  it('returns a test without assertions as it is', () => {
    const test = apiTest({ assertions: null });
    expect(withSecretTargets(test, secrets)).toBe(test);
  });
});

describe('mapStrings', () => {
  it('maps nested strings and leaves other values alone', () => {
    const value = { a: 'x', b: ['y', 2, null], c: { d: true, e: 'z' } };
    expect(mapStrings(value, (s) => s.toUpperCase())).toEqual({
      a: 'X',
      b: ['Y', 2, null],
      c: { d: true, e: 'Z' },
    });
    expect(value.a).toBe('x');
  });
});
