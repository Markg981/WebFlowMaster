import { createHash } from 'node:crypto';
import path from 'path';
import fs from 'fs-extra';
import type ExcelJS from 'exceljs';
import {
  MAX_DOWNLOAD_CHECKPOINT_BYTES,
  type CheckpointCapture,
  type DownloadCheckpointData,
  type DownloadCheckpointSheet,
} from '@shared/comparison';
import {
  applyMask,
  columnLetters,
  type DownloadCheckpointValue,
} from '@shared/download-checkpoint';
import { canonical } from '../authoring/step-provenance';
import { assertXlsxWithinLimits } from '../platform/xlsx-guard';
import { checkpointHash, normaliseText } from './checkpoint';
import { downloadTypeOf, parseCsv } from './download-check';

/**
 * What a `checkpointDownload` step keeps of the file a click downloaded (shared/comparison.ts,
 * DownloadCheckpointData): a workbook's sheets as displayed, a PDF's lines page by page, a CSV's
 * rows, or the sha-256 of anything else. The volatile parts the step masks are replaced first, and
 * the whole is bounded by MAX_DOWNLOAD_CHECKPOINT_BYTES.
 */

/** Beyond this size a file is only hashed: reading it would cost more than it tells. */
export const MAX_PARSED_DOWNLOAD_BYTES = 50 * 1024 * 1024;
/** The most pages of a PDF whose text is read; the page count is always kept. */
export const MAX_PDF_PAGES = 200;

const canonicalJson = (value: unknown) => JSON.stringify(canonical(value)) ?? 'null';
const bytes = (value: unknown) => Buffer.byteLength(canonicalJson(value), 'utf8');

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A format section without what Excel does not print: colours, conditions, padding, quotes. */
function literalsOf(section: string): string {
  return section
    .replace(/\[\$([^\]-]*)(-[^\]]*)?\]/g, '$1')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/_./g, ' ')
    .replace(/\*./g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/"([^"]*)"/g, '$1');
}

/** A date as an Excel date format writes it (in UTC, as ExcelJS reads it); ISO when unsure. */
export function formatDate(date: Date, format: string | undefined): string {
  if (Number.isNaN(date.getTime())) return '';
  const section = literalsOf((format ?? '').split(';')[0]);
  if (!/[ydhs]/i.test(section)) {
    const iso = date.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  const ampm = /AM\/PM|A\/P/i.test(section);
  const tokens =
    section.match(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|./gi) ?? [];
  const hour = date.getUTCHours();
  const out: string[] = [];
  tokens.forEach((token, i) => {
    const lower = token.toLowerCase();
    // `m` and `mm` are minutes after an hour or before a second, months otherwise.
    const before = tokens
      .slice(0, i)
      .reverse()
      .find((t) => /^[a-z]/i.test(t))
      ?.toLowerCase();
    const after = tokens
      .slice(i + 1)
      .find((t) => /^[a-z]/i.test(t))
      ?.toLowerCase();
    const minutes =
      (lower === 'm' || lower === 'mm') &&
      (before?.startsWith('h') === true || after?.startsWith('s') === true);
    switch (lower) {
      case 'yyyy':
        return out.push(String(date.getUTCFullYear()));
      case 'yy':
        return out.push(pad(date.getUTCFullYear() % 100));
      case 'mmmm':
        return out.push(MONTHS[date.getUTCMonth()]);
      case 'mmm':
        return out.push(MONTHS[date.getUTCMonth()].slice(0, 3));
      case 'mm':
        return out.push(minutes ? pad(date.getUTCMinutes()) : pad(date.getUTCMonth() + 1));
      case 'm':
        return out.push(minutes ? String(date.getUTCMinutes()) : String(date.getUTCMonth() + 1));
      case 'dddd':
        return out.push(DAYS[date.getUTCDay()]);
      case 'ddd':
        return out.push(DAYS[date.getUTCDay()].slice(0, 3));
      case 'dd':
        return out.push(pad(date.getUTCDate()));
      case 'd':
        return out.push(String(date.getUTCDate()));
      case 'hh':
        return out.push(pad(ampm ? hour % 12 || 12 : hour));
      case 'h':
        return out.push(String(ampm ? hour % 12 || 12 : hour));
      case 'ss':
        return out.push(pad(date.getUTCSeconds()));
      case 's':
        return out.push(String(date.getUTCSeconds()));
      case 'am/pm':
        return out.push(hour < 12 ? 'AM' : 'PM');
      case 'a/p':
        return out.push(hour < 12 ? 'A' : 'P');
      default:
        return out.push(token);
    }
  });
  return out.join('');
}

/** A number as Excel's General format shows it: at most 11 significant digits. */
function generalNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e11) return String(n);
  return String(Number(n.toPrecision(11)));
}

/**
 * A number as its Excel format writes it, for the formats exports use: decimals, thousands
 * separators, percentages, currency symbols and literal text, a separate section for negatives.
 * Written with `.` for decimals and `,` for thousands, as Excel stores the format.
 */
export function formatNumber(n: number, format: string | undefined): string {
  if (!format || /^general$/i.test(format.trim())) return generalNumber(n);
  const sections = format.split(';');
  const own = n < 0 && sections.length > 1;
  const section = literalsOf(
    own ? sections[1] : n === 0 && sections[2] ? sections[2] : sections[0],
  );
  if (/^@?$/.test(section.trim())) return generalNumber(n);
  const first = section.search(/[0#?]/);
  if (first < 0) return section;
  let last = first;
  for (let i = first; i < section.length; i += 1) if (/[0#?.,]/.test(section[i])) last = i;
  const pattern = section.slice(first, last + 1);
  const prefix = section.slice(0, first);
  const suffix = section.slice(last + 1);
  const percent = (section.match(/%/g) ?? []).length;
  // Commas after the last digit placeholder divide by a thousand each.
  const scale = (pattern.match(/,+$/)?.[0].length ?? 0) * 3;
  const digits = pattern.replace(/,+$/, '');
  const decimals = (digits.split('.')[1] ?? '').replace(/[^0#?]/g, '');
  const minDecimals = (decimals.match(/0/g) ?? []).length;
  const scaled = (Math.abs(n) * 100 ** percent) / 10 ** scale;
  let [int, frac = ''] = scaled.toFixed(decimals.length).split('.');
  // `#` and `?` decimals are optional: their trailing zeros are not written.
  while (frac.length > minDecimals && frac.endsWith('0')) frac = frac.slice(0, -1);
  const minInt = ((digits.split('.')[0] ?? '').match(/0/g) ?? []).length;
  if (int === '0' && minInt === 0) int = '';
  int = int.padStart(minInt, '0');
  if (digits.includes(',')) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = n < 0 && !own && scaled !== 0 ? '-' : '';
  return `${sign}${prefix}${int}${frac ? `.${frac}` : ''}${suffix}`;
}

/** What a cell displays: its formatted value, the result of its formula, its rich text. */
export function displayedCell(cell: ExcelJS.Cell): string {
  // A merged region shows its value once, in its top-left cell.
  if (cell.isMerged && cell.master && cell.master.address !== cell.address) return '';
  const value: unknown = cell.value;
  return displayedValue(value, cell.numFmt);
}

function displayedValue(value: unknown, format: string | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return formatNumber(value, format);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return formatDate(value, format);
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText))
      return v.richText.map((part) => String((part as { text?: unknown }).text ?? '')).join('');
    if ('error' in v) return String(v.error);
    if ('formula' in v || 'sharedFormula' in v) return displayedValue(v.result, format);
    if ('text' in v) return displayedValue(v.text, format);
  }
  return String(value);
}

/** One sheet's used range, displayed, masked and bounded by the step's rows and columns. */
function sheetOf(
  sheet: ExcelJS.Worksheet,
  options: DownloadCheckpointValue,
): { sheet: DownloadCheckpointSheet; cut: boolean } {
  const cells = new Map<string, string>();
  let top = Infinity;
  let left = Infinity;
  let bottom = 0;
  let right = 0;
  sheet.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      const text = applyMask(normaliseText(displayedCell(cell)), options.contentMask);
      if (text === '') return;
      cells.set(`${r}:${c}`, text);
      top = Math.min(top, r);
      left = Math.min(left, c);
      bottom = Math.max(bottom, r);
      right = Math.max(right, c);
    });
  });
  const merges = Object.values(
    (sheet as unknown as { _merges?: Record<string, { tl: string; br: string }> })._merges ?? {},
  )
    .map((m) => `${m.tl}:${m.br}`)
    .sort();
  const hidden = sheet.state && sheet.state !== 'visible' ? { hidden: true } : {};
  if (bottom === 0)
    return { sheet: { name: sheet.name, ...hidden, range: '', rows: [], merges }, cut: false };
  const lastRow = Math.min(bottom, top + options.rows - 1);
  const lastCol = Math.min(right, left + options.cols - 1);
  const rows: string[][] = [];
  for (let r = top; r <= lastRow; r += 1) {
    const row: string[] = [];
    for (let c = left; c <= lastCol; c += 1) row.push(cells.get(`${r}:${c}`) ?? '');
    rows.push(row);
  }
  return {
    sheet: {
      name: sheet.name,
      ...hidden,
      range: `${columnLetters(left)}${top}:${columnLetters(right)}${bottom}`,
      rows,
      merges,
    },
    cut: lastRow < bottom || lastCol < right,
  };
}

/**
 * ExcelJS only reads parts whose elements are unprefixed (`<workbook>`), but the Open XML SDK
 * writes them with a prefix (`<x:workbook xmlns:x="...">`): ExcelJS then finds no workbook and
 * fails on `undefined.sheets`. Each XML part whose root element is prefixed, and that has no
 * default namespace, gets that prefix's namespace as its default one and loses the prefix on
 * every element, but only for the namespaces ExcelJS reads unprefixed: it expects `cp:`/`dc:`
 * in docProps/core.xml, for instance. Other prefixes (`r:id`, `mc:Ignorable`, `x14ac:`) are left
 * as they are. The theme is skipped: ExcelJS keeps it as raw text. A workbook with no prefixed
 * part is returned as it was read.
 */
const UNPREFIXED_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
]);

export async function withDefaultNamespaces(buffer: Buffer): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.xml$/i.test(entry.name) || /(^|\/)xl\/theme\//.test(entry.name)) continue;
    const xml = await entry.async('string');
    const root = /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?<([\w.-]+):[\w.-]+[\s/>]/.exec(xml);
    if (!root) continue;
    const prefix = root[1]!;
    const declaration = new RegExp(`\\sxmlns:${prefix}="([^"]*)"`).exec(xml);
    const rootTag = xml.slice(root.index, xml.indexOf('>', root.index + root[0].length - 1) + 1);
    if (!declaration || !UNPREFIXED_NAMESPACES.has(declaration[1]!) || /\sxmlns="/.test(rootTag))
      continue;
    const unprefixed = xml
      .replace(declaration[0], ` xmlns="${declaration[1]}"`)
      .replace(new RegExp(`<(/?)${prefix}:`, 'g'), '<$1');
    zip.file(entry.name, unprefixed);
    changed = true;
  }
  return changed ? zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : buffer;
}

async function workbookSheets(
  file: string,
  root: string,
  options: DownloadCheckpointValue,
): Promise<{ sheets: DownloadCheckpointSheet[]; cut: boolean }> {
  // An .xlsx is a zip: check what it inflates to before ExcelJS does.
  await assertXlsxWithinLimits(file, root);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await withDefaultNamespaces(await fs.readFile(file)));
  let cut = false;
  const sheets = workbook.worksheets.map((ws) => {
    const read = sheetOf(ws, options);
    cut ||= read.cut;
    return read.sheet;
  });
  return { sheets, cut };
}

/** The lines of a page's text, whitespace collapsed, blank lines left out. */
export function pageLines(text: string, mask?: RegExp): string[] {
  return text
    .split('\n')
    .map((line) => applyMask(normaliseText(line), mask))
    .filter((line) => line !== '');
}

async function pdfPages(
  buffer: Buffer,
  mask: RegExp | undefined,
): Promise<{ pageCount: number; pages: string[][]; cut: boolean }> {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const pages: string[][] = [];
    const read = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= read; i += 1) {
      const content = await (await pdf.getPage(i)).getTextContent();
      const text = content.items
        .map((item) =>
          'str' in item ? item.str + ((item as { hasEOL?: boolean }).hasEOL ? '\n' : '') : '',
        )
        .join('');
      pages.push(pageLines(text, mask));
    }
    return { pageCount: pdf.numPages, pages, cut: pdf.numPages > read };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Drops rows from the end of the longest sheet, or lines from the end of the longest page. */
function bound(data: DownloadCheckpointData): boolean {
  let cut = false;
  while (bytes(data) > MAX_DOWNLOAD_CHECKPOINT_BYTES) {
    const lists: string[][][] | string[][] = data.sheets
      ? data.sheets.map((s) => s.rows)
      : (data.pages ?? []);
    const longest = (lists as unknown[][]).reduce<unknown[] | undefined>(
      (best, list) => (!best || list.length > best.length ? list : best),
      undefined,
    );
    if (!longest || longest.length === 0) break;
    longest.splice(Math.max(0, Math.floor(longest.length * 0.9)));
    cut = true;
  }
  return cut;
}

/** The hash two captures are compared by: everything but the size. */
export function downloadCheckpointHash(data: DownloadCheckpointData): string {
  const { size: _size, ...compared } = data;
  return checkpointHash(compared);
}

/**
 * The checkpoint of a downloaded file. `root` is the directory it was saved in, the only one the
 * workbook guard opens files under.
 */
export async function downloadCheckpoint(
  file: string,
  suggestedName: string,
  options: DownloadCheckpointValue,
  root: string,
): Promise<CheckpointCapture> {
  const buffer = await fs.readFile(file);
  const type = downloadTypeOf(suggestedName, buffer.subarray(0, 8));
  const data: DownloadCheckpointData = {
    fileName: applyMask(suggestedName, options.fileMask),
    type,
    extension: path.extname(suggestedName).toLowerCase().replace('.', ''),
    size: buffer.length,
  };
  let truncated = false;
  const sha = () => createHash('sha256').update(buffer).digest('hex');
  if (buffer.length > MAX_PARSED_DOWNLOAD_BYTES) {
    data.sha256 = sha();
    truncated = true;
  } else if (type === 'xlsx') {
    const { sheets, cut } = await workbookSheets(file, root, options);
    data.sheets = sheets;
    truncated = cut;
  } else if (type === 'pdf') {
    const { pageCount, pages, cut } = await pdfPages(buffer, options.contentMask);
    data.pageCount = pageCount;
    data.pages = pages;
    truncated = cut;
  } else if (type === 'csv') {
    const all = parseCsv(buffer.toString('utf8')).map((row) =>
      row.map((cell) => applyMask(normaliseText(cell), options.contentMask)),
    );
    const width = Math.max(0, ...all.map((row) => row.length));
    const kept = Math.min(width, options.cols);
    const rows = all
      .slice(0, options.rows)
      .map((row) => [
        ...row.slice(0, kept),
        ...Array<string>(Math.max(0, kept - row.length)).fill(''),
      ]);
    data.sheets = [
      {
        name: '',
        range: all.length ? `A1:${columnLetters(width)}${all.length}` : '',
        rows,
        merges: [],
      },
    ];
    truncated = all.length > options.rows || width > options.cols;
  } else if (options.contentMask && (type === 'txt' || type === 'json')) {
    data.sha256 = createHash('sha256')
      .update(applyMask(buffer.toString('utf8'), options.contentMask))
      .digest('hex');
  } else {
    data.sha256 = sha();
  }
  truncated = bound(data) || truncated;
  return {
    name: options.name,
    kind: 'download',
    data,
    hash: downloadCheckpointHash(data),
    ...(truncated ? { truncated: true } : {}),
  };
}
