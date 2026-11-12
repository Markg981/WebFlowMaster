import { describe, expect, it } from 'vitest';
import { comparisonPolicyOf } from '@shared/comparison';
import { diffPerformance, isSlowdown, MIN_SLOWDOWN_MS } from './diff-performance';
import { stepsWith } from './test-fixtures';

const policy = comparisonPolicyOf({});
const steps = (ms: number) => stepsWith('text', { name: 't', data: { texts: [] }, durationMs: ms });

describe('isSlowdown', () => {
  it('needs both the percentage and the minimum delay', () => {
    expect(isSlowdown(1000, 1300, 20)).toBe(true);
    expect(isSlowdown(1000, 1150, 20)).toBe(false);
    expect(isSlowdown(10, 10 + MIN_SLOWDOWN_MS, 20)).toBe(false);
    expect(isSlowdown(2000, 1000, 20)).toBe(false);
  });
});

describe('diffPerformance', () => {
  it('reports the test and the steps slower than the policy allows, informative by default', () => {
    const d = diffPerformance(
      steps(1000),
      steps(2000),
      { baseline: 5000, candidate: 9000 },
      policy,
    );
    expect(d.map((x) => [x.stepIndex, x.path, x.severity])).toEqual([
      [-1, 'duration', 'informative'],
      [0, 'duration', 'informative'],
    ]);
  });

  it('follows the mode: blocking, or nothing when off', () => {
    const blocking = comparisonPolicyOf({ performance: { mode: 'blocking' } });
    expect(diffPerformance([], [], { baseline: 1000, candidate: 5000 }, blocking)[0].severity).toBe(
      'blocking',
    );
    const off = comparisonPolicyOf({ performance: { mode: 'off' } });
    expect(diffPerformance(steps(1), steps(9000), { baseline: 1, candidate: 9000 }, off)).toEqual(
      [],
    );
  });

  it('ignores a duration the log does not have', () => {
    expect(diffPerformance([], [], { baseline: null, candidate: 9000 }, policy)).toEqual([]);
  });
});
