import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { XLSX_UPLOAD_DIR, XlsxLimitError, assertXlsxWithinLimits } from './xlsx-guard';
import { buildZip, type ZipPart } from './xlsx-fixtures';

const created: string[] = [];
function write(buf: Buffer): string {
  fs.mkdirSync(XLSX_UPLOAD_DIR, { recursive: true });
  const f = path.join(XLSX_UPLOAD_DIR, `guard-${Date.now()}-${created.length}.xlsx`);
  fs.writeFileSync(f, buf);
  created.push(f);
  return f;
}
afterEach(() => {
  for (const f of created.splice(0)) fs.rmSync(f, { force: true });
});

const sheet = (body: string) =>
  `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData>${body}</sheetData></worksheet>`;

describe('assertXlsxWithinLimits', () => {
  it('rejects an entry declaring 1 KB that inflates to 60 MB (before ExcelJS sees it)', async () => {
    const part: ZipPart = {
      name: 'xl/worksheets/sheet1.xml',
      data: Buffer.from(sheet(`<!--${' '.repeat(60 * 1024 * 1024)}-->`)),
      declaredUncompressed: 1024,
    };
    const f = write(buildZip([part]));
    expect(fs.statSync(f).size).toBeLessThan(200 * 1024);
    await expect(assertXlsxWithinLimits(f)).rejects.toBeInstanceOf(XlsxLimitError);
  });

  it('rejects declared sizes that differ from the real content', async () => {
    const f = write(
      buildZip([{ name: 'a.xml', data: Buffer.from('x'.repeat(5000)), declaredUncompressed: 10 }]),
    );
    await expect(assertXlsxWithinLimits(f)).rejects.toBeInstanceOf(XlsxLimitError);
  });

  it('does not trust the sheet dimension: 200 000 rows under A1:B2 stay within byte limits', async () => {
    const rows = Array.from(
      { length: 200000 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>v${i}</t></is></c></row>`,
    ).join('');
    const f = write(
      buildZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet(rows)) }]),
    );
    // Real size ~14 MB is bounded by the byte limits, which are now measured, not declared.
    await expect(assertXlsxWithinLimits(f)).resolves.toBeUndefined();
  });

  it('accepts a genuine workbook written by ExcelJS', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('S').addRow(['a', 'b']);
    const f = write(Buffer.from(await wb.xlsx.writeBuffer()));
    await expect(assertXlsxWithinLimits(f)).resolves.toBeUndefined();
  });
});
