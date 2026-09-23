import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import MfaChallengeForm from './MfaChallengeForm';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key) }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

/**
 * Signing in with a second factor, as the browser does it: the password answers mfaRequired
 * and signs nobody in, the code signs in, and an attempt the server has ended sends the person
 * back to the password.
 */

const fetchMock = vi.fn();

function Harness() {
  const { user, mfaChallenge, loginMutation } = useAuth();
  if (user) return <p>signed in as {user.username}</p>;
  if (mfaChallenge) return <MfaChallengeForm />;
  return <button onClick={() => loginMutation.mutate({ username: 'alice', password: 'pw' })}>sign in</button>;
}

function renderHarness() {
  // The app's own client: use-auth writes the signed-in user into it.
  queryClient.clear();
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, statusText: '', json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('signing in with a second factor', () => {
  it('asks for the code after the password, and signs in on it', async () => {
    fetchMock.mockImplementation((url: string, init?: any) => {
      if (url === '/api/user') return reply({ message: 'Unauthorized' }, 401);
      if (url === '/api/login') return reply({ mfaRequired: true });
      if (url === '/api/login/mfa') {
        return JSON.parse(init.body).code === '123456'
          ? reply({ id: 1, username: 'alice' })
          : reply({ message: 'That code is not valid.', code: 'mfa_code_invalid' }, 401);
      }
      return reply({});
    });
    renderHarness();

    fireEvent.click(await screen.findByRole('button', { name: 'sign in' }));
    const field = await screen.findByLabelText('Code from your authenticator app');

    fireEvent.change(field, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('That code is not valid.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Code from your authenticator app'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('signed in as alice')).toBeInTheDocument();
  });

  it('goes back to the password when the server has ended the attempt', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/user') return reply({ message: 'Unauthorized' }, 401);
      if (url === '/api/login') return reply({ mfaRequired: true });
      if (url === '/api/login/mfa') return reply({ message: 'Too many wrong codes.', code: 'mfa_challenge_expired' }, 401);
      return reply({});
    });
    renderHarness();

    fireEvent.click(await screen.findByRole('button', { name: 'sign in' }));
    fireEvent.change(await screen.findByLabelText('Code from your authenticator app'), { target: { value: '999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'sign in' })).toBeInTheDocument());
  });
});
