import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ComparisonDifference, TableCheckpointData } from '@shared/comparison';

/**
 * A table checkpoint with both sides in one grid: a cell the engine called different shows the
 * baseline struck through and the candidate beside it, a row on one side only is marked as such.
 *
 * The highlight comes from the differences, not from comparing the cells again here: the engine
 * applied the policy's tolerances and replace rules, and "10,00" against "10.00" may be equal.
 */

/** Rows past this many are left out of the grid; the differences list still names them. */
export const MAX_GRID_ROWS = 200;

type Mark = 'blocking' | 'informative' | 'known';

const markOf = (difference: ComparisonDifference): Mark =>
  difference.knownDifferenceId ? 'known' : difference.severity;

const CELL_CLASS: Record<Mark, string> = {
  blocking: 'bg-destructive/15',
  informative: 'bg-amber-500/15',
  known: 'bg-muted',
};

/** Which cells and rows the differences point at, by their `rows[i][j]` / `rows[i]` path. */
export function tableMarks(differences: ComparisonDifference[]) {
  const cells = new Map<string, Mark>();
  const rows = new Map<number, Mark>();
  for (const difference of differences) {
    const cell = /^rows\[(\d+)\]\[(\d+)\]$/.exec(difference.path);
    if (cell) {
      cells.set(`${cell[1]}:${cell[2]}`, markOf(difference));
      continue;
    }
    const row = /^rows\[(\d+)\](?:\.length)?$/.exec(difference.path);
    if (row) rows.set(Number(row[1]), markOf(difference));
  }
  return { cells, rows };
}

const asTable = (value: unknown): string[][] =>
  Array.isArray((value as TableCheckpointData | null)?.rows)
    ? (value as TableCheckpointData).rows
    : [];

export default function DiffTable({
  baseline,
  candidate,
  differences,
}: {
  baseline: unknown;
  candidate: unknown;
  differences: ComparisonDifference[];
}) {
  const { t } = useTranslation();
  const left = asTable(baseline);
  const right = asTable(candidate);
  const { cells, rows } = tableMarks(differences);
  const height = Math.max(left.length, right.length);
  const shown = Math.min(height, MAX_GRID_ROWS);
  const width = Math.max(0, ...left.map((r) => r.length), ...right.map((r) => r.length));

  return (
    <div className="space-y-1">
      <div className="overflow-auto max-h-96 border rounded">
        <table className="text-xs border-collapse" data-testid="diff-table">
          <tbody>
            {Array.from({ length: shown }, (_, i) => {
              const a = left[i];
              const b = right[i];
              const rowMark = rows.get(i);
              const only = !a ? 'candidate' : !b ? 'baseline' : null;
              return (
                <tr key={i} className={rowMark ? CELL_CLASS[rowMark] : undefined}>
                  <th scope="row" className="px-2 py-1 text-muted-foreground font-normal border">
                    {i + 1}
                    {only && (
                      <span className="ml-1">
                        {only === 'baseline'
                          ? t('comparisons.diff.baselineOnly', '(baseline only)')
                          : t('comparisons.diff.candidateOnly', '(candidate only)')}
                      </span>
                    )}
                  </th>
                  {Array.from({ length: width }, (_, j) => {
                    const mark = cells.get(`${i}:${j}`);
                    const before = a?.[j];
                    const after = b?.[j];
                    return (
                      <td
                        key={j}
                        className={`px-2 py-1 border align-top ${mark ? CELL_CLASS[mark] : ''}`}
                        data-mark={mark}
                      >
                        {mark ? (
                          <>
                            <del className="text-muted-foreground">{before ?? '—'}</del>
                            <span aria-hidden> → </span>
                            <ins className="no-underline font-medium">{after ?? '—'}</ins>
                          </>
                        ) : (
                          (after ?? before ?? '')
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {height > shown && (
        <p className="text-xs text-muted-foreground">
          {t('comparisons.diff.moreRows', '{{n}} more rows are not shown.', { n: height - shown })}
        </p>
      )}
    </div>
  );
}
