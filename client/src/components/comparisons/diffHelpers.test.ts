import { describe, it, expect } from 'vitest';
import { parseReplaceRules, defaultPolicy } from './PolicyEditor';
import { tableMarks } from './DiffTable';
import { overlayRows } from './DiffChart';
import { endOfDay } from './ReviewDialog';
import type { ComparisonDifference } from '@shared/comparison';

/**
 * The pure pieces behind the report's diffs and the tolerance editor: how replace rules are read
 * from the textarea, which table cells a difference marks, and how two charts share one axis.
 */

const difference = (path: string, extra: Partial<ComparisonDifference> = {}) =>
  ({
    stepId: 's1',
    stepIndex: 0,
    checkpoint: 'grid',
    kind: 'table',
    path,
    baseline: null,
    candidate: null,
    severity: 'blocking',
    ...extra,
  }) as ComparisonDifference;

describe('parseReplaceRules', () => {
  it('reads one "pattern => with" per line and skips blank lines', () => {
    expect(parseReplaceRules('\\d{4}-\\d{2} => DATE\n\n  ID-\\d+  \n')).toEqual([
      { pattern: '\\d{4}-\\d{2}', with: 'DATE' },
      { pattern: 'ID-\\d+', with: '' },
    ]);
  });

  it('starts from a policy that compares everything exactly', () => {
    expect(defaultPolicy().text.replace).toEqual([]);
  });
});

describe('tableMarks', () => {
  it('marks cells and whole rows, telling known from informative and blocking', () => {
    const { cells, rows } = tableMarks([
      difference('rows[1][2]'),
      difference('rows[0][0]', { severity: 'informative' }),
      difference('rows[3][1]', { knownDifferenceId: 'kd-1' }),
      difference('rows[4]'),
      difference('rows[5].length', { severity: 'informative' }),
      difference('headers[0]'),
    ]);
    expect(Object.fromEntries(cells)).toEqual({
      '1:2': 'blocking',
      '0:0': 'informative',
      '3:1': 'known',
    });
    expect(Object.fromEntries(rows)).toEqual({ 4: 'blocking', 5: 'informative' });
  });
});

describe('overlayRows', () => {
  it('puts both sides on one x axis, a key per series and side', () => {
    const axes: never[] = [];
    const { names, rows } = overlayRows(
      {
        series: [
          {
            name: 'sales',
            type: 'line',
            points: [
              ['jan', 1],
              ['feb', 2],
            ],
          },
        ],
        axes,
        lines: [],
      },
      {
        series: [
          {
            name: 'sales',
            type: 'line',
            points: [
              ['feb', 3],
              ['mar', 4],
            ],
          },
          { name: 'cost', type: 'line', points: [['jan', 9]] },
        ],
        axes,
        lines: [],
      },
    );
    expect(names).toEqual(['sales', 'cost']);
    expect(rows).toEqual([
      { x: 'jan', b0: 1, c1: 9 },
      { x: 'feb', b0: 2, c0: 3 },
      { x: 'mar', c0: 4 },
    ]);
  });

  it('copes with a side that has no chart', () => {
    expect(overlayRows(null, null)).toEqual({ names: [], rows: [] });
  });
});

describe('endOfDay', () => {
  it('is the last second of the chosen local day', () => {
    const at = new Date(endOfDay('2026-12-31'));
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual(
      [2026, 11, 31, 23, 59],
    );
  });
});
