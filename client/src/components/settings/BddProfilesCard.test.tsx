import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BddProfilesCard from './BddProfilesCard';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
it('creates a binding using only an advertised support target', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async () => [] } },
  });
  client.setQueryData(['/api/bdd/profiles/available'], {
    profiles: [
      {
        id: 'support',
        label: 'Support',
        pool: 'qa',
        revision: 'r2',
        provider: 'cucumber-js',
        maxDurationMs: 3000,
        connected: true,
      },
    ],
  });
  client.setQueryData(['/api/bdd/profiles'], { profiles: [] });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ profiles: [] }) });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={client}>
      <BddProfilesCard />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Team profile' } });
  fireEvent.change(screen.getByLabelText('Advertised support profile'), {
    target: { value: 'qa:support:r2' },
  });
  fireEvent.click(screen.getByText('Save profile'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    pool: 'qa',
    operatorProfileId: 'support',
    revision: 'r2',
    timeoutMs: 3000,
  });
});
