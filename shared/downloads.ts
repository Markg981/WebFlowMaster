/**
 * What an `expectDownload` step checks about the file a click downloaded (server/download-check.ts).
 *
 * The step's value lists the checks, one per line or separated by `;` (not commas: a text to find
 * may contain them):
 *
 *   name: invoice-*.pdf; contains: Total 1.234,50 €; pages >= 1
 *   type: csv; rows >= 10; columns = 5; contains: Mario Rossi
 *
 * `name` is a glob on the file name, `type` the kind of file, `contains` a text the content must
 * include (case and spacing ignored; repeatable). `size`, `rows`, `columns` and `pages` compare a
 * number; sizes take KB or MB.
 */

export const DOWNLOAD_TYPES = ['pdf', 'csv', 'xlsx', 'json', 'txt', 'other'] as const;
export type DownloadType = (typeof DOWNLOAD_TYPES)[number];

export type NumberField = 'size' | 'rows' | 'columns' | 'pages';
type Op = '<' | '<=' | '>' | '>=' | '=';

export type DownloadCheck =
  | { kind: 'name'; pattern: string; text: string }
  | { kind: 'type'; type: DownloadType; text: string }
  | { kind: 'contains'; value: string; text: string }
  | { kind: 'number'; field: NumberField; op: Op; value: number; text: string };

export interface DownloadedFile {
  name: string;
  type: DownloadType;
  size: number;
  /** CSV and spreadsheet rows (header included), and the widest row's columns. */
  rows?: number;
  columns?: number;
  pages?: number;
  /** The first characters of the text found in it, for the report. */
  sample: string;
}

export interface DownloadFinding extends DownloadedFile {
  checks: Array<{ text: string; ok: boolean; actual?: string }>;
  /** The file, kept with the run's evidence. */
  fileUrl?: string;
}

const NUMBER = /^(size|rows|columns|pages)\s*(<=|>=|==|=|<|>)\s*([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)$/i;

export function parseDownloadChecks(text: string): DownloadCheck[] | { error: string } {
  const checks: DownloadCheck[] = [];
  for (const part of text.split(/[;\n]/).map((p) => p.trim()).filter(Boolean)) {
    const named = /^(name|type|contains)\s*:\s*(.+)$/i.exec(part);
    if (named) {
      const key = named[1].toLowerCase();
      const value = named[2].trim();
      if (key === 'name') checks.push({ kind: 'name', pattern: value, text: part });
      else if (key === 'contains') checks.push({ kind: 'contains', value, text: part });
      else {
        const type = value.toLowerCase().replace(/^\./, '') as DownloadType;
        if (!DOWNLOAD_TYPES.includes(type) || type === 'other') return { error: `Unknown type "${value}". Use one of: pdf, csv, xlsx, json, txt.` };
        checks.push({ kind: 'type', type, text: part });
      }
      continue;
    }
    const m = NUMBER.exec(part);
    if (!m) return { error: `"${part}" is not a check. Write name: *.pdf, contains: text, rows >= 3, size < 2MB…` };
    const field = m[1].toLowerCase() as NumberField;
    let value = Number(m[3]);
    const unit = m[4].toLowerCase();
    if (field === 'size') {
      if (unit === 'kb') value *= 1024;
      else if (unit === 'mb') value *= 1024 * 1024;
      else if (unit !== '' && unit !== 'b') return { error: `${part}: use KB or MB for a size.` };
    } else if (unit) return { error: `${part}: ${field} is a plain number.` };
    checks.push({ kind: 'number', field, op: (m[2] === '==' ? '=' : m[2]) as Op, value, text: part });
  }
  return checks;
}

function globMatches(pattern: string, name: string): boolean {
  const re = pattern.replace(/[.+^$()|[\]\\{}]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${re}$`, 'i').test(name);
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function runDownloadChecks(file: DownloadedFile, fullText: string, checks: DownloadCheck[]): DownloadFinding['checks'] {
  const text = squash(fullText);
  return checks.map((c) => {
    switch (c.kind) {
      case 'name':
        return { text: c.text, ok: globMatches(c.pattern, file.name), actual: file.name };
      case 'type':
        return { text: c.text, ok: file.type === c.type, actual: file.type };
      case 'contains':
        return { text: c.text, ok: text.includes(squash(c.value)) };
      case 'number': {
        const actual = file[c.field];
        if (actual === undefined) return { text: c.text, ok: false, actual: `not a ${c.field === 'pages' ? 'PDF' : 'table'}` };
        const ok = c.op === '<' ? actual < c.value : c.op === '<=' ? actual <= c.value : c.op === '>' ? actual > c.value : c.op === '>=' ? actual >= c.value : actual === c.value;
        return { text: c.text, ok, actual: String(actual) };
      }
    }
  });
}

/** The point of a `setGeolocation` step: "45.4642, 9.19" or with an accuracy in metres. */
export function parseGeolocation(value: string): { latitude: number; longitude: number; accuracy: number } | { error: string } {
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  const [latitude, longitude, accuracy = 10] = parts.map(Number);
  if (parts.length < 2 || parts.length > 3 || [latitude, longitude, accuracy].some((n) => !Number.isFinite(n))) {
    return { error: `"${value}" is not a position. Write latitude, longitude[, accuracy in metres], e.g. 45.4642, 9.19.` };
  }
  if (latitude < -90 || latitude > 90) return { error: `Latitude ${latitude} is outside -90…90.` };
  if (longitude < -180 || longitude > 180) return { error: `Longitude ${longitude} is outside -180…180.` };
  if (accuracy < 0) return { error: 'The accuracy is a number of metres, 0 or more.' };
  return { latitude, longitude, accuracy };
}
