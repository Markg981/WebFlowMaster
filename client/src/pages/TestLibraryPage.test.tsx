import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestLibraryPage from './TestLibraryPage';

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

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

/**
 * Every test this organization has, in one place — because there was no such place.
 *
 * A test was created in the builder and selected into a plan, and between those two moments it
 * was unreachable: nothing listed what existed, nothing said what a test was for, nothing could
 * show what it used to be.
 */

const fetchMock = vi.fn();

const smoke = { id: 'tag-1', name: 'smoke', uiCount: 2, apiCount: 0 };
const slow = { id: 'tag-2', name: 'slow', uiCount: 1, apiCount: 0 };

const tests = [
  {
    id: 1,
    name: 'Checkout',
    url: 'https://shop.test/checkout',
    status: 'draft',
    updatedAt: '2026-09-20T10:00:00.000Z',
    tags: [smoke],
  },
  {
    id: 2,
    name: 'Login',
    url: 'https://shop.test/login',
    status: 'draft',
    updatedAt: '2026-09-19T10:00:00.000Z',
    tags: [smoke, slow],
  },
];

function respond(url: string) {
  if (url.includes('/api/tags')) return { ok: true, json: async () => [smoke, slow] };
  return { ok: true, json: async () => tests };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TestLibraryPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  toast.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => Promise.resolve(respond(String(url))));
  vi.stubGlobal('fetch', fetchMock);
});

describe('TestLibraryPage', () => {
  it('lists the saved tests with what each one is for', async () => {
    renderPage();

    expect(await screen.findByText('Checkout')).toBeInTheDocument();
    expect(screen.getByText('Login')).toBeInTheDocument();
    // The tag is on both rows, which is the point of it.
    expect(screen.getAllByText('smoke').length).toBeGreaterThanOrEqual(2);
  });

  it('narrows by name', async () => {
    renderPage();
    await screen.findByText('Checkout');

    fireEvent.change(screen.getByLabelText('Search by name'), { target: { value: 'log' } });

    expect(screen.queryByText('Checkout')).not.toBeInTheDocument();
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('narrows by every selected tag, not by any of them', async () => {
    // Adding a second filter asks for a shorter list. An OR would hand back a longer one.
    renderPage();
    await screen.findByText('Checkout');

    const filters = within(screen.getByTestId('tag-filters'));
    fireEvent.click(filters.getByText(/^slow/));

    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument();
  });

  it('says a filter matched nothing, rather than looking empty', async () => {
    renderPage();
    await screen.findByText('Checkout');

    fireEvent.change(screen.getByLabelText('Search by name'), { target: { value: 'nothing like this' } });

    expect(screen.getByText('No test matches this filter.')).toBeInTheDocument();
  });

  it('sends the whole set of tags a test should carry', async () => {
    renderPage();
    await screen.findByText('Checkout');

    // The first row's picker: open it and add "slow" to a test that only has "smoke".
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit tags' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /^slow$/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/tests/1/tags');
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body).tagIds).toEqual(['tag-1', 'tag-2']);
    });
  });

  it('opens the history of the test that was asked for', async () => {
    renderPage();
    await screen.findByText('Checkout');

    fireEvent.click(screen.getAllByTitle('History')[0]);

    expect(await screen.findByText(/History of "Checkout"/)).toBeInTheDocument();
  });

  it('asks before deleting a test and its history', async () => {
    const confirmMock = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmMock);
    renderPage();
    await screen.findByText('Checkout');

    fireEvent.click(screen.getAllByTitle('Delete')[0]);

    expect(confirmMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('reports a failed load instead of an empty library', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/tags')) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    renderPage();

    expect(await screen.findByText('Could not load the tests')).toBeInTheDocument();
  });
});
