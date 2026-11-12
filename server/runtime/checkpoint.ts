import { createHash } from 'node:crypto';
import {
  MAX_CHECKPOINT_BYTES,
  MAX_NETWORK_ENTRIES,
  MAX_TABLE_ROWS,
  MAX_TEXT_MATCHES,
  type ChartCheckpointData,
  type CheckpointCapture,
  type NetworkCheckpointData,
  type NetworkCheckpointEntry,
  type TableCheckpointData,
} from '@shared/comparison';
import { canonical } from '../authoring/step-provenance';

/**
 * What a checkpoint step keeps for a run comparison to pair and diff (shared/comparison.ts).
 *
 * The data is bounded here, once, so neither the step result nor the comparison ever holds more
 * than MAX_CHECKPOINT_BYTES of it; a cut capture says so, and the comparison reports it rather
 * than calling two cut captures equal.
 */

const canonicalJson = (value: unknown) => JSON.stringify(canonical(value)) ?? 'null';

/** sha-256 of the canonical JSON of a checkpoint's data. */
export function checkpointHash(data: unknown): string {
  return createHash('sha256').update(canonicalJson(data)).digest('hex');
}

/** Whitespace runs as one space, ends trimmed: layout differences are not content differences. */
export function normaliseText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const bytes = (value: unknown) => Buffer.byteLength(canonicalJson(value), 'utf8');

/** A text checkpoint over every match's inner text, normalised and bounded. */
export function textCheckpoint(name: string, rawTexts: readonly string[]): CheckpointCapture {
  let truncated = rawTexts.length > MAX_TEXT_MATCHES;
  const texts = rawTexts.slice(0, MAX_TEXT_MATCHES).map(normaliseText);
  // Whole texts go first, from the end; a single text too long on its own is cut.
  while (texts.length > 1 && bytes({ texts }) > MAX_CHECKPOINT_BYTES) {
    texts.pop();
    truncated = true;
  }
  if (texts.length === 1 && bytes({ texts }) > MAX_CHECKPOINT_BYTES) {
    let text = texts[0];
    while (text.length > 0 && bytes({ texts: [text] }) > MAX_CHECKPOINT_BYTES) {
      text = text.slice(0, Math.floor(text.length * 0.9));
    }
    texts[0] = text;
    truncated = true;
  }
  const data = { texts };
  return {
    name,
    kind: 'text',
    data,
    hash: checkpointHash(data),
    ...(truncated ? { truncated: true } : {}),
  };
}

/** The selectors a table checkpoint reads with when its value names none. */
export const DEFAULT_TABLE_ROWS = 'tr';
export const DEFAULT_TABLE_CELLS = 'th, td';

/**
 * The value of a `checkpointTable` step: `name`, or `name; rows=<css>; cells=<css>`. The row
 * selector is matched inside the target, the cell selector inside each row.
 */
export function parseTableCheckpointValue(
  raw: string,
): { name: string; rows: string; cells: string } | { error: string } {
  const [head, ...options] = raw.split(';');
  const name = head.trim();
  if (name === '') return { error: 'the name of the checkpoint comes first' };
  let rows = DEFAULT_TABLE_ROWS;
  let cells = DEFAULT_TABLE_CELLS;
  for (const option of options) {
    if (option.trim() === '') continue;
    const at = option.indexOf('=');
    const key = at < 0 ? '' : option.slice(0, at).trim().toLowerCase();
    const selector = at < 0 ? '' : option.slice(at + 1).trim();
    if ((key !== 'rows' && key !== 'cells') || selector === '')
      return { error: `"${option.trim()}" is not rows=<css> or cells=<css>` };
    if (key === 'rows') rows = selector;
    else cells = selector;
  }
  return { name, rows, cells };
}

/** A table checkpoint over the cell texts of every row, normalised and bounded. */
export function tableCheckpoint(name: string, rawRows: readonly string[][]): CheckpointCapture {
  let truncated = rawRows.length > MAX_TABLE_ROWS;
  const rows = rawRows.slice(0, MAX_TABLE_ROWS).map((row) => row.map(normaliseText));
  // Whole rows go first, from the end; a single row too long on its own has its longest cell cut.
  while (rows.length > 1 && bytes({ rows }) > MAX_CHECKPOINT_BYTES) {
    rows.pop();
    truncated = true;
  }
  if (rows.length === 1) {
    const row = rows[0];
    while (bytes({ rows }) > MAX_CHECKPOINT_BYTES) {
      let longest = 0;
      for (let i = 1; i < row.length; i++) if (row[i].length > row[longest].length) longest = i;
      if (row.length === 0 || row[longest].length === 0) break;
      row[longest] = row[longest].slice(0, Math.floor(row[longest].length * 0.9));
      truncated = true;
    }
  }
  const data: TableCheckpointData = { rows };
  return {
    name,
    kind: 'table',
    data,
    hash: checkpointHash(data),
    ...(truncated ? { truncated: true } : {}),
  };
}

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const arrayOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const field = (value: unknown, key: string): unknown =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : String(value);

/**
 * The chart model an adapter or the application's hook returned, in the one shape the comparison
 * reads. The hook is the application's code, so nothing about its answer is trusted: a field of
 * the wrong type becomes empty, not an error.
 */
export function normaliseChartModel(raw: unknown): ChartCheckpointData {
  return {
    series: arrayOf(field(raw, 'series')).map((series) => ({
      name: normaliseText(textOf(field(series, 'name'))),
      type: normaliseText(textOf(field(series, 'type'))),
      points: arrayOf(field(series, 'points')).map((point): [string | number, number | null] => {
        const [x, y] = arrayOf(point);
        const xValue = typeof x === 'number' && Number.isFinite(x) ? x : normaliseText(textOf(x));
        return [xValue, finiteOrNull(y)];
      }),
    })),
    axes: arrayOf(field(raw, 'axes')).map((axis) => ({
      name: normaliseText(textOf(field(axis, 'name'))),
      min: finiteOrNull(field(axis, 'min')),
      max: finiteOrNull(field(axis, 'max')),
    })),
    lines: arrayOf(field(raw, 'lines')).flatMap((line) => {
      const value = finiteOrNull(field(line, 'value'));
      return value === null
        ? []
        : [
            {
              axis: normaliseText(textOf(field(line, 'axis'))),
              value,
              label: normaliseText(textOf(field(line, 'label'))),
            },
          ];
    }),
  };
}

/**
 * A network checkpoint over sorted entries, bounded by MAX_NETWORK_ENTRIES and
 * MAX_CHECKPOINT_BYTES; `lost` counts requests the journal could not hold, which also cuts it.
 */
export function networkCheckpoint(
  name: string,
  sorted: readonly NetworkCheckpointEntry[],
  lost = 0,
): CheckpointCapture {
  let truncated = lost > 0 || sorted.length > MAX_NETWORK_ENTRIES;
  const entries = sorted.slice(0, MAX_NETWORK_ENTRIES);
  while (entries.length > 0 && bytes({ entries }) > MAX_CHECKPOINT_BYTES) {
    entries.splice(Math.floor(entries.length * 0.9));
    truncated = true;
  }
  const data: NetworkCheckpointData = { entries };
  return {
    name,
    kind: 'network',
    data,
    hash: checkpointHash(data),
    ...(truncated ? { truncated: true } : {}),
  };
}

/** A chart checkpoint, normalised and bounded: points go from the end of the longest series. */
export function chartCheckpoint(name: string, raw: unknown): CheckpointCapture {
  const data = normaliseChartModel(raw);
  let truncated = false;
  while (bytes(data) > MAX_CHECKPOINT_BYTES) {
    const longest = data.series.reduce<ChartCheckpointData['series'][number] | undefined>(
      (best, series) => (!best || series.points.length > best.points.length ? series : best),
      undefined,
    );
    if (!longest || longest.points.length === 0) {
      // Only names, axes and lines are left; they are the application's, and few, so they go.
      if (data.lines.length > 0) data.lines.pop();
      else if (data.axes.length > 0) data.axes.pop();
      else if (data.series.length > 0) data.series.pop();
      else break;
    } else {
      longest.points.splice(Math.floor(longest.points.length * 0.9));
    }
    truncated = true;
  }
  return {
    name,
    kind: 'chart',
    data,
    hash: checkpointHash(data),
    ...(truncated ? { truncated: true } : {}),
  };
}
