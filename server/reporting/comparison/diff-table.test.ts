import { describe, expect, it } from 'vitest';
import { comparisonPolicyOf } from '@shared/comparison';
import { diffTable } from './diff-table';
import { stepsWith } from './test-fixtures';

const table = (rows: string[][], name = 'orders') => stepsWith('table', { name, data: { rows } });
const policy = comparisonPolicyOf({});
const paths = (d: { path: string }[]) => d.map((x) => x.path);

describe('diffTable', () => {
  it('finds nothing between equal tables, nor between cells equal under the policy', () => {
    expect(diffTable(table([['a', '1']]), table([['a', '1']]), policy)).toEqual([]);
    const tolerant = comparisonPolicyOf({ numeric: { absTolerance: 0.01 } });
    expect(
      diffTable(table([['a  b', '1.000,00']]), table([['a b', '1,000.005']]), tolerant),
    ).toEqual([]);
  });

  it('reports each differing cell, a row on one side only once, and the counts', () => {
    const d = diffTable(
      table([
        ['id', 'total'],
        ['1', '10'],
        ['2', '20'],
      ]),
      table([
        ['id', 'total', 'extra'],
        ['1', '11'],
      ]),
      policy,
    );
    expect(paths(d)).toEqual([
      'rows.length',
      'rows[0].length',
      'rows[0][2]',
      'rows[1][1]',
      'rows[2]',
    ]);
    expect(d.find((x) => x.path === 'rows[1][1]')).toMatchObject({
      kind: 'table',
      checkpoint: 'orders',
      baseline: '10',
      candidate: '11',
      severity: 'blocking',
    });
  });

  it('applies the replace rules before comparing', () => {
    const p = comparisonPolicyOf({ text: { replace: [{ pattern: 'ORD-\\d+', with: 'ORD' }] } });
    expect(diffTable(table([['ORD-1']]), table([['ORD-2']]), p)).toEqual([]);
  });

  it('reports a table on one side only as one difference', () => {
    const d = diffTable(table([['a']]), table([['a']], 'other'), policy);
    expect(d.map((x) => [x.checkpoint, x.baseline === null, x.candidate === null])).toEqual([
      ['orders', false, true],
      ['other', true, false],
    ]);
  });
});
