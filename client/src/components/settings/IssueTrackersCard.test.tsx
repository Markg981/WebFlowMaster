import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import IssueTrackersCard from './IssueTrackersCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

/**
 * Where an organization files its bugs.
 *
 * The property worth a test: the token goes in and never comes back. A form that can display a
 * secret is a form that eventually puts it in a screenshot — so there is no field to show it in,
 * and an edit that leaves it blank means "leave it alone" rather than "set it to nothing".
 */

const fetchMock = vi.fn();

const tracker = {
  id: 'tracker-1',
  name: 'Jira — Shop',
  provider: 'jira',
  baseUrl: 'https://acme.atlassian.net',
  projectKey: 'SHOP',
  issueType: 'Bug',
  authenticatesAs: 'qa@acme.test',
  createdAt: '2026-09-01T00:00:00.000Z',
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <IssueTrackersCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init: any) => {
    if (String(url).includes('/test')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, detail: 'Connected to Shop.' }) });
    }
    if (init?.method === 'POST') return Promise.resolve({ ok: true, json: async () => tracker });
    return Promise.resolve({ ok: true, json: async () => [tracker] });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('IssueTrackersCard', () => {
  it('lists a tracker by what it files into and who it authenticates as', async () => {
    renderCard();

    expect(await screen.findByText('Jira — Shop')).toBeInTheDocument();
    expect(screen.getByText(/SHOP · Bug/)).toBeInTheDocument();
    expect(screen.getByText('qa@acme.test')).toBeInTheDocument();
  });

  it('has no field that could ever show the stored token', async () => {
    renderCard();
    await screen.findByText('Jira — Shop');

    const tokenField = screen.getByLabelText('API token') as HTMLInputElement;
    expect(tokenField.value).toBe('');
    expect(tokenField.type).toBe('password');
  });

  it('asks for the account email only where it means something', async () => {
    renderCard();
    await screen.findByText('Jira — Shop');

    expect(screen.getByLabelText('Account email')).toBeInTheDocument();
  });

  it('refuses a Jira tracker with no account for the token to belong to', async () => {
    renderCard();
    await screen.findByText('Jira — Shop');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jira 2' } });
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://acme.atlassian.net' } });
    fireEvent.change(screen.getByLabelText('Project key'), { target: { value: 'SHOP' } });
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tracker' }));

    expect(await screen.findByText(/email address the API token belongs to/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('checks a connection by reading, and says what it found', async () => {
    renderCard();
    await screen.findByText('Jira — Shop');

    fireEvent.click(screen.getByTitle('Test connection'));

    expect(await screen.findByText('Connected to Shop.')).toBeInTheDocument();
  });

  it('says plainly when there is nowhere to file', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: true, json: async () => [] }));
    renderCard();

    expect(await screen.findByText(/failures stay in the report/)).toBeInTheDocument();
  });
});
