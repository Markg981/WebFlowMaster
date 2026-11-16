import { describe, expect, it } from 'vitest';
import {
  comparisonSideLabel,
  comparisonTargetFor,
  retargetDefinition,
  retargetText,
} from './comparison-target';

const addresses = {
  baselineUrl: 'https://old.example.com/',
  candidateUrl: 'https://new.example.com',
  recordedUrl: 'http://localhost:4200',
};

describe('the target of a comparison side', () => {
  it('is its own address, rewriting the other side and the recorded one', () => {
    expect(comparisonTargetFor('baseline', addresses)).toEqual({
      url: 'https://old.example.com',
      rewriteFrom: ['https://new.example.com', 'http://localhost:4200'],
    });
    expect(comparisonTargetFor('candidate', addresses)).toEqual({
      url: 'https://new.example.com',
      rewriteFrom: ['https://old.example.com', 'http://localhost:4200'],
    });
  });

  it('is nothing for a side without an address', () => {
    expect(comparisonTargetFor('candidate', { baselineUrl: 'https://old.example.com' })).toBe(
      undefined,
    );
  });

  it('never rewrites its own address, and tries the longest first', () => {
    expect(
      comparisonTargetFor('candidate', {
        baselineUrl: 'https://a.test/app',
        candidateUrl: 'https://b.test',
        recordedUrl: 'https://a.test/app/v2',
      }),
    ).toEqual({
      url: 'https://b.test',
      rewriteFrom: ['https://a.test/app/v2', 'https://a.test/app'],
    });
    expect(
      comparisonTargetFor('baseline', {
        baselineUrl: 'https://a.test',
        recordedUrl: 'https://a.test/',
      })?.rewriteFrom,
    ).toEqual([]);
  });
});

describe('retargeting', () => {
  const target = { url: 'https://new.example.com', rewriteFrom: ['https://old.example.com'] };

  it('replaces the address where it ends, not inside a longer host or path', () => {
    expect(retargetText('https://old.example.com/login?next=/', target)).toBe(
      'https://new.example.com/login?next=/',
    );
    expect(retargetText('https://old.example.com', target)).toBe('https://new.example.com');
    expect(retargetText('"https://old.example.com"', target)).toBe('"https://new.example.com"');
    expect(retargetText('https://old.example.com.evil.test', target)).toBe(
      'https://old.example.com.evil.test',
    );
    expect(retargetText('https://old.example.com:8443/x', target)).toBe(
      'https://old.example.com:8443/x',
    );
    expect(retargetText('https://old.example.community', target)).toBe(
      'https://old.example.community',
    );
  });

  it('walks a definition and returns a copy, leaving the original alone', () => {
    const definition = {
      url: 'https://old.example.com/',
      sequence: [{ action: 'navigate', value: 'https://old.example.com/orders' }],
      headers: { Referer: 'https://old.example.com' },
      timeout: 30,
      createdAt: new Date(0),
    };
    const copy = retargetDefinition(definition, target);
    expect(copy).toEqual({
      url: 'https://new.example.com/',
      sequence: [{ action: 'navigate', value: 'https://new.example.com/orders' }],
      headers: { Referer: 'https://new.example.com' },
      timeout: 30,
      createdAt: new Date(0),
    });
    expect(definition.url).toBe('https://old.example.com/');
    expect(copy.createdAt).toBe(definition.createdAt);
  });

  it('changes nothing without a target or rules', () => {
    const definition = { url: 'https://old.example.com' };
    expect(retargetDefinition(definition, undefined)).toBe(definition);
    expect(retargetDefinition(definition, { url: 'https://x.test', rewriteFrom: [] })).toBe(
      definition,
    );
  });
});

describe('the name of a side without an environment', () => {
  it('is the host, with the path when there is one', () => {
    expect(comparisonSideLabel('https://old.example.com')).toBe('old.example.com');
    expect(comparisonSideLabel('https://host.test:8443/app')).toBe('host.test:8443/app');
  });
});
