import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportApiTestsDialog } from './ImportApiTestsDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string' ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? '')) : _key,
  }),
}));

/** Paste, preview, keep what is new, import. */

const fetchMock = vi.fn();
const preview = {
  format: 'openapi',
  title: 'Shop',
  tests: [
    { index: 0, name: 'List orders', method: 'GET', url: '{{baseUrl}}/orders', module: 'orders', exists: true, warnings: [] },
    { index: 1, name: 'Create order', method: 'POST', url: '{{baseUrl}}/orders', module: 'orders', exists: false, warnings: ['Check the body.'] },
  ],
  variables: [{ name: 'baseUrl', value: 'https://shop.example.com', why: 'the address' }],
  warnings: [],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => [] } } });
  render(
    <QueryClientProvider client={client}>
      <ImportApiTestsDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe('ImportApiTestsDialog', () => {
  it('previews, preselects only what is new, and imports the selection', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => preview })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ created: [{ id: 1, name: 'Create order' }], skipped: [], invalid: [] }) });
    renderDialog();
    fireEvent.change(screen.getByTestId('import-content'), { target: { value: 'openapi: 3.0.0' } });
    fireEvent.click(screen.getByTestId('import-preview-button'));
    expect(await screen.findByTestId('import-preview')).toHaveTextContent('1 of 2 selected');
    expect(screen.getByTestId('import-variables')).toHaveTextContent('https://shop.example.com');
    expect(screen.getByText('Check the body.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('import-confirm'));
    expect(await screen.findByTestId('import-outcome')).toHaveTextContent('1 tests imported.');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toMatchObject({ select: [1], projectId: null });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ dryRun: true });
  });

  it('says why a file was refused', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'Neither OpenAPI 3, Swagger 2 nor a Postman collection.' }) });
    renderDialog();
    fireEvent.change(screen.getByTestId('import-content'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('import-preview-button'));
    await waitFor(() => expect(screen.getByTestId('import-error')).toHaveTextContent('Neither OpenAPI'));
  });
});
