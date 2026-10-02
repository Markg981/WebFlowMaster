import path from 'path';
import fs from 'fs-extra';
import type { DownloadedFile, DownloadType } from '@shared/downloads';

/**
 * Reads a file a test downloaded, for the checks of an `expectDownload` step (shared/downloads.ts):
 * its kind, size, and the text in it — a PDF's text through pdf.js (unpdf), a CSV's or a
 * spreadsheet's cells, anything else as UTF-8 text.
 */

const MAX_TEXT = 2_000_000;

function typeOf(name: string, head: Buffer): DownloadType {
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const ext = path.extname(name).toLowerCase().replace('.', '');
  if (ext === 'xlsx' || (head[0] === 0x50 && head[1] === 0x4b && ext === 'xlsx')) return 'xlsx';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'json') return 'json';
  if (ext === 'txt' || ext === 'log' || ext === 'xml' || ext === 'html') return 'txt';
  return 'other';
}

/** CSV rows, with the delimiter guessed from the first line (`,`, `;` or tab) and quoted fields. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

export async function inspectDownload(file: string, name: string): Promise<{ file: DownloadedFile; text: string }> {
  const buffer = await fs.readFile(file);
  const type = typeOf(name, buffer.subarray(0, 8));
  const base = { name, type, size: buffer.length };
  let text = '';
  let extra: Partial<DownloadedFile> = {};
  if (type === 'pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = String(result.text ?? '');
    extra = { pages: result.totalPages };
  } else if (type === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    const rows: string[][] = [];
    sheet?.eachRow({ includeEmpty: false }, (r) => {
      const values = (r.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? '' : typeof v === 'object' && v && 'text' in (v as object) ? String((v as { text: unknown }).text) : typeof v === 'object' && v && 'result' in (v as object) ? String((v as { result: unknown }).result) : String(v)));
      rows.push(values);
    });
    text = rows.map((r) => r.join(' ')).join('\n');
    extra = { rows: rows.length, columns: Math.max(0, ...rows.map((r) => r.length)) };
  } else {
    text = buffer.subarray(0, MAX_TEXT).toString('utf8');
    if (type === 'csv') {
      const rows = parseCsv(text);
      extra = { rows: rows.length, columns: Math.max(0, ...rows.map((r) => r.length)) };
      text = rows.map((r) => r.join(' ')).join('\n');
    }
  }
  return { file: { ...base, ...extra, sample: text.replace(/\s+/g, ' ').trim().slice(0, 300) }, text: text.slice(0, MAX_TEXT) };
}
