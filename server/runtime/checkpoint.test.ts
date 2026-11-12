import { describe, expect, it } from 'vitest';
import {
  MAX_CHECKPOINT_BYTES,
  MAX_TABLE_ROWS,
  MAX_NETWORK_ENTRIES,
  MAX_TEXT_MATCHES,
  type ChartCheckpointData,
  type NetworkCheckpointData,
  type NetworkCheckpointEntry,
} from '@shared/comparison';
import {
  chartCheckpoint,
  checkpointHash,
  networkCheckpoint,
  normaliseText,
  parseTableCheckpointValue,
  tableCheckpoint,
  textCheckpoint,
} from './checkpoint';

describe('textCheckpoint', () => {
  it('normalises whitespace and hashes the canonical data', () => {
    const capture = textCheckpoint('total', ['  € 12,50\n', 'a\t\tb']);
    expect(capture).toEqual({
      name: 'total',
      kind: 'text',
      data: { texts: ['€ 12,50', 'a b'] },
      hash: checkpointHash({ texts: ['€ 12,50', 'a b'] }),
    });
    expect(capture.truncated).toBeUndefined();
  });

  it('hashes the same texts the same way, and different ones differently', () => {
    expect(textCheckpoint('a', ['x  y']).hash).toBe(textCheckpoint('b', ['x y']).hash);
    expect(textCheckpoint('a', ['x']).hash).not.toBe(textCheckpoint('a', ['y']).hash);
  });

  it('keeps at most MAX_TEXT_MATCHES texts and marks the cut', () => {
    const capture = textCheckpoint('rows', Array.from({ length: MAX_TEXT_MATCHES + 5 }, String));
    expect((capture.data as { texts: string[] }).texts).toHaveLength(MAX_TEXT_MATCHES);
    expect(capture.truncated).toBe(true);
  });

  it('stays within MAX_CHECKPOINT_BYTES, cutting a single long text too', () => {
    const many = textCheckpoint(
      'many',
      Array.from({ length: 100 }, () => 'x'.repeat(2000)),
    );
    expect(Buffer.byteLength(JSON.stringify(many.data))).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES);
    expect(many.truncated).toBe(true);

    const one = textCheckpoint('one', ['é'.repeat(MAX_CHECKPOINT_BYTES)]);
    expect(Buffer.byteLength(JSON.stringify(one.data))).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES);
    expect((one.data as { texts: string[] }).texts[0].length).toBeGreaterThan(0);
    expect(one.truncated).toBe(true);
  });

  it('records an empty match list as no texts', () => {
    expect(textCheckpoint('none', []).data).toEqual({ texts: [] });
    expect(normaliseText('\n \t')).toBe('');
  });
});

describe('parseTableCheckpointValue', () => {
  it('reads the name alone with the default selectors', () => {
    expect(parseTableCheckpointValue(' orders ')).toEqual({
      name: 'orders',
      rows: 'tr',
      cells: 'th, td',
    });
  });

  it('reads rows and cells in any order, keeping commas in selectors', () => {
    expect(parseTableCheckpointValue('grid; cells=.cell, .head ; rows=.dx-row;')).toEqual({
      name: 'grid',
      rows: '.dx-row',
      cells: '.cell, .head',
    });
  });

  it('refuses a missing name and an unknown option', () => {
    expect(parseTableCheckpointValue('; rows=tr')).toHaveProperty('error');
    expect(parseTableCheckpointValue('grid; columns=td')).toHaveProperty('error');
    expect(parseTableCheckpointValue('grid; rows=')).toHaveProperty('error');
  });
});

describe('tableCheckpoint', () => {
  it('normalises every cell and hashes the rows', () => {
    const capture = tableCheckpoint('orders', [
      ['Id ', ' Total'],
      ['1', '€ 12,50\n'],
    ]);
    expect(capture).toEqual({
      name: 'orders',
      kind: 'table',
      data: {
        rows: [
          ['Id', 'Total'],
          ['1', '€ 12,50'],
        ],
      },
      hash: checkpointHash({
        rows: [
          ['Id', 'Total'],
          ['1', '€ 12,50'],
        ],
      }),
    });
  });

  it('keeps at most MAX_TABLE_ROWS rows and marks the cut', () => {
    const capture = tableCheckpoint(
      'big',
      Array.from({ length: MAX_TABLE_ROWS + 1 }, (_, i) => [String(i)]),
    );
    expect((capture.data as { rows: string[][] }).rows).toHaveLength(MAX_TABLE_ROWS);
    expect(capture.truncated).toBe(true);
  });

  it('stays within MAX_CHECKPOINT_BYTES, cutting a single wide row too', () => {
    const many = tableCheckpoint(
      'many',
      Array.from({ length: 100 }, () => ['x'.repeat(2000)]),
    );
    expect(Buffer.byteLength(JSON.stringify(many.data))).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES);
    expect(many.truncated).toBe(true);

    const wide = tableCheckpoint('wide', [['a', 'é'.repeat(MAX_CHECKPOINT_BYTES)]]);
    const rows = (wide.data as { rows: string[][] }).rows;
    expect(Buffer.byteLength(JSON.stringify(wide.data))).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES);
    expect(rows[0][0]).toBe('a');
    expect(rows[0][1].length).toBeGreaterThan(0);
    expect(wide.truncated).toBe(true);
  });

  it('records an empty table as no rows', () => {
    expect(tableCheckpoint('none', []).data).toEqual({ rows: [] });
    expect(tableCheckpoint('empty-row', [[]]).data).toEqual({ rows: [[]] });
  });
});

describe('chartCheckpoint', () => {
  it('keeps the one shape and trusts no field of a hook answer', () => {
    const capture = chartCheckpoint('sales', {
      series: [
        { name: ' Sales ', type: 'bar', points: [['Jan', 10], [2, Number.NaN], ['x'], 'junk'] },
        { points: 'not a list' },
      ],
      axes: [{ name: 'value', min: '0', max: 20 }],
      lines: [
        { axis: 'value', value: 15, label: 'Target' },
        { axis: 'value', value: 'high' },
      ],
      extra: 'ignored',
    });
    const data = {
      series: [
        {
          name: 'Sales',
          type: 'bar',
          points: [
            ['Jan', 10],
            [2, null],
            ['x', null],
            ['', null],
          ],
        },
        { name: '', type: '', points: [] },
      ],
      axes: [{ name: 'value', min: null, max: 20 }],
      lines: [{ axis: 'value', value: 15, label: 'Target' }],
    };
    expect(capture).toEqual({ name: 'sales', kind: 'chart', data, hash: checkpointHash(data) });
  });

  it('reads anything that is not a model as an empty chart', () => {
    expect(chartCheckpoint('none', null).data).toEqual({ series: [], axes: [], lines: [] });
    expect(chartCheckpoint('none', 'chart').data).toEqual({ series: [], axes: [], lines: [] });
  });

  it('stays within MAX_CHECKPOINT_BYTES, cutting points from the longest series', () => {
    const points = Array.from({ length: 20_000 }, (_, i) => [`point ${i}`, i]);
    const capture = chartCheckpoint('big', {
      series: [
        { name: 'long', type: 'line', points },
        { name: 'short', type: 'line', points: points.slice(0, 10) },
      ],
    });
    const data = capture.data as ChartCheckpointData;
    expect(Buffer.byteLength(JSON.stringify(data))).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES);
    expect(data.series[1].points).toHaveLength(10);
    expect(data.series[0].points[0]).toEqual(['point 0', 0]);
    expect(capture.truncated).toBe(true);
  });
});

describe('networkCheckpoint', () => {
  const entry = (i: number, path = `/api/items/${i}`): NetworkCheckpointEntry => ({
    method: 'GET',
    path,
    query: [],
    requestBodyHash: null,
    status: 200,
  });

  it('keeps the entries, hashed, and is not cut when all fit', () => {
    const c = networkCheckpoint('orders', [entry(1), entry(2)]);
    expect(c.kind).toBe('network');
    expect((c.data as NetworkCheckpointData).entries).toHaveLength(2);
    expect(c.hash).toBe(checkpointHash(c.data));
    expect(c.truncated).toBeUndefined();
  });

  it('is cut when the journal lost requests', () => {
    expect(networkCheckpoint('orders', [entry(1)], 3).truncated).toBe(true);
  });

  it('holds at most MAX_NETWORK_ENTRIES entries and MAX_CHECKPOINT_BYTES', () => {
    const many = Array.from({ length: MAX_NETWORK_ENTRIES + 10 }, (_, i) => entry(i));
    const counted = networkCheckpoint('n', many);
    expect((counted.data as NetworkCheckpointData).entries).toHaveLength(MAX_NETWORK_ENTRIES);
    expect(counted.truncated).toBe(true);

    const long = Array.from({ length: 100 }, (_, i) => entry(i, `/api/${'x'.repeat(2000)}/${i}`));
    const sized = networkCheckpoint('n', long);
    expect(JSON.stringify(sized.data).length).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES);
    expect((sized.data as NetworkCheckpointData).entries.length).toBeGreaterThan(0);
    expect(sized.truncated).toBe(true);
  });
});
