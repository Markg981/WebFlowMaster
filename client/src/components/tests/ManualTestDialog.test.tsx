import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ManualTestDialog from './ManualTestDialog';
import { toSequence } from '@shared/manual-tests';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      return options?.n !== undefined ? text.replace('{{n}}', String(options.n)) : text;
    },
  }),
}));

/**
 * Writing a manual test: what is saved is an ordinary test whose steps are manual steps, with
 * no address, so it has versions and a place in plans like any other.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 7 }) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ManualTestDialog', () => {
 it('blocks independent step editing for source-derived BDD tests',()=>{
  render(<ManualTestDialog isOpen onClose={vi.fn()} test={{id:3,name:'BDD',bdd:{mode:'cucumber'},sequence:toSequence([{action:'Given A',expected:''}])} as any} onSaved={vi.fn()}/>);
  expect(screen.queryByLabelText('Action')).toBeNull();
  expect(screen.queryByText('Save')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('Gherkin source editor');
 });
 it('preserves structured arguments after explicit conversion when editing manual steps',async()=>{
 const gherkin={docString:{content:'payload'}};
 render(<ManualTestDialog isOpen onClose={vi.fn()} test={{id:3,name:'Converted',sequence:[{...toSequence([{action:'Given A',expected:''}])[0],gherkin}]}} onSaved={vi.fn()}/>);
 expect(screen.getByText('payload')).toBeInTheDocument();fireEvent.click(screen.getByText('Save'));await waitFor(()=>expect(fetchMock).toHaveBeenCalled());expect(JSON.parse(fetchMock.mock.calls[0][1].body).sequence[0].gherkin).toEqual(gherkin);
 });
  it('saves a new test as manual steps, leaving out empty ones', async () => {
    const onSaved = vi.fn();
    render(<ManualTestDialog isOpen onClose={vi.fn()} test={null} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Refund by hand' } });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'Press Refund' } });
    fireEvent.change(screen.getByLabelText('Expected result'), { target: { value: 'Refunded' } });
    fireEvent.click(screen.getByText('Add step'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tests');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ name: 'Refund by hand', url: '', elements: [] });
    expect(body.sequence).toEqual(toSequence([{ action: 'Press Refund', expected: 'Refunded' }]));
  });

  it('refuses a test without steps, and edits an existing one in place', async () => {
    const { rerender } = render(<ManualTestDialog isOpen onClose={vi.fn()} test={null} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Empty' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Write at least one step.');
    expect(fetchMock).not.toHaveBeenCalled();

    const existing = { id: 3, name: 'Old', sequence: toSequence([{ action: 'Open', expected: 'Shown' }]) };
    rerender(<ManualTestDialog isOpen onClose={vi.fn()} test={existing} onSaved={vi.fn()} />);
    expect(await screen.findByDisplayValue('Open')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tests/3');
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
  });
});

