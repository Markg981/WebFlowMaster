import { describe, it, expect } from 'vitest';
import { comparisonPolicyOf } from '@shared/comparison';
import { normalizeText, numbersMatch, parseNumber, textsMatch } from './normalizers';

describe('normalizeText', () => {
  it('applies replace rules, then whitespace, then case', () => {
    const policy = comparisonPolicyOf({
      text: { ignoreCase: true, replace: [{ pattern: '\\d{4}-\\d{2}-\\d{2}', with: '<date>' }] },
    }).text;
    expect(normalizeText('  Printed  2026-11-12\n OK ', policy)).toBe('printed <date> ok');
  });

  it('skips a replace rule that is not a valid expression', () => {
    const policy = comparisonPolicyOf({ text: { replace: [{ pattern: '(' }] } }).text;
    expect(normalizeText('a (b)', policy)).toBe('a (b)');
  });
});

describe('parseNumber', () => {
  it.each([
    ['1234.5', 1234.5],
    ['1,234.5', 1234.5],
    ['1.234,5', 1234.5],
    ['1,234', 1234],
    ['1.234.567', 1234567],
    ['1,5', 1.5],
    ['-3,00', -3],
    ['12 %', 12],
  ])('reads %s as %d', (text, value) => {
    expect(parseNumber(text)).toBe(value);
  });

  it('refuses a text that is more than a number', () => {
    expect(parseNumber('EUR 12')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('1-2')).toBeNull();
  });
});

describe('numbersMatch and textsMatch', () => {
  it('accepts a difference within the absolute or the relative tolerance', () => {
    expect(numbersMatch(100, 100.4, { absTolerance: 0.5, relTolerance: 0 })).toBe(true);
    expect(numbersMatch(100, 101, { absTolerance: 0, relTolerance: 0.01 })).toBe(true);
    expect(numbersMatch(100, 102, { absTolerance: 1, relTolerance: 0.01 })).toBe(false);
  });

  it('compares numbers in different locales as numbers, and texts exactly by default', () => {
    const policy = comparisonPolicyOf({});
    expect(textsMatch('1.234,50', '1,234.5', policy)).toBe(true);
    expect(textsMatch('Total', 'total', policy)).toBe(false);
    expect(textsMatch('a  b', 'a b', policy)).toBe(true);
  });
});
