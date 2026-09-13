import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PlusCircle, XCircle, Table2 } from 'lucide-react';

/**
 * The rows of input a test runs over.
 *
 * Each column name becomes a `{{variable}}` for that run. Without this the only way to check
 * twenty inputs was twenty near-identical saved tests, and a change to the flow meant editing
 * all twenty — which is how a suite stops being maintained.
 *
 * Pasting is the first-class path rather than an extra: the data almost always already
 * exists in a spreadsheet, and typing it back in cell by cell is both slow and a chance to
 * get it wrong.
 */

export type DatasetRow = Record<string, string>;

interface DatasetPanelProps {
  dataset: DatasetRow[];
  onChange: (dataset: DatasetRow[]) => void;
  disabled?: boolean;
}

/** Column order, taken from the rows themselves so it survives a round-trip through JSON. */
function columnsOf(dataset: DatasetRow[]): string[] {
  const seen: string[] = [];
  for (const row of dataset) {
    for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

/**
 * Reads a block pasted from a spreadsheet.
 *
 * Tab-separated is what Excel and Google Sheets put on the clipboard; comma-separated is
 * what a .csv opened in a text editor gives. Both are accepted because the person pasting
 * has no reason to know or care which one they have.
 */
export function parsePastedTable(text: string): DatasetRow[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];

  const separator = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(separator).map((h) => h.trim());
  // A header that is not a usable variable name would produce a column nothing can
  // reference, so it is renamed rather than silently kept.
  const safeHeaders = headers.map((h, i) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(h) ? h : `column${i + 1}`));

  return lines.slice(1).map((line) => {
    const cells = line.split(separator);
    return Object.fromEntries(safeHeaders.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

export const DatasetPanel: React.FC<DatasetPanelProps> = ({ dataset, onChange, disabled }) => {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const columns = useMemo(() => columnsOf(dataset), [dataset]);

  const setCell = (rowIndex: number, column: string, value: string) => {
    onChange(dataset.map((row, i) => (i === rowIndex ? { ...row, [column]: value } : row)));
  };

  const renameColumn = (from: string, to: string) => {
    onChange(
      dataset.map((row) =>
        Object.fromEntries(Object.entries(row).map(([key, value]) => [key === from ? to : key, value])),
      ),
    );
  };

  const addColumn = () => {
    // Named so it is obvious which one was just added, and unique so it does not collide.
    let name = 'value';
    let n = 1;
    while (columns.includes(name)) name = `value${++n}`;
    onChange(dataset.length === 0 ? [{ [name]: '' }] : dataset.map((row) => ({ ...row, [name]: '' })));
  };

  const removeColumn = (column: string) => {
    onChange(
      dataset.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== column))),
    );
  };

  const addRow = () => {
    onChange([...dataset, Object.fromEntries(columns.map((c) => [c, '']))]);
  };

  const applyPaste = () => {
    const rows = parsePastedTable(pasted);
    if (rows.length > 0) {
      onChange(rows);
      setPasted('');
      setPasteOpen(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Table2 className="h-4 w-4" />
            Data rows
            {dataset.length > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                {dataset.length} run{dataset.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            The test runs once per row. Each column name is available in a step as{' '}
            <code>{'{{name}}'}</code>. With no rows it runs once, as usual.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" type="button" disabled={disabled} onClick={() => setPasteOpen((o) => !o)}>
            Paste from a spreadsheet
          </Button>
          <Button variant="outline" size="sm" type="button" disabled={disabled} onClick={addColumn}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add column
          </Button>
        </div>
      </div>

      {pasteOpen && (
        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          <Label htmlFor="dataset-paste" className="text-xs">
            Paste the block including its header row — copied straight out of Excel works.
          </Label>
          <Textarea
            id="dataset-paste"
            rows={5}
            value={pasted}
            disabled={disabled}
            placeholder={'sku\tqty\nA-1\t2\nB-2\t5'}
            onChange={(e) => setPasted(e.target.value)}
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" type="button" onClick={applyPaste} disabled={disabled || parsePastedTable(pasted).length === 0}>
              Replace the rows
            </Button>
            <span className="text-xs text-muted-foreground">
              {parsePastedTable(pasted).length > 0
                ? `${parsePastedTable(pasted).length} row(s) recognised`
                : 'Needs a header row and at least one row of data.'}
            </span>
          </div>
        </div>
      )}

      {columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No data rows. Add a column, or paste a block from a spreadsheet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} className="border-b p-1 text-left align-bottom">
                    <div className="flex items-center gap-1">
                      <Input
                        value={column}
                        disabled={disabled}
                        aria-label={`Column name ${column}`}
                        className="h-8 font-mono text-xs"
                        onChange={(e) => renameColumn(column, e.target.value)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        disabled={disabled}
                        aria-label={`Remove column ${column}`}
                        onClick={() => removeColumn(column)}
                      >
                        <XCircle className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </th>
                ))}
                <th className="border-b p-1" />
              </tr>
            </thead>
            <tbody>
              {dataset.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((column) => (
                    <td key={column} className="p-1">
                      <Input
                        value={row[column] ?? ''}
                        disabled={disabled}
                        aria-label={`Row ${rowIndex + 1} ${column}`}
                        className="h-8 text-xs"
                        onChange={(e) => setCell(rowIndex, column, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="p-1 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      disabled={disabled}
                      aria-label={`Remove row ${rowIndex + 1}`}
                      onClick={() => onChange(dataset.filter((_, i) => i !== rowIndex))}
                    >
                      <XCircle className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button variant="outline" size="sm" type="button" className="mt-2" disabled={disabled} onClick={addRow}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add row
          </Button>
        </div>
      )}
    </div>
  );
};
