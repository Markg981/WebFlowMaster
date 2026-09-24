import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AgentsCard from './AgentsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

/**
 * Local agents in Settings. What is worth a test: whether each is connected and whether its
 * Playwright will be lent browsers; the token appears once with what to run; only an owner is
 * offered to create or revoke; revoked agents are not listed.
 */

const fetchMock = vi.fn();

const agent = (overrides: Record<string, unknown>) => ({
  id: 'a1',
  name: 'Build box',
  pool: 'onprem',
  tokenPrefix: 'wfa_abcd1234',
  createdAt: '2026-09-01T00:00:00Z',
  lastSeenAt: '2026-09-24T08:00:00Z',
  hostname: 'qa-01',
  agentVersion: '1',
  playwrightVersion: '1.61.1',
  browsers: ['chromium', 'firefox'],
  revokedAt: null,
  connected: true,
  activeSessions: 2,
  ...overrides,
});

const listing = {
  serverPlaywrightVersion: '1.61.1',
  agents: [
    agent({}),
    agent({ id: 'a2', name: 'Old laptop', connected: false, activeSessions: 0, playwrightVersion: '1.58.0' }),
    agent({ id: 'a3', name: 'Gone', revokedAt: '2026-09-02T00:00:00Z' }),
  ],
};

function renderCard(isOwner: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AgentsCard isOwner={isOwner} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/api/agents') {
      return Promise.resolve({ ok: true, json: async () => ({ agent: agent({ id: 'a4', name: 'New box' }), token: 'wfa_secret-token' }) });
    }
    return Promise.resolve({ ok: true, json: async () => listing });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('AgentsCard', () => {
  it('shows which agents are connected, what they lend, and which will not be lent browsers', async () => {
    renderCard(false);

    const box = await screen.findByTestId('agent-a1');
    expect(box).toHaveTextContent('connected');
    expect(box).toHaveTextContent('2 browser(s) lent');
    expect(box).toHaveTextContent('qa-01 · Playwright 1.61.1 · chromium, firefox');
    expect(screen.getByTestId('agent-a2')).toHaveTextContent('offline');
    expect(screen.getByTestId('agent-a2')).toHaveTextContent('Runs Playwright 1.58.0, the server 1.61.1');
    expect(screen.queryByText('Gone')).not.toBeInTheDocument();
    // Not an owner: nothing to create or revoke.
    expect(screen.queryByRole('button', { name: 'Create agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revoke/ })).not.toBeInTheDocument();
  });

  it('shows an owner the new token once, with the commands to run it', async () => {
    renderCard(true);
    await screen.findByTestId('agent-a1');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New box' } });
    fireEvent.change(screen.getByLabelText('Pool'), { target: { value: 'lab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    const issued = await screen.findByTestId('agent-token');
    expect(issued).toHaveTextContent('it will not be shown again');
    expect(issued).toHaveTextContent('/cli/wfm-agent.mjs');
    expect(issued).toHaveTextContent('npm install playwright@1.61.1 ws');
    expect(issued).toHaveTextContent('WFM_AGENT_TOKEN=wfa_secret-token node wfm-agent.mjs');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(post![1].body)).toEqual({ name: 'New box', pool: 'lab' });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(/wfa_secret-token/)).not.toBeInTheDocument();
  });

  it('asks for a name before creating', async () => {
    renderCard(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Create agent' }));
    expect(screen.getByText(/Give the agent a name/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('lets an owner revoke an agent', async () => {
    renderCard(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke Build box' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/agents/a1/revoke', { method: 'POST' }));
  });
});
