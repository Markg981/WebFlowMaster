import { describe, expect, it } from 'vitest';
import { defaultMaxWorkers } from './test-workers';

const GB = 1024 ** 3;

describe('defaultMaxWorkers', () => {
  it('caps workers by memory on small machines', () => {
    expect(defaultMaxWorkers({}, 16, 4 * GB)).toBe(4);
  });
  it('is capped by cores on large machines', () => {
    expect(defaultMaxWorkers({}, 8, 64 * GB)).toBe(8);
  });
  it('never goes below one', () => {
    expect(defaultMaxWorkers({}, 8, GB / 4)).toBe(1);
  });
  it('honours VITEST_MAX_WORKERS over everything', () => {
    expect(defaultMaxWorkers({ VITEST_MAX_WORKERS: '3', CI: 'true' }, 16, 4 * GB)).toBe(3);
  });
  it('ignores an invalid override', () => {
    expect(defaultMaxWorkers({ VITEST_MAX_WORKERS: 'x' }, 16, 4 * GB)).toBe(4);
  });
  it('leaves vitest default on CI', () => {
    expect(defaultMaxWorkers({ CI: 'true' }, 16, 4 * GB)).toBeUndefined();
  });
});
