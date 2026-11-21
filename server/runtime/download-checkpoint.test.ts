import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { DownloadCheckpointData } from '@shared/comparison';
import {
  parseDownloadCheckpointValue,
  type DownloadCheckpointValue,
} from '@shared/download-checkpoint';
import { XlsxLimitError } from '../integrations/xlsx-guard';
import { buildZip } from '../integrations/xlsx-fixtures';
import { downloadCheckpoint, formatDate, formatNumber } from './download-checkpoint';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-download-checkpoint-'));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let n = 0;
function write(name: string, content: Buffer | string): string {
  n += 1;
  const file = path.join(dir, `${n}_${name}`);
  fs.writeFileSync(file, content);
  return file;
}

function value(raw: string): DownloadCheckpointValue {
  const parsed = parseDownloadCheckpointValue(raw);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed;
}

async function capture(name: string, content: Buffer | string, raw = 'export') {
  const checkpoint = await downloadCheckpoint(write(name, content), name, value(raw), dir);
  return { ...checkpoint, data: checkpoint.data as DownloadCheckpointData };
}

/** A PDF whose pages hold the given lines, one text line each, written by hand. */
function pdfOf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, i) => {
    const text = lines
      .map((line, k) => `${k === 0 ? '72 720 Td' : '0 -16 Td'} (${line}) Tj`)
      .join('\n');
    const stream = `BT /F1 12 Tf\n${text}\nET`;
    objects[pageIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1)
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('formatNumber', () => {
  it.each([
    [1234.5, '#,##0.00', '1,234.50'],
    [0.256, '0.0%', '25.6%'],
    [-42, '#,##0;(#,##0)', '(42)'],
    [-42.5, '0.00', '-42.50'],
    [3.1, '0.0#', '3.1'],
    [3.14159, '0.0#', '3.14'],
    [1234567, '#,##0,"K"', '1,235K'],
    [9.5, '"€" #,##0.00', '€ 9.50'],
    [12, 'General', '12'],
    [0.1 + 0.2, undefined, '0.3'],
  ])('%s with %s is %s', (n, format, expected) => {
    expect(formatNumber(n, format)).toBe(expected);
  });
});

describe('formatDate', () => {
  const date = new Date(Date.UTC(2026, 2, 7, 14, 5, 9));
  it.each([
    ['dd/mm/yyyy', '07/03/2026'],
    ['yyyy-mm-dd hh:mm:ss', '2026-03-07 14:05:09'],
    ['d mmm yy', '7 Mar 26'],
    ['h:mm AM/PM', '2:05 PM'],
    [undefined, '2026-03-07 14:05:09'],
  ])('%s', (format, expected) => {
    expect(formatDate(date, format)).toBe(expected);
  });
});

describe('downloadCheckpoint of a workbook', () => {
  async function workbook(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet('Summary');
    summary.getCell('B2').value = 'Batch Summary';
    summary.mergeCells('B2:D2');
    summary.getCell('B3').value = 'Printed 07/03/2026 14:05';
    summary.getCell('B4').value = 'Total';
    summary.getCell('C4').value = 1234.5;
    summary.getCell('C4').numFmt = '#,##0.00';
    summary.getCell('D4').value = { formula: 'C4*2', result: 2469 };
    summary.getCell('B5').value = new Date(Date.UTC(2026, 2, 7));
    summary.getCell('B5').numFmt = 'dd/mm/yyyy';
    summary.getCell('C5').value = { richText: [{ text: 'Rich ' }, { text: 'text' }] };
    summary.getCell('D5').value = 0.25;
    summary.getCell('D5').numFmt = '0%';
    const detail = wb.addWorksheet('Detail', { state: 'hidden' });
    for (let r = 1; r <= 10; r += 1) detail.addRow([`r${r}`, r, r * 10]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('keeps the sheets in order with their used range as displayed, and the merged cells', async () => {
    const { data, kind, truncated } = await capture(
      'report_20260307_140509.xlsx',
      await workbook(),
    );
    expect(kind).toBe('download');
    expect(truncated).toBeUndefined();
    expect(data.type).toBe('xlsx');
    expect(data.extension).toBe('xlsx');
    expect(data.sheets?.map((s) => s.name)).toEqual(['Summary', 'Detail']);
    const [summary, detail] = data.sheets!;
    expect(summary.range).toBe('B2:D5');
    expect(summary.merges).toEqual(['B2:D2']);
    expect(summary.rows).toEqual([
      ['Batch Summary', '', ''],
      ['Printed 07/03/2026 14:05', '', ''],
      ['Total', '1,234.50', '2469'],
      ['07/03/2026', 'Rich text', '25%'],
    ]);
    expect(detail.hidden).toBe(true);
    expect(detail.range).toBe('A1:C10');
  });

  it('masks the file name and the content, and bounds the rows and columns kept', async () => {
    const { data, truncated, hash } = await capture(
      'report_20260307_140509.xlsx',
      await workbook(),
      'export; rows=3; cols=2 | \\d{8}_\\d{6} | \\d{2}/\\d{2}/\\d{4}( \\d{2}:\\d{2})?',
    );
    expect(data.fileName).toBe('report_<masked>.xlsx');
    expect(data.sheets![0].rows).toEqual([
      ['Batch Summary', ''],
      ['Printed <masked>', ''],
      ['Total', '1,234.50'],
    ]);
    expect(data.sheets![1].rows).toHaveLength(3);
    expect(truncated).toBe(true);
    // The masked parts change, the checkpoint does not.
    const again = await capture(
      'report_20260308_090000.xlsx',
      await workbook(),
      'export; rows=3; cols=2 | \\d{8}_\\d{6} | \\d{2}/\\d{2}/\\d{4}( \\d{2}:\\d{2})?',
    );
    expect(again.hash).toBe(hash);
  });

  it('refuses a workbook that inflates past the zip-bomb limits before reading it', async () => {
    const bomb = buildZip([
      {
        name: 'xl/worksheets/sheet1.xml',
        data: Buffer.from(' '.repeat(60 * 1024 * 1024)),
        declaredUncompressed: 1024,
      },
    ]);
    await expect(capture('bomb.xlsx', bomb)).rejects.toBeInstanceOf(XlsxLimitError);
  });
});

describe('downloadCheckpoint of a PDF', () => {
  it('keeps the page count and each page’s lines, whitespace collapsed and masked', async () => {
    const { data } = await capture(
      'summary.pdf',
      pdfOf([
        ['Batch   Summary', 'Printed on 07/03/2026'],
        ['Line one', 'Line two'],
      ]),
      'export | | \\d{2}/\\d{2}/\\d{4}',
    );
    expect(data.type).toBe('pdf');
    expect(data.pageCount).toBe(2);
    expect(data.pages).toEqual([
      ['Batch Summary', 'Printed on <masked>'],
      ['Line one', 'Line two'],
    ]);
  });
});

describe('downloadCheckpoint of other files', () => {
  it('reads a CSV as one sheet without a name', async () => {
    const { data } = await capture('list.csv', 'id;name\n1;Ada\n2;Grace;extra\n');
    expect(data.type).toBe('csv');
    expect(data.sheets).toEqual([
      {
        name: '',
        range: 'A1:C3',
        rows: [
          ['id', 'name', ''],
          ['1', 'Ada', ''],
          ['2', 'Grace', 'extra'],
        ],
        merges: [],
      },
    ]);
  });

  it('hashes anything else, a text after its mask, and leaves the size out of the hash', async () => {
    const a = await capture('blob.bin', Buffer.from([1, 2, 3]));
    expect(a.data.type).toBe('other');
    expect(a.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    const mask = 'export | | \\d{4}-\\d{1,2}-\\d{1,2}';
    const x = await capture('a.txt', 'printed 2026-03-07', mask);
    const y = await capture('a.txt', 'printed 2026-03-08 and more', mask);
    expect(x.data.sha256).not.toBe(y.data.sha256);
    const z = await capture('a.txt', 'printed 2026-3-8', mask);
    expect(z.data.size).not.toBe(x.data.size);
    expect(z.hash).toBe(x.hash);
  });

  it('cuts the longest list until the checkpoint fits its byte limit', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `${i};${'x'.repeat(100)}`).join('\n');
    const { data, truncated } = await capture('big.csv', rows, 'export; rows=5000');
    expect(truncated).toBe(true);
    expect(JSON.stringify(data).length).toBeLessThanOrEqual(256 * 1024);
    expect(data.sheets![0].rows.length).toBeLessThan(5000);
  });
});
