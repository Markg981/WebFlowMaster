import { describe, expect, it } from 'vitest';
import { pathPatternMatcher, urlPatternMatcher } from './patterns';

describe('urlPatternMatcher', () => {
  it('reads ** as anything and * as anything but a slash, over the whole URL', () => {
    const any = urlPatternMatcher('**/api/**');
    expect(any('http://a.test/api/orders?x=1')).toBe(true);
    expect(any('http://a.test/static/app.js')).toBe(false);
    const one = urlPatternMatcher('http://a.test/api/*');
    expect(one('http://a.test/api/orders')).toBe(true);
    expect(one('http://a.test/api/orders/7')).toBe(false);
  });

  it('matches a URL containing a pattern with no wildcard, and escapes regex characters', () => {
    expect(urlPatternMatcher('/api/orders')('http://a.test/api/orders?x=1')).toBe(true);
    expect(urlPatternMatcher('**/a.b?c')('http://h/a.b?c')).toBe(true);
    expect(urlPatternMatcher('**/a.b?c')('http://h/aXbc')).toBe(false);
  });
});

describe('pathPatternMatcher', () => {
  it('reads * as any characters, brackets and dots as themselves, over the whole path', () => {
    const m = pathPatternMatcher('series[Sales].points[*]');
    expect(m('series[Sales].points[Mar]')).toBe(true);
    expect(m('series[Sales].type')).toBe(false);
    expect(m('xseries[Sales].points[Mar]')).toBe(false);
    expect(pathPatternMatcher('rows[*][2]')('rows[10][2]')).toBe(true);
    expect(pathPatternMatcher('texts[1]')('texts[10]')).toBe(false);
  });

  it('matches any path when empty', () => {
    expect(pathPatternMatcher(null)('anything')).toBe(true);
    expect(pathPatternMatcher(' ')('')).toBe(true);
  });
});
