import { describe, expect, it } from 'vitest';
import { compileSafeRegex, MAX_REGEX_LENGTH } from './safe-regex';

describe('compileSafeRegex', () => {
  it('rejects a catastrophic pattern fast', () => {
    const t = Date.now();
    for (const p of ['^(a+)+$', '(a*)*b', '^(\\w+\\s?)*$', '(x+x+)+y', '((a+)b)+']) {
      expect(() => compileSafeRegex(p)).toThrow(/repeats a repeated group/);
    }
    expect(Date.now() - t).toBeLessThan(100);
  });
  it('rejects an overlong pattern', () => {
    expect(() => compileSafeRegex('a'.repeat(MAX_REGEX_LENGTH + 1))).toThrow(/longer than/);
  });
  it('accepts ordinary patterns', () => {
    for (const p of [
      '^\\d{6}$',
      '(\\d+)-(\\d+)',
      '[a-z+]+@x\\.com',
      '(?:ab)+',
      '\\(a+\\)+',
      'code: (\\d{4,6})',
    ]) {
      expect(() => compileSafeRegex(p)).not.toThrow();
    }
    expect(compileSafeRegex('^(ab)+$', 'i').test('ABab')).toBe(true);
  });
  it('still reports invalid syntax', () => {
    expect(() => compileSafeRegex('(')).toThrow();
  });
});
