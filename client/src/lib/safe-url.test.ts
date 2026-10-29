import { describe, expect, it } from 'vitest';
import { safeHttpUrl } from './safe-url';

describe('safeHttpUrl', () => {
  it('keeps http and https', () => {
    expect(safeHttpUrl('https://tracker.example/browse/A-1')).toBe(
      'https://tracker.example/browse/A-1',
    );
    expect(safeHttpUrl('http://tracker.example/')).toBe('http://tracker.example/');
  });

  it('drops other schemes and unreadable values', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl(' JaVaScRiPt:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:text/html,x')).toBeUndefined();
    expect(safeHttpUrl('/relative')).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
  });
});
