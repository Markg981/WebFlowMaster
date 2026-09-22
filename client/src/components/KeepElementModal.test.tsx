import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import KeepElementModal, { suggestedName } from './KeepElementModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key) }),
}));

/**
 * Keeping a detected element so the project owns it, rather than each test holding a copy of
 * the same selector.
 */

const fetchMock = vi.fn();

const element = {
  selector: '#save',
  text: 'Save',
  tag: 'button',
  type: 'button',
  attributes: { id: 'save' },
};

function renderModal(props: Partial<React.ComponentProps<typeof KeepElementModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KeepElementModal
        isOpen
        onClose={props.onClose ?? (() => {})}
        element={props.element === undefined ? element : props.element}
        onKept={props.onKept ?? vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => [{ id: 1, name: 'App' }] });
  vi.stubGlobal('fetch', fetchMock);
});

describe('suggestedName', () => {
  it('starts from what the page called the thing', () => {
    expect(suggestedName(element)).toBe('Save button');
    expect(suggestedName({ selector: '#x', tag: 'div' })).toBe('div');
    expect(suggestedName(null)).toBe('');
  });
});

describe('KeepElementModal', () => {
  it('proposes a name and shows the selector being kept', async () => {
    renderModal();

    expect(await screen.findByLabelText('Name')).toHaveValue('Save button');
    expect(screen.getByText('#save')).toBeInTheDocument();
  });

  it('insists on a project, because a selector is a fact about one application', async () => {
    const onKept = vi.fn();
    renderModal({ onKept });

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(await screen.findByText(/Choose the project/i)).toBeInTheDocument();
    expect(onKept).not.toHaveBeenCalled();
  });

  it('keeps the element under the chosen project', async () => {
    const onKept = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderModal({ onKept, onClose });

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    fireEvent.click(await screen.findByText('App'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    await waitFor(() => expect(onKept).toHaveBeenCalledWith({ projectId: 1, name: 'Save button' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows what the server refused and stays open', async () => {
    const onKept = vi.fn().mockRejectedValue(new Error('This project already has an element called "Save button".'));
    const onClose = vi.fn();
    renderModal({ onKept, onClose });

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    fireEvent.click(await screen.findByText('App'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(await screen.findByText(/already has an element called/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
