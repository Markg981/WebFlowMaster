import type { CheckpointCapture, ComparisonDifference, ComparisonPolicy } from '@shared/comparison';
import { textsMatch } from './normalizers';
import { diffCheckpoints, type DifferenceAt } from './checkpoints';
import type { ComparedStep } from './steps';

/** The rows of a stored table checkpoint, read defensively: it comes from a stored log. */
function rowsOf(capture: CheckpointCapture): string[][] {
  const rows = (capture.data as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []));
}

/** A row with no text in any cell: a spacer or layout row, which shows nothing to compare. */
function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === '');
}

/**
 * Table checkpoints with the same name, compared row by row and cell by cell under the policy: a
 * cell matches after the text rules, or as a number within the tolerance. A row on one side only
 * is one difference, not one per cell. Blank rows are left out on both sides before the rows are
 * paired, so a spacer row one page draws and the other does not shifts nothing; the row indices
 * of the differences count the rows with text.
 */
export function diffTable(
  baseline: ComparedStep[],
  candidate: ComparedStep[],
  policy: ComparisonPolicy,
): ComparisonDifference[] {
  return diffCheckpoints(
    baseline,
    candidate,
    'table',
    (a, b) => {
      const x = rowsOf(a).filter((row) => !isBlankRow(row));
      const y = rowsOf(b).filter((row) => !isBlankRow(row));
      const out: DifferenceAt[] = [];
      if (x.length !== y.length)
        out.push({ path: 'rows.length', baseline: x.length, candidate: y.length });
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        const left = x[i];
        const right = y[i];
        if (!left || !right) {
          out.push({ path: `rows[${i}]`, baseline: left ?? null, candidate: right ?? null });
          continue;
        }
        if (left.length !== right.length)
          out.push({
            path: `rows[${i}].length`,
            baseline: left.length,
            candidate: right.length,
          });
        for (let j = 0; j < Math.max(left.length, right.length); j += 1) {
          if (j < left.length && j < right.length && textsMatch(left[j], right[j], policy))
            continue;
          out.push({
            path: `rows[${i}][${j}]`,
            baseline: left[j] ?? null,
            candidate: right[j] ?? null,
          });
        }
      }
      return out;
    },
    rowsOf,
  );
}
