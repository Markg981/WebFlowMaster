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
      network: {
        include: ['**/api/**'],
        ignoreQueryParams: [],
        compareResponseHash: false,
        counts: 'blocking',
      },
      visual: { mode: 'informative', threshold: 0.01, ignoreRegions: [] },
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

  it('takes a candidate delay only for a sequential comparison', () => {
    const sides = { baselineEnvironmentId: 1, candidateEnvironmentId: 2 };
    expect(CreateComparisonSchema.parse({ ...sides, candidateDelaySeconds: 600 })).toMatchObject({
      candidateDelaySeconds: 600,
    });
    for (const extra of [
      { mode: 'parallel', candidateDelaySeconds: 60 },
      { candidateDelaySeconds: -1 },
      { candidateDelaySeconds: 7201 },
      { candidateDelaySeconds: 1.5 },
    ]) {
      expect(CreateComparisonSchema.safeParse({ ...sides, ...extra }).success).toBe(false);
    }
  });

  it('takes a URL per side, normalized, with or without environments', () => {
    const body = CreateComparisonSchema.parse({
      baselineEnvironmentId: 1,
      baselineUrl: ' https://old.example.com/ ',
      candidateUrl: 'https://new.example.com',
      recordedUrl: 'http://localhost:4200/',
    });
    expect(body).toMatchObject({
      baselineUrl: 'https://old.example.com',
      candidateUrl: 'https://new.example.com',
      recordedUrl: 'http://localhost:4200',
    });
    expect(
      CreateComparisonSchema.safeParse({
        baselineUrl: 'https://old.example.com',
        candidateUrl: 'https://new.example.com',
      }).success,
    ).toBe(true);
  });

  it('allows the same environment when the URLs differ, and not the same URL twice', () => {
    expect(
      CreateComparisonSchema.safeParse({
        baselineEnvironmentId: 3,
        candidateEnvironmentId: 3,
        baselineUrl: 'https://old.example.com',
        candidateUrl: 'https://new.example.com',
      }).success,
    ).toBe(true);
    expect(
      CreateComparisonSchema.safeParse({
        baselineEnvironmentId: 3,
        baselineUrl: 'https://a.example.com/',
        candidateUrl: 'https://a.example.com',
      }).success,
    ).toBe(false);
  });

  it('refuses a side with neither, a bad URL, and a recorded URL without both sides', () => {
    for (const body of [
      { baselineEnvironmentId: 1 },
      { candidateUrl: 'https://new.example.com' },
      { baselineUrl: 'ftp://old.example.com', candidateUrl: 'https://new.example.com' },
      { baselineUrl: 'https://user:pw@old.example.com', candidateUrl: 'https://new.example.com' },
      {
        baselineUrl: `https://a.test/${'x'.repeat(2050)}`,
        candidateUrl: 'https://new.example.com',
      },
      {
        baselineEnvironmentId: 1,
        candidateUrl: 'https://new.example.com',
        recordedUrl: 'https://dev.example.com',
      },
    ])
      expect(
        CreateComparisonSchema.safeParse(body).success,
        JSON.stringify(body).slice(0, 80),
      ).toBe(false);
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
