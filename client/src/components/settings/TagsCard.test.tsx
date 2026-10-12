import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TagsCard from './TagsCard';
import { ApiError } from '@/lib/queryClient';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {}))
        text = text.replace(`{{${name}}}`, String(value));
      return text;
    },
  }),
}));

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

const mockApiRequest = vi.fn();
vi.mock('@/lib/queryClient', async (importOriginal) => {
  // ApiError and errorMessage come from the real module: the card reads a refusal's status
  // and body through them, and a stand-in would make `instanceof` false.
  const actual = await importOriginal<typeof import('@/lib/queryClient')>();
  return { ...actual, apiRequest: (...args: unknown[]) => mockApiRequest(...args) };
});

/**
 * The organization's tags, maintained in one place: how many tests each is on, a rename that
 * every test follows, and a deletion that says how many tests it came off.
 */

let tags: unknown[] = [];

const json = (body: unknown) => ({ ok: true, json: async () => body });

beforeEach(() => {
  tags = [
    { id: 't1', name: 'smoke', uiCount: 3, apiCount: 1, mobileCount: 0 },
    { id: 't2', name: 'nigthly', uiCount: 0, apiCount: 0, mobileCount: 0 },
  ];
  mockToast.mockReset();
  mockApiRequest.mockReset();
  mockApiRequest.mockImplementation(async (method: string, url: string, body?: unknown) => {
    if (method === 'GET' && url === '/api/tags') return json(tags);
    if (method === 'PUT') return json({ id: url.split('/').pop(), name: (body as any).name });
    if (method === 'DELETE') return json({ removedFrom: 4 });
    return json({});
  });
});

const renderCard = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TagsCard />
    </QueryClientProvider>,
  );

describe('TagsCard', () => {
  it('lists every tag with how many tests carry it', async () => {
    renderCard();

    expect(await screen.findByText('smoke')).toBeInTheDocument();
    expect(screen.getByText('4 tests')).toBeInTheDocument();
    expect(screen.getByText('nigthly')).toBeInTheDocument();
    expect(screen.getByText('0 tests')).toBeInTheDocument();
  });

  it('says so when there are none yet', async () => {
    tags = [];
    renderCard();

    expect(await screen.findByText(/No tags yet/)).toBeInTheDocument();
  });

  it('renames a tag in place and refreshes the list', async () => {
    renderCard();
    await screen.findByText('nigthly');

    fireEvent.click(screen.getAllByLabelText('Rename')[1]);
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'nightly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith('PUT', '/api/tags/t2', { name: 'nightly' }),
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Tag renamed',
        description: 'Every test that carried “nigthly” now shows “nightly”.',
      }),
    );
    // The list is read again after the rename.
    await waitFor(() =>
      expect(
        mockApiRequest.mock.calls.filter(([m, u]) => m === 'GET' && u === '/api/tags').length,
      ).toBeGreaterThan(1),
    );
  });

  it('refuses an empty name before asking the server', async () => {
    renderCard();
    await screen.findByText('smoke');

    fireEvent.click(screen.getAllByLabelText('Rename')[0]);
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'A tag needs a name.', variant: 'destructive' }),
    );
    expect(mockApiRequest).not.toHaveBeenCalledWith('PUT', expect.anything(), expect.anything());
  });

  it('repeats the server’s refusal when the new name is taken', async () => {
    renderCard();
    await screen.findByText('nigthly');
    mockApiRequest.mockImplementationOnce(async () => {
      throw new ApiError(
        409,
        { error: 'This organization already has a tag called "smoke".' },
        '409: conflict',
      );
    });

    fireEvent.click(screen.getAllByLabelText('Rename')[1]);
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'smoke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'This organization already has a tag called "smoke".',
          variant: 'destructive',
        }),
      ),
    );
    // Still editing: the name is there to be corrected.
    expect(screen.getByLabelText('New name')).toHaveValue('smoke');
  });

  it('asks before deleting, warns how many tests lose the tag, and says how many did', async () => {
    renderCard();
    await screen.findByText('smoke');

    fireEvent.click(screen.getAllByLabelText('Delete')[0]);

    expect(await screen.findByText('Delete tag “smoke”?')).toBeInTheDocument();
    expect(screen.getByText(/removed from the 4 tests that carry it/)).toBeInTheDocument();
    expect(mockApiRequest).not.toHaveBeenCalledWith('DELETE', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledWith('DELETE', '/api/tags/t1'));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Tag deleted', description: 'Removed from 4 tests.' }),
    );
  });

  it('shows a 400 with the field error behind it', async () => {
    renderCard();
    await screen.findByText('smoke');
    mockApiRequest.mockImplementationOnce(async () => {
      throw new ApiError(
        400,
        {
          error: 'Invalid data',
          details: { fieldErrors: { name: ['String must contain at most 60 character(s)'] } },
        },
        '400: invalid',
      );
    });

    fireEvent.click(screen.getAllByLabelText('Rename')[0]);
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'x'.repeat(60) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Invalid data String must contain at most 60 character(s)',
          variant: 'destructive',
        }),
      ),
    );
  });
});
