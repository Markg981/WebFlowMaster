import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestHistoryDialog from './TestHistoryDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      if (options) {
        for (const [name, value] of Object.entries(options)) {
          text = text.replace(`{{${name}}}`, String(value));
        }
      }
      return text;
    },
  }),
}));

/**
 * What a test used to be.
 *
 * Somebody about to restore is deciding whether they are about to lose today's work. They are
 * not — restoring adds a version — and the only way they can know that is if this says so and
 * never offers to overwrite the version they are already on.
 */

const fetchMock = vi.fn();

const history = {
  versions: [
    {
      version: 3,
      name: 'Checkout',
      url: 'https://shop.test',
      summary: '1 step added.',
      restoredFromVersion: null,
      createdAt: '2026-09-20T10:00:00.000Z',
      authorName: 'marco',
      stepCount: 5,
      runs: 6,
      passed: 2,
      failed: 4,
      lastRunAt: '2026-09-21T02:00:00.000Z',
    },
    {
      version: 2,
      name: 'Checkout',
      url: 'https://shop.test',
      summary: 'Steps reordered.',
      restoredFromVersion: null,
      createdAt: '2026-09-19T10:00:00.000Z',
      authorName: null,
      stepCount: 4,
      runs: 10,
      passed: 10,
      failed: 0,
      lastRunAt: '2026-09-19T23:00:00.000Z',
    },
  ],
  unversionedRuns: 0,
};

function renderDialog(onRestore = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TestHistoryDialog
        isOpen
        onClose={vi.fn()}
        test={{ id: 7, name: 'Checkout' }}
        onRestore={onRestore}
      />
    </QueryClientProvider>,
  );
  return onRestore;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => history });
  vi.stubGlobal('fetch', fetchMock);
});

describe('TestHistoryDialog', () => {
  it('says what each save changed, and who saved it', async () => {
    renderDialog();

    expect(await screen.findByText('1 step added.')).toBeInTheDocument();
    expect(screen.getByText(/marco/)).toBeInTheDocument();
  });

  it('names an author who has since left rather than showing a blank', async () => {
    renderDialog();

    expect(await screen.findByText(/a member who has left/)).toBeInTheDocument();
  });

  it('does not offer to restore the version the test already is', async () => {
    renderDialog();
    await screen.findByTestId('test-history-list');

    const rows = within(screen.getByTestId('test-history-list'));
    expect(rows.getAllByRole('button', { name: /Restore/i })).toHaveLength(1);
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('promises that restoring adds rather than overwrites', async () => {
    renderDialog();

    expect(screen.getByText(/nothing between is removed/i)).toBeInTheDocument();
  });

  it('restores the version that was asked for', async () => {
    const onRestore = renderDialog();
    await screen.findByTestId('test-history-list');

    fireEvent.click(screen.getByRole('button', { name: /Restore/i }));

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(2));
  });

  it('says how each version actually did, which is what makes the list choosable', async () => {
    // A history that only lists edits cannot answer the question somebody opens it with:
    // which of these versions was the one that worked?
    renderDialog();
    await screen.findByTestId('test-history-list');

    expect(screen.getByText('2 passed')).toBeInTheDocument();
    expect(screen.getByText('4 failed')).toBeInTheDocument();
    expect(screen.getByText('10 passed')).toBeInTheDocument();
  });

  it('says a version was never run rather than showing it as clean', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...history,
        versions: [{ ...history.versions[0], runs: 0, passed: 0, failed: 0, lastRunAt: null }],
      }),
    });
    renderDialog();

    expect(await screen.findByText('Never run')).toBeInTheDocument();
  });

  it('reports the runs from before versions were recorded without attributing them', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...history, unversionedRuns: 34 }) });
    renderDialog();

    expect(await screen.findByText(/34 earlier runs/)).toBeInTheDocument();
  });

  it('reports a failed restore instead of pretending it worked', async () => {
    const onRestore = vi.fn().mockRejectedValue(new Error('Could not restore that version'));
    renderDialog(onRestore);
    await screen.findByTestId('test-history-list');

    fireEvent.click(screen.getByRole('button', { name: /Restore/i }));

    expect(await screen.findByText('Could not restore that version')).toBeInTheDocument();
  });
});
