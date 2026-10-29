import { describe, expect, it } from 'vitest';
import { loginUrlFor, safeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it('keeps internal paths with their query', () => {
    expect(safeReturnTo('/test-plans/3?tab=runs')).toBe('/test-plans/3?tab=runs');
  });
  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '', null])(
    'refuses %s',
    (v) => expect(safeReturnTo(v as string | null)).toBe('/dashboard'),
  );
  it('does not loop back to the login page', () => {
    expect(safeReturnTo('/auth?returnTo=/x')).toBe('/dashboard');
  });
});

describe('loginUrlFor', () => {
  it('encodes the original page', () => {
    expect(loginUrlFor('/reports?id=1')).toBe('/auth?returnTo=%2Freports%3Fid%3D1');
  });
  it('drops an unsafe path', () => {
    expect(loginUrlFor('//evil.com')).toBe('/auth');
  });
});
