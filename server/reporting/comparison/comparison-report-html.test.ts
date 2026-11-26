import { describe, expect, it } from 'vitest';
import { shownPair } from './comparison-report-html';

describe('shownPair (TD-011)', () => {
  const head = 'x'.repeat(350);

  it('shows the first differing part when it lies beyond the 300-character clip', () => {
    const [a, b] = shownPair(`${head}AAAA`, `${head}BBBB`);
    expect(a).toContain('first difference at position 350');
    expect(a).toContain('AAAA');
    expect(b).toContain('BBBB');
    expect(a).not.toEqual(b);
  });

  it('keeps the plain clip when the difference is inside the first 300 characters', () => {
    const [a, b] = shownPair(`ab${head}`, `cd${head}`);
    expect(a.endsWith('…')).toBe(true);
    expect(a).not.toContain('first difference');
    expect(a).not.toEqual(b);
  });

  it('does not clip short values', () => {
    expect(shownPair('one', 'two')).toEqual(['one', 'two']);
  });

  it('handles a missing value', () => {
    expect(shownPair(undefined, 'x')).toEqual(['—', 'x']);
  });
});
