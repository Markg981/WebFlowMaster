import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SourceHostsCard from './SourceHostsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

/**
 * The commit status settings. What is worth a test: whether each host is connected and whether its
 * last status got through; an owner connects with a token that the server checks, and a refusal is
 * shown as the server worded it; nobody else is offered to change anything.
 */

const fetchMock = vi.fn();
const hosts = [
  {
    provider: 'github',
    apiUrl: 'https://api.github.com',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    lastDeliveryAt: '2026-09-24T08:00:00Z',
    lastDeliveryError: 'GitHub answered 404 (Not Found): the token cannot set statuses on acme/shop, or the repository is not there.',
  },
];

function renderCard(isOwner: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SourceHostsCard isOwner={isOwner} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      return Promise.resolve(
        body.token === 'bad'
          ? { ok: false, json: async () => ({ error: 'GitLab answered 401 (401 Unauthorized): the token is not valid.' }) }
          : { ok: true, json: async () => ({ provider: 'gitlab', apiUrl: body.apiUrl, account: 'gl-bot' }) },
      );
    }
    return Promise.resolve({ ok: true, json: async () => hosts });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('SourceHostsCard', () => {
  it('shows which host is connected and why its last status did not get through', async () => {
    renderCard(false);
    const github = await screen.findByTestId('source-host-github');
    expect(github).toHaveTextContent('connected');
    expect(github).toHaveTextContent('The last status was not set: GitHub answered 404');
    expect(screen.getByTestId('source-host-gitlab')).toHaveTextContent('not connected');
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });

  it('lets an owner connect GitLab, showing the server\'s refusal in its words and then whose token it is', async () => {
    renderCard(true);
    await screen.findByTestId('source-host-gitlab');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    fireEvent.click(screen.getByRole('button', { name: 'Check and save' }));
    expect(screen.getByText('Paste a token.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('API URL (only for a self-hosted server)'), { target: { value: 'https://git.acme.test/api/v4' } });
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check and save' }));
    expect(await screen.findByText('GitLab answered 401 (401 Unauthorized): the token is not valid.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'glpat_good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check and save' }));
    expect(await screen.findByText('Connected as gl-bot')).toBeInTheDocument();
    const put = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT').pop()!;
    expect(put[0]).toBe('/api/source-hosts/gitlab');
    expect(JSON.parse(put[1].body)).toEqual({ apiUrl: 'https://git.acme.test/api/v4', token: 'glpat_good' });
  });

  it('lets an owner disconnect', async () => {
    renderCard(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/source-hosts/github', { method: 'DELETE' }));
  });
});
