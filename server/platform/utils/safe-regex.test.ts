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

import { afterAll } from 'vitest';
import { RegexTimeoutError } from './regex-guard';
import { safeRegexMatch, safeRegexTest } from './safe-regex';

describe('overlapping alternation', () => {
  it('rejects repeated alternations whose branches start alike', () => {
    for (const p of ['^(a|aa)+$', '(a|a)*', '(\\w|\\d)+', '(.|a)+x']) {
      expect(() => compileSafeRegex(p), p).toThrow(/alternation/);
    }
  });
  it('accepts distinct or unrepeated alternations', () => {
    for (const p of ['^(?:foo|bar)+$', '(a|b)*c', '^(a|aa)$', '(\\d|x)+']) {
      expect(() => compileSafeRegex(p), p).not.toThrow();
    }
  });
});

describe('time budget', () => {
  afterAll(() => undefined);
  it('stops a catastrophic pattern that passes the static checks', () => {
    // Bypasses compileSafeRegex on purpose: the guard is the last line of defence.
    const re = /^(a|aa)+$/;
    const t = Date.now();
    expect(() => safeRegexTest(re, 'a'.repeat(38) + 'b')).toThrow(RegexTimeoutError);
    expect(Date.now() - t).toBeLessThan(500);
  });
  it('matches benign patterns and reuses the worker after a timeout', () => {
    expect(safeRegexTest(/^\d{6}$/, '123456')).toBe(true);
    expect(safeRegexTest(/^\d{6}$/, '12345x')).toBe(false);
    expect(safeRegexMatch(/code: (\d+)/i, 'Code: 4711')?.[1]).toBe('4711');
    expect(safeRegexMatch(/zzz/, 'abc')).toBeNull();
    expect(() => safeRegexTest(/^(a|aa)+$/, 'a'.repeat(38) + 'b')).toThrow(
      /timed out after 100 ms/,
    );
    expect(safeRegexTest(/a/, 'a')).toBe(true);
  });
});
