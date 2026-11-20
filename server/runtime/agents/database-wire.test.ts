import { describe, expect, it } from 'vitest';
import { decodeDatabaseValue, encodeDatabaseValue } from './database-wire';

const roundTrip = (value: unknown) =>
  decodeDatabaseValue(JSON.parse(JSON.stringify(encodeDatabaseValue(value))));

describe('database values over the relay', () => {
  it('rebuilds what JSON cannot carry: 64-bit integers, dates and binary columns', () => {
    const result = roundTrip({
      columns: ['id', 'at', 'blob'],
      rows: [
        {
          id: 9007199254740993n,
          at: new Date('2026-11-20T10:00:00.000Z'),
          blob: Buffer.from([0, 1, 255]),
        },
      ],
      rowCount: 1,
    }) as { rows: Array<Record<string, unknown>> };
    const [row] = result.rows;
    expect(row.id).toBe(9007199254740993n);
    expect(row.at).toEqual(new Date('2026-11-20T10:00:00.000Z'));
    expect(Buffer.isBuffer(row.blob)).toBe(true);
    expect([...(row.blob as Buffer)]).toEqual([0, 1, 255]);
  });

  it('keeps an invalid date invalid', () => {
    const value = roundTrip(new Date(Number.NaN)) as Date;
    expect(value).toBeInstanceOf(Date);
    expect(Number.isNaN(value.getTime())).toBe(true);
  });

  it('leaves a JSON column that uses the tag as a key as it was', () => {
    const column = { $wfm: 'date', v: 'not a date', nested: { $wfm: 'bigint', v: '1' } };
    expect(roundTrip(column)).toEqual(column);
    const exact = { $wfm: 'bigint', v: '12' };
    expect(roundTrip(exact)).toEqual(exact);
  });

  it('passes plain values, arrays and nulls through', () => {
    const value = { a: [1, 'two', null, true, { b: 2n }], c: null };
    expect(roundTrip(value)).toEqual(value);
  });
});
