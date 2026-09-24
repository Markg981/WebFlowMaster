import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SsoCard, { type SsoSettings } from './SsoCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

/**
 * The owner's single sign-on settings. What is worth a test: it shows the address to register
 * with the provider; it sends what was typed, domains split; an empty secret keeps the stored one;
 * requiring it needs it on; and the provider test says what happened.
 */

const CALLBACK = 'https://wfm.example.com/api/sso/callback';
const fetchMock = vi.fn();

const stored: SsoSettings = {
  issuer: 'https://idp.example.com',
  clientId: 'wfm',
  domains: ['example.com'],
  defaultRole: 'viewer',
  enabled: true,
  required: false,
  updatedAt: '2026-09-24T10:00:00.000Z',
};

function renderCard(settings: SsoSettings | null) {
  fetchMock.mockImplementation(async (url: string, init?: any) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (url === '/api/organization/sso' && method === 'GET') return { ok: true, status: 200, json: async () => ({ settings, callbackUrl: CALLBACK }) };
    if (url === '/api/organization/sso' && method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({ settings: { ...stored, ...body, updatedAt: stored.updatedAt }, callbackUrl: CALLBACK }) };
    }
    if (url === '/api/organization/sso/test') return { ok: true, status: 200, json: async () => ({ ok: false, message: 'fetch failed' }) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SsoCard />
    </QueryClientProvider>,
  );
}

const calls = (method: string) => fetchMock.mock.calls.filter(([, init]: any[]) => (init?.method ?? 'GET') === method);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('SsoCard', () => {
  it('shows the address to register, and sets the provider up with what was typed', async () => {
    renderCard(null);
    expect(await screen.findByTestId('sso-callback-url')).toHaveValue(CALLBACK);

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Issuer'), { target: { value: 'https://idp.example.com' } });
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'wfm' } });
    fireEvent.change(screen.getByLabelText('E-mail domains'), { target: { value: 'example.com, example.org' } });
    // A new provider needs its secret.
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 's3cret' } });
    fireEvent.click(save);

    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(JSON.parse(calls('PUT')[0][1].body)).toEqual({
      issuer: 'https://idp.example.com',
      clientId: 'wfm',
      clientSecret: 's3cret',
      domains: ['example.com', 'example.org'],
      defaultRole: 'viewer',
      enabled: true,
      required: false,
    });
    expect(await screen.findByTestId('sso-notice')).toHaveTextContent('Saved.');
  });

  it('keeps the stored secret when the field is left empty, and requires it only while on', async () => {
    renderCard(stored);
    expect(await screen.findByDisplayValue('https://idp.example.com')).toBeInTheDocument();
    expect(screen.getByLabelText('Client secret')).toHaveAttribute('placeholder', 'Stored. Leave empty to keep it.');

    fireEvent.click(screen.getByRole('switch', { name: 'Offer single sign-on' }));
    expect(screen.getByRole('switch', { name: 'Require it' })).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Offer single sign-on' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Require it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(JSON.parse(calls('PUT')[0][1].body)).toMatchObject({ clientSecret: '', required: true, enabled: true });
  });

  it('says when the provider does not answer', async () => {
    renderCard(stored);
    fireEvent.click(await screen.findByRole('button', { name: 'Test the provider' }));
    expect(await screen.findByTestId('sso-error')).toHaveTextContent('The provider did not answer: fetch failed');
  });
});
