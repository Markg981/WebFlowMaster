import { describe, it, expect } from 'vitest';
import { findInvalidGenerators, generate, substituteGenerators } from './generators';
import { substituteVariables } from './outbound-http';
import { findUnresolvedVariables } from './variables';

describe('generators', () => {
  it('makes up values of the right shape', () => {
    expect(generate('uuid')).toMatch(/^[0-9a-f-]{36}$/);
    expect(generate('randomEmail')).toMatch(/^test\.[a-z0-9]{10}@example\.com$/);
    expect(generate('randomDigits', '4')).toMatch(/^\d{4}$/);
    expect(generate('randomString', '12')).toMatch(/^[a-z0-9]{12}$/);
    const n = Number(generate('randomInt', '5,7'));
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(7);
    expect(generate('today', '+1')).toBe(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  });

  it('refuses unknown names and arguments that do not fit', () => {
    expect(generate('nope')).toBeNull();
    expect(generate('randomInt', '9,1')).toBeNull();
    expect(generate('randomDigits', 'x')).toBeNull();
  });

  it('makes a fresh value for each placeholder', () => {
    const [a, b] = substituteGenerators('{{$uuid}} {{$uuid}}').split(' ');
    expect(a).not.toBe(b);
  });

  it('works wherever variables are substituted, after them', () => {
    expect(substituteVariables('{{host}}/u/{{ $randomDigits(3) }}', { host: 'https://x.test' })).toMatch(
      /^https:\/\/x\.test\/u\/\d{3}$/,
    );
  });

  it('reports a misspelt generator as unresolved, like a missing variable', () => {
    expect(findInvalidGenerators('{{$randomEmial}}')).toEqual(['$randomEmial']);
    expect(findUnresolvedVariables('{{$randomEmial}} {{$uuid}}', {})).toEqual(['$randomEmial']);
  });
});
