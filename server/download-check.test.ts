import { describe, it, expect } from 'vitest';
import { parseCsv } from './download-check';

describe('CSV downloaded content', () => {
  it('ignores delimiters inside quoted headers when identifying the separator', () => {
    expect(parseCsv('"a;b;c;d",name\r\n"one;two",Mario\r\n')).toEqual([
      ['a;b;c;d', 'name'], ['one;two', 'Mario'],
    ]);
  });

  it('reads a BOM, multiline fields and escaped quotes without changing cells', () => {
    expect(parseCsv('\uFEFF"description";name\n"first\nsecond ""line""";Ada\n')).toEqual([
      ['description', 'name'], ['first\nsecond "line"', 'Ada'],
    ]);
  });
});
