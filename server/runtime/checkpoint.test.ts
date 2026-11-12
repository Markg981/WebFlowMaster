import { describe, expect, it } from 'vitest';
import { MAX_CHECKPOINT_BYTES, MAX_TABLE_ROWS, MAX_TEXT_MATCHES } from '@shared/comparison';
import {
  checkpointHash,
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
