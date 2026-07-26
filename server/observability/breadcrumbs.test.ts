import { describe, it, expect, vi, afterEach } from 'vitest';
import { BreadcrumbRing } from './breadcrumbs';

afterEach(() => vi.useRealTimers());

describe('BreadcrumbRing', () => {
  it('returns crumbs for a correlation id in order', () => {
    const ring = new BreadcrumbRing();
    ring.push('c-1', { message: 'first' });
    ring.push('c-1', { message: 'second' });

    expect(ring.take('c-1').map((c) => c.message)).toEqual(['first', 'second']);
  });

  it('keeps correlations separate', () => {
    const ring = new BreadcrumbRing();
    ring.push('c-1', { message: 'a' });
    ring.push('c-2', { message: 'b' });

    expect(ring.take('c-1')).toHaveLength(1);
    expect(ring.take('c-2')).toHaveLength(1);
  });

  it('caps crumbs per correlation, dropping the oldest', () => {
    const ring = new BreadcrumbRing({ maxPerCorrelation: 3 });
    for (const n of [1, 2, 3, 4, 5]) ring.push('c-1', { n });

    expect(ring.take('c-1').map((c) => c.n)).toEqual([3, 4, 5]);
  });

  it('evicts the least recently used correlation beyond the cap', () => {
    const ring = new BreadcrumbRing({ maxCorrelations: 2 });
    ring.push('c-1', { n: 1 });
    ring.push('c-2', { n: 2 });
    ring.push('c-3', { n: 3 });

    expect(ring.size()).toBe(2);
    expect(ring.take('c-1')).toEqual([]);
    expect(ring.take('c-3')).toHaveLength(1);
  });

  it('drops entries past their TTL', () => {
    vi.useFakeTimers();
    const ring = new BreadcrumbRing({ ttlMs: 1000 });
    ring.push('c-1', { n: 1 });

    vi.advanceTimersByTime(1500);
    ring.push('c-2', { n: 2 }); // any write sweeps expired entries

    expect(ring.take('c-1')).toEqual([]);
  });
});
