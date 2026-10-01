import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExportEraseCard from './ExportEraseCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.split(`{{${name}}}`).join(String(value));
      return text;
    },
  }),
}));

/** Export and erasure from Settings, over the API that used to be the only way. */

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body, blob: async () => new Blob([JSON.stringify(body)]) });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

const renderCard = (onErased = vi.fn()) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExportEraseCard onErased={onErased} />
    </QueryClientProvider>,
  );

describe('ExportEraseCard', () => {
  it('downloads the export', async () => {
    fetchMock.mockImplementation((url: string) => reply(url === '/api/organization' ? { organization: { name: 'Acme' } } : { data: {} }));
    renderCard();
    fireEvent.click(screen.getByText('Download the export'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/organization/export', expect.anything()));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('erases only once the name is typed exactly and the last warning accepted', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? reply({ erased: true }) : reply({ organization: { name: 'Acme' } }),
    );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onErased = vi.fn();
    renderCard(onErased);
    const button = screen.getByText('Erase permanently').closest('button')!;
    const field = await screen.findByLabelText('Type the organization name, Acme, to confirm');
    fireEvent.change(field, { target: { value: 'acme' } });
    expect(button).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Acme' } });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    fireEvent.click(button);
    await waitFor(() => expect(onErased).toHaveBeenCalled());
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')!;
    expect(del[0]).toBe('/api/organization');
    expect(JSON.parse(del[1].body)).toEqual({ confirmName: 'Acme' });
  });
});
