import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DatasetPanel, parsePastedTable, type DatasetRow } from './DatasetPanel';

/**
 * The dataset editor.
 *
 * The runner has understood datasets since the column was added, but a dataset could only be
 * written through the API — the same gap the Captures tab closed for extractions. Pasting is
 * the path that matters: the data almost always already exists in a spreadsheet, and typing
 * it back in cell by cell is slow and a chance to get it wrong.
 */

describe('parsePastedTable', () => {
  it('reads what Excel puts on the clipboard, which is tab separated', () => {
    const rows = parsePastedTable('sku\tqty\nA-1\t2\nB-2\t5');

    expect(rows).toEqual([
      { sku: 'A-1', qty: '2' },
      { sku: 'B-2', qty: '5' },
    ]);
  });

  it('reads comma separated too, because a .csv in a text editor looks like that', () => {
    const rows = parsePastedTable('sku,qty\nA-1,2');

    // The person pasting has no reason to know or care which one they have.
    expect(rows).toEqual([{ sku: 'A-1', qty: '2' }]);
  });

  it('survives Windows line endings', () => {
    expect(parsePastedTable('sku\tqty\r\nA-1\t2')).toEqual([{ sku: 'A-1', qty: '2' }]);
  });

  it('renames a header that could never be used as a variable', () => {
    const rows = parsePastedTable('Order Number\tqty\n4711\t2');

    // `{{Order Number}}` does not match the substitution pattern, so keeping the header
    // would produce a column no step could ever reference.
    expect(Object.keys(rows[0])).toEqual(['column1', 'qty']);
    expect(rows[0].column1).toBe('4711');
  });

  it('fills a short row rather than dropping it', () => {
    const rows = parsePastedTable('sku\tqty\nA-1');

    // A trailing empty cell is missing from the clipboard text entirely. Dropping the row
    // would silently lose a case the tester meant to run.
    expect(rows).toEqual([{ sku: 'A-1', qty: '' }]);
  });

  it('returns nothing for a block with no data rows', () => {
    expect(parsePastedTable('sku\tqty')).toEqual([]);
    expect(parsePastedTable('')).toEqual([]);
  });
});

describe('DatasetPanel', () => {
  const renderPanel = (dataset: DatasetRow[] = []) => {
    const onChange = vi.fn();
    render(<DatasetPanel dataset={dataset} onChange={onChange} />);
    return onChange;
  };

  it('says how many runs the rows will produce', () => {
    renderPanel([{ sku: 'A' }, { sku: 'B' }, { sku: 'C' }]);

    expect(screen.getByText('3 runs')).toBeInTheDocument();
  });

  it('explains that an empty dataset still runs once', () => {
    renderPanel([]);

    expect(screen.getByText(/With no rows it runs once/i)).toBeInTheDocument();
  });

  it('edits a cell', () => {
    const onChange = renderPanel([{ sku: 'A-1' }]);

    fireEvent.change(screen.getByLabelText('Row 1 sku'), { target: { value: 'Z-9' } });

    expect(onChange).toHaveBeenCalledWith([{ sku: 'Z-9' }]);
  });

  it('renames a column across every row, since the name is the variable', () => {
    const onChange = renderPanel([{ sku: 'A-1' }, { sku: 'B-2' }]);

    fireEvent.change(screen.getByLabelText('Column name sku'), { target: { value: 'article' } });

    // Renaming one row's key and not the others would leave rows the step cannot read.
    expect(onChange).toHaveBeenCalledWith([{ article: 'A-1' }, { article: 'B-2' }]);
  });

  it('removes a column from every row', () => {
    const onChange = renderPanel([{ sku: 'A', qty: '2' }]);

    fireEvent.click(screen.getByLabelText('Remove column qty'));

    expect(onChange).toHaveBeenCalledWith([{ sku: 'A' }]);
  });

  it('removes a row', () => {
    const onChange = renderPanel([{ sku: 'A' }, { sku: 'B' }]);

    fireEvent.click(screen.getByLabelText('Remove row 1'));

    expect(onChange).toHaveBeenCalledWith([{ sku: 'B' }]);
  });

  it('adds a column to every existing row', () => {
    const onChange = renderPanel([{ sku: 'A' }, { sku: 'B' }]);

    fireEvent.click(screen.getByRole('button', { name: /Add column/i }));

    expect(onChange).toHaveBeenCalledWith([
      { sku: 'A', value: '' },
      { sku: 'B', value: '' },
    ]);
  });

  it('replaces the rows from a pasted block', () => {
    const onChange = renderPanel([{ old: 'row' }]);

    fireEvent.click(screen.getByRole('button', { name: /Paste from a spreadsheet/i }));
    fireEvent.change(screen.getByLabelText(/Paste the block/i), {
      target: { value: 'sku\tqty\nA-1\t2\nB-2\t5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Replace the rows/i }));

    expect(onChange).toHaveBeenCalledWith([
      { sku: 'A-1', qty: '2' },
      { sku: 'B-2', qty: '5' },
    ]);
  });

  it('will not apply a paste it could not read', () => {
    renderPanel([]);

    fireEvent.click(screen.getByRole('button', { name: /Paste from a spreadsheet/i }));
    fireEvent.change(screen.getByLabelText(/Paste the block/i), { target: { value: 'just one line' } });

    expect(screen.getByRole('button', { name: /Replace the rows/i })).toBeDisabled();
    expect(screen.getByText(/Needs a header row/i)).toBeInTheDocument();
  });
});
