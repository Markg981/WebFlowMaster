import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ForgotPassword from './ForgotPassword';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

/** "Forgot your password?": offered only where the installation sends e-mail. */

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ForgotPassword username="ann@shop.test" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.restoreAllMocks());

describe('ForgotPassword', () => {
  it('is not offered without e-mail', async () => {
    fetchMock.mockImplementation(() => reply({ available: false }));
    const { container } = renderIt();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('asks for the address, prefilled, and says a link is on its way', async () => {
    fetchMock.mockImplementation((url: string) => (url.endsWith('/available') ? reply({ available: true }) : reply({ message: 'ok' }, 202)));
    renderIt();
    fireEvent.click(await screen.findByText('Forgot your password?'));
    expect(screen.getByLabelText('The address you sign in with')).toHaveValue('ann@shop.test');
    fireEvent.click(screen.getByText('Send me a link'));
    expect(await screen.findByTestId('forgot-sent')).toHaveTextContent('a link to choose a new password is on its way');
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/password-reset/request')!;
    expect(JSON.parse(post[1].body)).toEqual({ username: 'ann@shop.test' });
  });
});
