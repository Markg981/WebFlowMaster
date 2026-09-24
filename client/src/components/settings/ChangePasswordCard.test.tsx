import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChangePasswordCard from './ChangePasswordCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', role: 'editor' } }),
}));

/**
 * Changing one's own password. Worth a test: nothing is sent until the new password is long
 * enough and typed twice the same; the server's refusal of a wrong current password is shown.
 */

const fetchMock = vi.fn();

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChangePasswordCard />
    </QueryClientProvider>,
  );
}

const fill = (current: string, next: string, again: string) => {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Repeat the new password'), { target: { value: again } });
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('ChangePasswordCard', () => {
  it('says who is signed in', () => {
    renderCard();
    expect(screen.getByText(/Signed in as alice/)).toBeInTheDocument();
  });

  it('sends nothing while the new password is too short or typed differently', () => {
    renderCard();

    fill('old-password', 'short', 'short');
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change password/i })).toBeDisabled();

    fill('old-password', 'long-enough-1', 'long-enough-2');
    expect(screen.getByText('The two new passwords are different.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change password/i })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('changes it, and says other sessions were signed out', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ changed: true }) });
    renderCard();

    fill('old-password', 'new-password', 'new-password');
    fireEvent.click(screen.getByRole('button', { name: /Change password/i }));

    expect(await screen.findByText(/other session you had open has been signed out/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/user/password');
    expect(JSON.parse(init.body)).toEqual({ currentPassword: 'old-password', newPassword: 'new-password' });
  });

  it('shows the refusal of a wrong current password', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'The current password is not correct.' }) });
    renderCard();

    fill('wrong', 'new-password', 'new-password');
    fireEvent.click(screen.getByRole('button', { name: /Change password/i }));

    await waitFor(() => expect(screen.getByText('The current password is not correct.')).toBeInTheDocument());
  });
});
