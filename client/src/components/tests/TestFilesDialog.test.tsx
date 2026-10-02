import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TestFilesDialog } from './TestFilesDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string' ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? '')) : _key,
  }),
}));

/** Export a link; import only after a preview of what would change. */

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function renderDialog(canEdit = true, onImported = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => [] } } });
  render(
    <QueryClientProvider client={client}>
      <TestFilesDialog open onOpenChange={() => {}} canEdit={canEdit} onImported={onImported} />
    </QueryClientProvider>,
  );
  return onImported;
}

describe('TestFilesDialog', () => {
  it('downloads the export from a link', () => {
    renderDialog();
    expect(screen.getByTestId('test-files-export')).toHaveAttribute('href', '/api/tests/export?format=yaml');
  });

  it('imports only after a preview, and says what happened to each test', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ dryRun: true, results: [{ kind: 'test', name: 'Login', outcome: 'updated' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ dryRun: false, results: [{ kind: 'test', name: 'Login', outcome: 'updated' }] }) });
    const onImported = renderDialog();
    expect(screen.getByTestId('test-files-import')).toBeDisabled();
    fireEvent.change(screen.getByTestId('test-files-content'), { target: { value: 'kind: webflowmaster/tests' } });
    fireEvent.click(screen.getByTestId('test-files-preview'));
    expect(await screen.findByTestId('test-files-results')).toHaveTextContent('Login');
    fireEvent.click(screen.getByTestId('test-files-import'));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ dryRun: true, projectId: null });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ dryRun: false });
  });

  it('offers only the export to a viewer', () => {
    renderDialog(false);
    expect(screen.queryByTestId('test-files-content')).toBeNull();
  });
});
