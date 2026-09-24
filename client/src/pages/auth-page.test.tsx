import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuthPage from './auth-page';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

const registerMutate = vi.fn();
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: null,
    mfaChallenge: false,
    loginMutation: { mutate: vi.fn(), isPending: false, error: null },
    registerMutation: { mutate: registerMutate, isPending: false, error: null },
  }),
}));

/**
 * The sign-in page and invitations: an invitation link opens the registration form already
 * filled in, and where accounts need an invitation the form says so and asks for one.
 */

const fetchMock = vi.fn();

function renderPage(policy: { mode: string; selfRegistration: boolean; firstAccount: boolean }) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => policy });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  registerMutate.mockReset();
  fetchMock.mockReset();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('AuthPage and invitations', () => {
  it('opens an invitation link on the registration form, filled in, and sends the token', async () => {
    const token = 'c'.repeat(64);
    window.history.replaceState(null, '', `/auth?invitation=${token}&username=maria`);
    renderPage({ mode: 'invitation', selfRegistration: false, firstAccount: false });

    const code = (await screen.findByLabelText('Invitation code')) as HTMLInputElement;
    expect(code.value).toBe(token);
    expect((document.getElementById('register-username') as HTMLInputElement).value).toBe('maria');

    fireEvent.change(document.getElementById('register-password')!, { target: { value: 'password123' } });
    fireEvent.change(document.getElementById('confirm-password')!, { target: { value: 'password123' } });
    fireEvent.submit(code.closest('form')!);

    expect(registerMutate).toHaveBeenCalledWith({ username: 'maria', password: 'password123', invitationToken: token });
  });

  it('says accounts need an invitation, and asks for the code', async () => {
    renderPage({ mode: 'invitation', selfRegistration: false, firstAccount: false });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'authPage.register.button' }));

    expect(await screen.findByTestId('invitation-required-note')).toBeInTheDocument();
    expect(screen.getByLabelText('Invitation code')).toBeRequired();
  });

  it('tells the first person that they are setting the installation up', async () => {
    renderPage({ mode: 'invitation', selfRegistration: true, firstAccount: true });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'authPage.register.button' }));

    expect(await screen.findByTestId('first-account-note')).toBeInTheDocument();
    expect(screen.queryByLabelText('Invitation code')).toBeNull();
  });

  it('opens a reset link on the new-password form, and then offers to sign in', async () => {
    const token = 'r'.repeat(40);
    window.history.replaceState(null, '', `/auth?reset=${token}&username=maria`);
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/password-reset'
        ? { ok: true, json: async () => ({ reset: true, username: 'maria' }) }
        : { ok: true, json: async () => ({ mode: 'invitation', selfRegistration: false, firstAccount: false }) },
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthPage />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'chosen-again' } });
    fireEvent.change(screen.getByLabelText('Repeat the new password'), { target: { value: 'chosen-again' } });
    fireEvent.submit(screen.getByTestId('reset-form'));

    expect(await screen.findByTestId('reset-done')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([url]: any[]) => url === '/api/password-reset');
    expect(JSON.parse(post![1].body)).toEqual({ token, newPassword: 'chosen-again' });
    expect((document.getElementById('login-username') as HTMLInputElement).value).toBe('maria');
  });

  it('asks for no code where registration is open', async () => {
    renderPage({ mode: 'open', selfRegistration: true, firstAccount: false });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'authPage.register.button' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/registration'));
    expect(screen.queryByLabelText('Invitation code')).toBeNull();
    expect(screen.queryByTestId('invitation-required-note')).toBeNull();
  });
});
