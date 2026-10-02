import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScimProvisioning } from './ScimProvisioning';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

/** The SCIM part of the single sign-on card: the base URL, a token shown once, revoking it. */

const BASE = 'https://wfm.example.com/api/scim/v2';
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('ScimProvisioning', () => {
  it('issues a token and shows it once, with the base URL to give the provider', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ token: 'wfmscim_secret', scimToken: { prefix: 'wfmscim_secr' } }) });
    const onChanged = vi.fn();
    render(<ScimProvisioning baseUrl={BASE} token={null} onChanged={onChanged} />);
    expect(screen.getByTestId('sso-scim-base-url')).toHaveValue(BASE);
    expect(screen.getByText('No token: provisioning is off.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sso-scim-issue'));
    await waitFor(() => expect(screen.getByDisplayValue('wfmscim_secret')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/organization/sso/scim-token', expect.objectContaining({ method: 'POST' }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows the token by prefix and revokes it after a confirmation', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    const onChanged = vi.fn();
    render(<ScimProvisioning baseUrl={BASE} token={{ prefix: 'wfmscim_abcdefgh', createdAt: '2026-10-01T10:00:00.000Z', lastUsedAt: null }} onChanged={onChanged} />);
    expect(screen.getByTestId('sso-scim-status')).toHaveTextContent('wfmscim_abcdefgh');
    expect(screen.getByTestId('sso-scim-issue')).toHaveTextContent('Replace the token');
    fireEvent.click(screen.getByText('Revoke'));
    fireEvent.click(screen.getByText('Revoke: the provider stops provisioning'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/organization/sso/scim-token', expect.objectContaining({ method: 'DELETE' }));
  });
});
