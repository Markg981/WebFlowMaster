import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeyValueEditor } from './KeyValueEditor';

const rows = [
  { id: 'a', key: 'page', value: '1', enabled: true },
  { id: 'b', key: 'size', value: '20', enabled: false },
];

function renderEditor(disabled = false) {
  const handlers = { onChange: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn() };
  render(
    <KeyValueEditor
      rows={rows}
      idPrefix="qp"
      keyPlaceholder="Key"
      valuePlaceholder="Value"
      addLabel="Add Param"
      disabled={disabled}
      {...handlers}
    />,
  );
  return handlers;
}

describe('KeyValueEditor', () => {
  it('reports edits with the row index and the field changed', () => {
    const { onChange } = renderEditor();

    fireEvent.change(screen.getAllByPlaceholderText('Value')[1], { target: { value: '50' } });
    fireEvent.click(document.getElementById('qp-enabled-b')!);

    expect(onChange).toHaveBeenCalledWith(1, 'value', '50');
    expect(onChange).toHaveBeenCalledWith(1, 'enabled', true);
  });

  it('adds and removes rows through its buttons', () => {
    const { onAdd, onRemove } = renderEditor();

    fireEvent.click(screen.getByRole('button', { name: /Add Param/ }));
    // The remove buttons are the icon-only ones, one per row.
    const removeButtons = screen.getAllByRole('button').filter((b) => !b.textContent?.trim());
    fireEvent.click(removeButtons[0]);

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it('locks every control while a request is running', () => {
    renderEditor(true);

    for (const input of screen.getAllByRole('textbox')) expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add Param/ })).toBeDisabled();
  });
});
