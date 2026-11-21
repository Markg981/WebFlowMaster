import type {
  CheckpointCapture,
  ComparisonDifference,
  ComparisonPolicy,
  DownloadCheckpointData,
  DownloadCheckpointSheet,
} from '@shared/comparison';
import { columnLetters } from '@shared/download-checkpoint';
import { textsMatch } from './normalizers';
import { diffCheckpoints, keyed, unionKeys, type DifferenceAt } from './checkpoints';
import type { ComparedStep } from './steps';

/** Beyond this many line pairs a page is compared line by line in order, not aligned. */
const MAX_ALIGNED_PAIRS = 250_000;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item ?? '')) : [];

/** A stored download checkpoint, read defensively: it comes from a stored log. */
function dataOf(capture: CheckpointCapture): DownloadCheckpointData {
  const raw = (capture.data ?? {}) as Partial<DownloadCheckpointData>;
  const sheets = Array.isArray(raw.sheets)
    ? raw.sheets.map((sheet): DownloadCheckpointSheet => ({
        name: String(sheet?.name ?? ''),
        ...(sheet?.hidden ? { hidden: true } : {}),
        range: String(sheet?.range ?? ''),
        rows: Array.isArray(sheet?.rows) ? sheet.rows.map(strings) : [],
        merges: strings(sheet?.merges),
      }))
    : undefined;
  return {
    fileName: String(raw.fileName ?? ''),
    type: raw.type ?? 'other',
    extension: String(raw.extension ?? ''),
    size: Number(raw.size ?? 0),
    ...(sheets ? { sheets } : {}),
    ...(typeof raw.pageCount === 'number' ? { pageCount: raw.pageCount } : {}),
    ...(Array.isArray(raw.pages) ? { pages: raw.pages.map(strings) } : {}),
    ...(raw.sha256 ? { sha256: String(raw.sha256) } : {}),
  };
}

/** What a checkpoint on one side only shows of itself: the file, not its every cell. */
function summaryOf(capture: CheckpointCapture): unknown {
  const data = dataOf(capture);
  return {
    fileName: data.fileName,
    type: data.type,
    ...(data.sheets ? { sheets: data.sheets.map((sheet) => sheet.name) } : {}),
    ...(data.pageCount !== undefined ? { pageCount: data.pageCount } : {}),
  };
}

/** The first row and column of a range such as `B3:F40`; A1 for an empty one. */
function originOf(range: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)/.exec(range);
  if (!m) return { row: 1, col: 1 };
  const col = [...m[1]].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0);
  return { row: Number(m[2]), col };
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

/** Two sheets of the same name: range, merges and hidden state, then cell by cell. */
function diffSheet(
  label: string,
  a: DownloadCheckpointSheet,
  b: DownloadCheckpointSheet,
  policy: ComparisonPolicy,
): DifferenceAt[] {
  const out: DifferenceAt[] = [];
  if (Boolean(a.hidden) !== Boolean(b.hidden))
    out.push({
      path: `${label}.hidden`,
      baseline: Boolean(a.hidden),
      candidate: Boolean(b.hidden),
    });
  if (a.range !== b.range)
    out.push({ path: `${label}.range`, baseline: a.range, candidate: b.range });
  if (!sameList(a.merges, b.merges))
    out.push({ path: `${label}.merges`, baseline: a.merges, candidate: b.merges });
  // Cells are named after the baseline's range, which the candidate's is compared against above.
  const origin = originOf(a.range || b.range);
  for (let i = 0; i < Math.max(a.rows.length, b.rows.length); i += 1) {
    const left = a.rows[i];
    const right = b.rows[i];
    const row = origin.row + i;
    if (!left || !right) {
      out.push({
        path: `${label}!${row}:${row}`,
        baseline: left ?? null,
        candidate: right ?? null,
      });
      continue;
    }
    for (let j = 0; j < Math.max(left.length, right.length); j += 1) {
      const x = left[j] ?? '';
      const y = right[j] ?? '';
      if (x === y || textsMatch(x, y, policy)) continue;
      out.push({
        path: `${label}!${columnLetters(origin.col + j)}${row}`,
        baseline: left[j] ?? null,
        candidate: right[j] ?? null,
      });
    }
  }
  return out;
}

/**
 * The lines of two pages paired by their longest common subsequence, so a line one side adds
 * does not shift every line after it; in order when the pages are too long to align. Lines are
 * numbered from 1, after the baseline's, or the candidate's for a line only it has.
 */
function diffPage(
  label: string,
  a: string[],
  b: string[],
  policy: ComparisonPolicy,
): DifferenceAt[] {
  const same = (x: string, y: string) => x === y || textsMatch(x, y, policy);
  const out: DifferenceAt[] = [];
  const at = (i: number, j: number, x: string | null, y: string | null) =>
    out.push({ path: `${label}.lines[${(x !== null ? i : j) + 1}]`, baseline: x, candidate: y });

  if ((a.length + 1) * (b.length + 1) > MAX_ALIGNED_PAIRS) {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const x = a[i] ?? null;
      const y = b[i] ?? null;
      if (x !== null && y !== null && same(x, y)) continue;
      at(i, i, x, y);
    }
    return out;
  }
  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      lcs[i][j] = same(a[i], b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  let i = 0;
  let j = 0;
  const removed: number[] = [];
  const added: number[] = [];
  // A run of removed lines and a run of added ones between two common lines are changes, paired.
  const flush = () => {
    for (let k = 0; k < Math.max(removed.length, added.length); k += 1) {
      const x = removed[k];
      const y = added[k];
      at(x ?? -1, y ?? -1, x !== undefined ? a[x] : null, y !== undefined ? b[y] : null);
    }
    removed.length = 0;
    added.length = 0;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && same(a[i], b[j])) {
      flush();
      i += 1;
      j += 1;
    } else if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      removed.push(i);
      i += 1;
    } else {
      added.push(j);
      j += 1;
    }
  }
  flush();
  return out;
}

/** Two captures of the same download checkpoint, field by field. */
export function compareDownloads(
  a: CheckpointCapture,
  b: CheckpointCapture,
  policy: ComparisonPolicy,
): DifferenceAt[] {
  const x = dataOf(a);
  const y = dataOf(b);
  const out: DifferenceAt[] = [];
  if (x.fileName !== y.fileName)
    out.push({ path: 'fileName', baseline: x.fileName, candidate: y.fileName });
  if (x.type !== y.type) {
    // Different kinds of file have nothing else to set against each other.
    out.push({ path: 'type', baseline: x.type, candidate: y.type });
    return out;
  }
  if ((x.sha256 || y.sha256) && x.sha256 !== y.sha256)
    out.push({ path: 'sha256', baseline: x.sha256 ?? null, candidate: y.sha256 ?? null });

  if (x.sheets || y.sheets) {
    const left = x.sheets ?? [];
    const right = y.sheets ?? [];
    const names = (sheets: DownloadCheckpointSheet[]) => sheets.map((sheet) => sheet.name);
    if (!sameList(names(left), names(right)))
      out.push({ path: 'sheets', baseline: names(left), candidate: names(right) });
    const l = keyed(left, (sheet) => sheet.name);
    const r = keyed(right, (sheet) => sheet.name);
    for (const key of unionKeys(l, r)) {
      // A CSV is one sheet without a name.
      const label = key === '' ? 'rows' : `sheets[${key}]`;
      const s = l.get(key);
      const t = r.get(key);
      if (!s || !t) {
        out.push({ path: label, baseline: s?.range ?? null, candidate: t?.range ?? null });
        continue;
      }
      out.push(...diffSheet(label, s, t, policy));
    }
  }

  if (x.pages || y.pages) {
    if (x.pageCount !== y.pageCount)
      out.push({
        path: 'pageCount',
        baseline: x.pageCount ?? null,
        candidate: y.pageCount ?? null,
      });
    const left = x.pages ?? [];
    const right = y.pages ?? [];
    for (let n = 0; n < Math.max(left.length, right.length); n += 1) {
      const label = `pages[${n + 1}]`;
      if (!left[n] || !right[n]) {
        out.push({ path: label, baseline: left[n] ?? null, candidate: right[n] ?? null });
        continue;
      }
      out.push(...diffPage(label, left[n], right[n], policy));
    }
  }
  return out;
}

/**
 * Download checkpoints with the same name (shared/comparison.ts, DownloadCheckpointData): the
 * file name, the kind of file, the sheet names in order and each sheet's range, merged cells and
 * cells (`sheets[Summary]!B3`), the page count and each page's lines (`pages[2].lines[14]`), or
 * the sha-256. Cells and lines match under the policy's text rules and numeric tolerance. The
 * size is not compared: two files with the same content may still differ in it.
 */
export function diffDownload(
  baseline: ComparedStep[],
  candidate: ComparedStep[],
  policy: ComparisonPolicy,
): ComparisonDifference[] {
  return diffCheckpoints(
    baseline,
    candidate,
    'download',
    (a, b) => compareDownloads(a, b, policy),
    summaryOf,
  );
}
