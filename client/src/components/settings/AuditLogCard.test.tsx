import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuditLogCard, { describeEntry } from './AuditLogCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

/**
 * The trail as an owner reads it.
 *
 * What is worth a test: an entry says who, whether through a key, and what in one line; the
 * export link carries the same filter as the list; and paging goes only where there is more.
 */

const fetchMock = vi.fn();

const entry = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  action: 'test.updated',
  actorUserId: 1,
  actorUsername: 'alice',
  apiKeyId: null,
  ipAddress: '10.0.0.5',
  targetType: 'test',
  targetId: '42',
  metadata: { name: 'Checkout', fields: ['sequence', 'url'] },
  createdAt: '2026-09-20T10:00:00.000Z',
  ...overrides,
});

function answer(body: unknown) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => body });
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuditLogCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('describeEntry', () => {
  it('puts what was touched in one line, without values', () => {
    expect(describeEntry({ name: 'Checkout', fields: ['sequence', 'url'] })).toBe('Checkout (sequence, url)');
    expect(describeEntry({ name: 'Every night', isActive: false, fields: ['isActive'] })).toBe('Every night (isActive) → off');
    expect(describeEntry({ keyName: 'DB_PASSWORD', environmentId: 3 })).toBe('DB_PASSWORD');
    expect(describeEntry({ reason: 'wrong_password' })).toBe('wrong password');
    expect(describeEntry(null)).toBe('');
  });
});

describe('AuditLogCard', () => {
  it('shows who, from where, through a key, and what', async () => {
    answer({
      entries: [entry(1), entry(2, { action: 'run.cancelled', apiKeyId: 'k1', metadata: { planId: 'p' } })],
      limit: 25,
      offset: 0,
      hasMore: false,
      categories: ['test', 'run'],
    });
    renderCard();

    const first = await screen.findByTestId('audit-entry-1');
    expect(within(first).getByText('alice')).toBeInTheDocument();
    expect(within(first).getByText('10.0.0.5')).toBeInTheDocument();
    expect(within(first).getByText('Checkout (sequence, url)')).toBeInTheDocument();
    expect(within(first).queryByText('API key')).toBeNull();
    expect(within(screen.getByTestId('audit-entry-2')).getByText('API key')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older' })).toBeNull();
  });

  it('pages only where there is more', async () => {
    answer({ entries: [entry(1)], limit: 25, offset: 0, hasMore: true, categories: ['test'] });
    renderCard();
    await screen.findByTestId('audit-entry-1');

    expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Older' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]: any[]) => String(url).includes('offset=25'))).toBe(true);
    });
  });

  it('exports what it shows', async () => {
    answer({ entries: [entry(1)], limit: 25, offset: 0, hasMore: false, categories: ['test'] });
    renderCard();
    await screen.findByTestId('audit-entry-1');

    expect(screen.getByRole('link', { name: /Export CSV/ })).toHaveAttribute('href', '/api/organization/audit-log?format=csv');
  });

  it('says when nothing has been recorded', async () => {
    answer({ entries: [], limit: 25, offset: 0, hasMore: false, categories: [] });
    renderCard();

    expect(await screen.findByText('Nothing recorded yet.')).toBeInTheDocument();
  });
});
