import { describe, expect, it } from 'vitest';
import type { ComparisonDifference } from '@shared/comparison';
import { markKnownDifferences, type KnownDifferenceRule } from './known-differences';

const diff = (over: Partial<ComparisonDifference> = {}): ComparisonDifference => ({
  stepId: 's1',
  stepIndex: 0,
  checkpoint: 'orders',
  kind: 'table',
  path: 'rows[3][2]',
  baseline: '1',
  candidate: '2',
  severity: 'blocking',
  ...over,
});
const rule = (over: Partial<KnownDifferenceRule> = {}): KnownDifferenceRule => ({
  id: 'k1',
  projectId: null,
  uiTestId: null,
  checkpointName: null,
  kind: 'table',
  pathPattern: null,
  expiresAt: null,
  ...over,
});
const scope = { projectId: 5, uiTestId: 9 };
const ids = (d: ComparisonDifference[]) => d.map((x) => x.knownDifferenceId ?? null);

describe('markKnownDifferences', () => {
  it('marks a difference of the same kind, checkpoint and path pattern', () => {
    const mark = markKnownDifferences([
      rule({ checkpointName: 'orders', pathPattern: 'rows[*][2]' }),
    ]);
    const marked = mark(
      [diff(), diff({ path: 'rows[3][1]' }), diff({ kind: 'text' }), diff({ checkpoint: 'x' })],
      scope,
    );
    expect(ids(marked)).toEqual(['k1', null, null, null]);
  });

  it('honours the scope: organization, project, test', () => {
    const d = [diff()];
    expect(ids(markKnownDifferences([rule({ projectId: 5 })])(d, scope))).toEqual(['k1']);
    expect(ids(markKnownDifferences([rule({ projectId: 6 })])(d, scope))).toEqual([null]);
    expect(ids(markKnownDifferences([rule({ uiTestId: 9 })])(d, scope))).toEqual(['k1']);
    expect(ids(markKnownDifferences([rule({ uiTestId: 8 })])(d, scope))).toEqual([null]);
  });

  it('skips an expired rule, and the first matching rule wins', () => {
    const now = new Date('2026-11-12T00:00:00Z');
    const rules = [
      rule({ id: 'old', expiresAt: new Date('2026-11-01T00:00:00Z') }),
      rule({ id: 'a', expiresAt: new Date('2026-12-01T00:00:00Z') }),
      rule({ id: 'b' }),
    ];
    expect(ids(markKnownDifferences(rules, now)([diff()], scope))).toEqual(['a']);
  });
});
