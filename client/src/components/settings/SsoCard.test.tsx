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
 * requiring it needs it on; the provider test says what happened; domains show their TXT record
 * and can be verified; group mappings are sent, and "require a group" needs one.
 */

const CALLBACK = 'https://wfm.example.com/api/sso/callback';
const SAML = {
  entityId: 'https://wfm.example.com/api/sso/saml/7',
  acsUrl: 'https://wfm.example.com/api/sso/saml/7/acs',
  metadataUrl: 'https://wfm.example.com/api/sso/saml/7/metadata',
};
const CERT = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const fetchMock = vi.fn();

const stored: SsoSettings = {
  protocol: 'oidc',
  issuer: 'https://idp.example.com',
  clientId: 'wfm',
  samlSsoUrl: null,
  samlCertificate: null,
  samlCertificateInfo: null,
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
    if (url === '/api/organization/sso' && method === 'GET') return { ok: true, status: 200, json: async () => ({ settings, callbackUrl: CALLBACK, saml: SAML }) };
    if (url === '/api/organization/sso' && method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({ settings: { ...stored, ...body, updatedAt: stored.updatedAt }, callbackUrl: CALLBACK, saml: SAML }) };
    }
    if (url === '/api/organization/sso/saml-metadata') {
      return { ok: true, status: 200, json: async () => ({ entityId: 'https://idp.example.com/saml', ssoUrl: 'https://idp.example.com/saml/sso', certificate: CERT }) };
    }
    if (url === '/api/organization/sso/domains/example.com/verify') return { ok: true, status: 200, json: async () => ({ verified: false, message: 'No TXT record at _wfm-verification.example.com yet.' }) };
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
      protocol: 'oidc',
      issuer: 'https://idp.example.com',
      clientId: 'wfm',
      clientSecret: 's3cret',
      domains: ['example.com', 'example.org'],
      defaultRole: 'viewer',
      enabled: true,
      required: false,
      groupAttribute: 'groups',
      roleMappings: [],
      requireGroup: false,
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

  it('for SAML, shows what to give the provider, fills from pasted metadata, and sends no client secret', async () => {
    renderCard({
      ...stored,
      protocol: 'saml',
      issuer: 'https://old.example.com/saml',
      clientId: null,
      samlSsoUrl: 'https://old.example.com/sso',
      samlCertificate: CERT,
      samlCertificateInfo: { subject: 'CN=old-idp', validTo: '2030-01-01T00:00:00.000Z', expired: false },
    });
    expect(await screen.findByTestId('sso-saml-entity-id')).toHaveValue(SAML.entityId);
    expect(screen.getByTestId('sso-saml-acs-url')).toHaveValue(SAML.acsUrl);
    expect(screen.getByTestId('sso-saml-metadata-url')).toHaveValue(SAML.metadataUrl);
    expect(screen.getByTestId('sso-saml-cert-info')).toHaveTextContent('CN=old-idp · valid until 2030-01-01');
    expect(screen.queryByLabelText('Client secret')).toBeNull();

    fireEvent.change(screen.getByLabelText(/Your provider's metadata/), { target: { value: '<md:EntityDescriptor/>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read the metadata' }));
    expect(await screen.findByDisplayValue('https://idp.example.com/saml')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://idp.example.com/saml/sso')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    const body = JSON.parse(calls('PUT')[0][1].body);
    expect(body).toMatchObject({ protocol: 'saml', issuer: 'https://idp.example.com/saml', samlSsoUrl: 'https://idp.example.com/saml/sso', samlCertificate: CERT });
    expect(body).not.toHaveProperty('clientSecret');
  });

  it('shows each domain\'s TXT record, and says what the check found', async () => {
    renderCard({
      ...stored,
      domains: ['example.com', 'example.org'],
      verificationRequired: true,
      domainStatus: [
        { domain: 'example.com', verified: false, verifiedAt: null, record: { name: '_wfm-verification.example.com', value: 'wfm-verification=abc123' } },
        { domain: 'example.org', verified: true, verifiedAt: '2026-09-30T10:00:00.000Z', record: null },
      ],
    });
    const rows = await screen.findAllByTestId('sso-domain-row');
    expect(rows[0]).toHaveTextContent('_wfm-verification.example.com = wfm-verification=abc123');
    expect(rows[1]).toHaveTextContent('proven');
    expect(screen.getByTestId('sso-domain-verification')).toHaveTextContent('signs nobody in until it is proven');

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('No TXT record at _wfm-verification.example.com yet.')).toBeInTheDocument();
    expect(calls('POST').map(([url]: any[]) => url)).toEqual(['/api/organization/sso/domains/example.com/verify']);
  });

  it('sends the group mappings, and refuses whoever is in none only once a group is mapped', async () => {
    renderCard(stored);
    const requireGroup = await screen.findByRole('switch', { name: 'Refuse whoever is in none of these groups' });
    expect(requireGroup).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Claim or attribute with the groups'), { target: { value: 'roles' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map a group' }));
    fireEvent.change(screen.getByLabelText('Group of mapping 1'), { target: { value: ' wfm-users ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map a group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove mapping 2' }));
    fireEvent.click(requireGroup);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(JSON.parse(calls('PUT')[0][1].body)).toMatchObject({
      groupAttribute: 'roles',
      roleMappings: [{ group: 'wfm-users', role: 'viewer' }],
      requireGroup: true,
    });
  });

  it('says when the provider does not answer', async () => {
    renderCard(stored);
    fireEvent.click(await screen.findByRole('button', { name: 'Test the provider' }));
    expect(await screen.findByTestId('sso-error')).toHaveTextContent('The provider did not answer: fetch failed');
  });
});
