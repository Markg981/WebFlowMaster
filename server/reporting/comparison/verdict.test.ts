import { describe, it, expect } from 'vitest';
import { emptyVerdictCounts, type ComparisonDifference } from '@shared/comparison';
import { overallVerdict, testVerdict } from './verdict';

const difference = (overrides: Partial<ComparisonDifference> = {}): ComparisonDifference => ({
  stepId: 's',
  stepIndex: 0,
  checkpoint: null,
  kind: 'text',
  path: '',
  baseline: 'a',
  candidate: 'b',
  severity: 'blocking',
  ...overrides,
});

describe('testVerdict', () => {
  it.each([
    [null, 'Passed', [], 'not_comparable'],
    ['Skipped', 'Passed', [], 'not_comparable'],
    ['Failed', 'Error', [], 'both_failed'],
    ['Passed', 'Failed', [], 'outcome_mismatch'],
    ['Passed', 'Passed', [], 'identical'],
    ['Passed', 'Passed', [difference({ severity: 'informative' })], 'equivalent'],
    ['Passed', 'Passed', [difference({ knownDifferenceId: 'k' })], 'equivalent'],
    ['Passed', 'Passed', [difference(), difference({ severity: 'informative' })], 'different'],
  ] as const)('%s against %s is %s', (left, right, differences, expected) => {
    expect(testVerdict(left, right, [...differences])).toBe(expected);
  });
});

describe('overallVerdict', () => {
  const counts = (overrides: Partial<ReturnType<typeof emptyVerdictCounts>>) => ({
    ...emptyVerdictCounts(),
    ...overrides,
  });

  it('takes the first verdict that applies, in order of precedence', () => {
    expect(overallVerdict(counts({ identical: 3, different: 1, not_comparable: 1 }))).toBe(
      'regressions',
    );
    expect(overallVerdict(counts({ identical: 3, outcome_mismatch: 1 }))).toBe('regressions');
    expect(overallVerdict(counts({ identical: 3, both_failed: 1, equivalent: 1 }))).toBe(
      'inconclusive',
    );
    expect(overallVerdict(counts({ identical: 3, equivalent: 1 }))).toBe('parity_with_accepted');
    expect(overallVerdict(counts({ identical: 3 }))).toBe('parity');
  });

  it('calls two runs with no test inconclusive, not parity', () => {
    expect(overallVerdict(emptyVerdictCounts())).toBe('inconclusive');
  });
});
