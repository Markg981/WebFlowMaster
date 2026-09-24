import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SsoSignIn from './SsoSignIn';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key) }),
}));

/** "Sign in with SSO": offered only where some organization uses it, and it explains a refusal. */

const fetchMock = vi.fn();
const assign = vi.fn();

function renderSignIn(available: boolean, search = '') {
  window.history.replaceState(null, '', `/auth${search}`);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ available }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SsoSignIn />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, search: window.location.search, assign } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SsoSignIn', () => {
  it('offers nothing where no organization uses single sign-on', async () => {
    const { container } = renderSignIn(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('asks for the address and goes to the provider with it', async () => {
    renderSignIn(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with SSO' }));
    fireEvent.change(screen.getByLabelText('Work e-mail address'), { target: { value: ' ada@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to your identity provider' }));
    expect(assign).toHaveBeenCalledWith('/api/sso/start?email=ada%40example.com');
  });

  it('explains why the provider\'s sign-in was refused', async () => {
    vi.restoreAllMocks();
    renderSignIn(true, '?sso_error=domain_not_allowed');
    expect(await screen.findByTestId('sso-sign-in-error')).toHaveTextContent('Your e-mail address is not in a domain your organization signs in.');
  });
});
