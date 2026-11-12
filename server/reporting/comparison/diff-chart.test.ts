import { describe, expect, it } from 'vitest';
import { comparisonPolicyOf, type ChartCheckpointData } from '@shared/comparison';
import { diffChart } from './diff-chart';
import { stepsWith } from './test-fixtures';

const chart = (data: Partial<ChartCheckpointData>) =>
  stepsWith('chart', { name: 'sales', data: { series: [], axes: [], lines: [], ...data } });
const policy = comparisonPolicyOf({});
const paths = (d: { path: string }[]) => d.map((x) => x.path);

describe('diffChart', () => {
  it('pairs points by argument, so a missing category shifts nothing', () => {
    const d = diffChart(
      chart({
        series: [
          {
            name: 'S',
            type: 'bar',
            points: [
              ['Jan', 1],
              ['Feb', 2],
              ['Mar', 3],
            ],
          },
        ],
      }),
      chart({
        series: [
          {
            name: 'S',
            type: 'bar',
            points: [
              ['Jan', 1],
              ['Mar', 3],
            ],
          },
        ],
      }),
      policy,
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ path: 'series[S].points[Feb]', baseline: 2, candidate: null });
  });

  it('compares values within the numeric tolerance', () => {
    const a = chart({ series: [{ name: 'S', type: 'line', points: [[1, 100]] }] });
    const b = chart({ series: [{ name: 'S', type: 'line', points: [[1, 100.4]] }] });
    expect(paths(diffChart(a, b, policy))).toEqual(['series[S].points[1]']);
    expect(diffChart(a, b, comparisonPolicyOf({ numeric: { relTolerance: 0.01 } }))).toEqual([]);
  });

  it('reports a series on one side only, a type change, axes and reference lines', () => {
    const d = diffChart(
      chart({
        series: [
          { name: 'S', type: 'bar', points: [] },
          { name: 'Gone', type: 'bar', points: [] },
        ],
        axes: [{ name: 'value', min: 0, max: 100 }],
        lines: [{ axis: 'value', value: 50, label: 'target' }],
      }),
      chart({
        series: [{ name: 'S', type: 'line', points: [] }],
        axes: [{ name: 'value', min: 0, max: 120 }],
        lines: [{ axis: 'value', value: 60, label: 'target' }],
      }),
      policy,
    );
    expect(paths(d)).toEqual([
      'series[S].type',
      'series[Gone]',
      'axes[value].max',
      'lines[value:target]',
    ]);
  });

  it('pairs two series of the same name in order', () => {
    const s = (y: number) => ({ name: 'S', type: 'bar', points: [['x', y]] as [string, number][] });
    const d = diffChart(chart({ series: [s(1), s(2)] }), chart({ series: [s(1), s(3)] }), policy);
    expect(paths(d)).toEqual(['series[S#2].points[x]']);
  });
});
