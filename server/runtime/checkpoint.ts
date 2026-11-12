import { createHash } from 'node:crypto';
import {
  MAX_CHECKPOINT_BYTES,
  MAX_TABLE_ROWS,
  MAX_TEXT_MATCHES,
  type CheckpointCapture,
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
