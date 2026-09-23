import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReviewsPage from './ReviewsPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));
let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 2, role } }) }));

/**
 * The review queue.
 *
 * What is worth a test: a reviewer sees what changed and who asked, approves in one click,
 * cannot reject without a reason, and is not offered a decision on their own change; only an
 * owner sees the policy switch.
 */

const fetchMock = vi.fn();

const reviews = [
  { id: 1, testId: 9, testName: 'Checkout', version: 5, publishedVersion: 3, summary: '2 steps added', note: 'New payment step', requestedByName: 'alice', requestedAt: '2026-09-20T10:00:00.000Z', canDecide: true },
  { id: 2, testId: 10, testName: 'Login', version: 2, publishedVersion: null, summary: null, note: null, requestedByName: 'me', requestedAt: '2026-09-20T11:00:00.000Z', canDecide: false },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReviewsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  role = 'editor';
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
    if (url === '/api/test-reviews') return reply(reviews);
    if (url === '/api/organization/test-review-policy') return reply({ required: true });
    return reply({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ReviewsPage', () => {
  it('shows what changed and who asked, and approves', async () => {
    renderPage();
    const item = await screen.findByTestId('review-1');
    expect(within(item).getByText('2 steps added')).toBeInTheDocument();
    expect(within(item).getByText('replaces version 3')).toBeInTheDocument();
    expect(within(item).getByText(/Asked by alice/)).toBeInTheDocument();

    fireEvent.click(within(item).getByRole('button', { name: /Approve and publish/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]: any[]) => url === '/api/test-reviews/1/approve')).toBe(true));
  });

  it('does not reject without a reason', async () => {
    renderPage();
    const item = await screen.findByTestId('review-1');

    fireEvent.click(within(item).getByRole('button', { name: 'Reject' }));
    expect(await within(item).findByText(/Say what needs to change/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]: any[]) => String(url).endsWith('/reject'))).toBe(false);

    fireEvent.change(within(item).getByLabelText('Comment on Checkout'), { target: { value: 'Step 3 is wrong' } });
    fireEvent.click(within(item).getByRole('button', { name: 'Reject' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]: any[]) => url === '/api/test-reviews/1/reject');
      expect(JSON.parse(call![1].body)).toEqual({ comment: 'Step 3 is wrong' });
    });
  });

  it('offers no decision on one’s own change, and no policy switch to a non-owner', async () => {
    renderPage();
    const own = await screen.findByTestId('review-2');
    expect(within(own).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows the policy switch to an owner', async () => {
    role = 'owner';
    renderPage();
    expect(await screen.findByRole('switch')).toBeChecked();
  });
});
