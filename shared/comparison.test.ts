import { describe, expect, it } from 'vitest';
import {
  ComparisonPolicySchema,
  CreateComparisonSchema,
  comparisonPolicyOf,
  emptyVerdictCounts,
  isTerminalComparisonStatus,
} from './comparison';

describe('ComparisonPolicySchema', () => {
  it('fills every default from an empty object', () => {
    expect(ComparisonPolicySchema.parse({})).toEqual({
      text: { collapseWhitespace: true, ignoreCase: false, replace: [] },
      numeric: { absTolerance: 0, relTolerance: 0 },
      network: { include: ['**/api/**'], ignoreQueryParams: [], compareResponseHash: false },
      visual: { mode: 'informative', threshold: 0.01 },
      performance: { mode: 'informative', maxSlowdownPct: 20 },
    });
  });

  it('keeps what was given and defaults the rest of the section', () => {
    const policy = ComparisonPolicySchema.parse({ text: { ignoreCase: true } });
    expect(policy.text).toEqual({ collapseWhitespace: true, ignoreCase: true, replace: [] });
  });

  it('refuses a threshold out of range', () => {
    expect(ComparisonPolicySchema.safeParse({ visual: { threshold: 2 } }).success).toBe(false);
  });

  it('reads an unreadable stored policy as the default', () => {
    expect(comparisonPolicyOf({ visual: { mode: 'loud' } })).toEqual(
      ComparisonPolicySchema.parse({}),
    );
    expect(comparisonPolicyOf(null).visual.mode).toBe('informative');
  });
});

describe('CreateComparisonSchema', () => {
  it('defaults to sequential', () => {
    const body = CreateComparisonSchema.parse({
      baselineEnvironmentId: 1,
      candidateEnvironmentId: 2,
    });
    expect(body.mode).toBe('sequential');
  });

  it('refuses the same environment on both sides', () => {
    const parsed = CreateComparisonSchema.safeParse({
      baselineEnvironmentId: 3,
      candidateEnvironmentId: 3,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('helpers', () => {
  it('knows the terminal statuses', () => {
    expect(isTerminalComparisonStatus('completed')).toBe(true);
    expect(isTerminalComparisonStatus('comparing')).toBe(false);
  });

  it('starts every verdict count at zero', () => {
    expect(Object.values(emptyVerdictCounts())).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
