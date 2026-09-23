import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SecurityCard from './SecurityCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

/**
 * A member's second factor in settings.
 *
 * What is worth a test: enrolment shows the QR and the key, sends the code, and ends on the
 * recovery codes; turning it off asks for the password and a code; and an owner cannot require
 * it of others before having it.
 */

const fetchMock = vi.fn();
let status: Record<string, unknown>;

function json(body: unknown, ok = true, statusCode = ok ? 200 : 400) {
  return Promise.resolve({ ok, status: statusCode, json: async () => body });
}

function renderCard(isOwner = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SecurityCard isOwner={isOwner} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  status = { enabled: false, enabledAt: null, recoveryCodesLeft: 0, required: false };
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: any) => {
    if (url === '/api/mfa' && !init?.method) return json(status);
    if (url === '/api/mfa/enrollment') return json({ secret: 'ABCDEFGHABCDEFGH', otpauthUri: 'otpauth://x', qrDataUrl: 'data:image/png;base64,AAA' });
    if (url === '/api/mfa/enrollment/confirm') {
      const { code } = JSON.parse(init.body);
      return code === '123456' ? json({ recoveryCodes: ['aaaaa-bbbbb', 'ccccc-ddddd'] }) : json({ error: 'That code does not match.' }, false);
    }
    if (url === '/api/mfa' && init?.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('SecurityCard', () => {
  it('enrols: QR and key, a wrong code refused, then the recovery codes', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Set up two-factor/ }));

    expect(await screen.findByAltText(/QR code/)).toHaveAttribute('src', 'data:image/png;base64,AAA');
    expect(screen.getByTestId('mfa-secret')).toHaveTextContent('ABCD EFGH ABCD EFGH');

    fireEvent.change(screen.getByLabelText('Code from the app'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('That code does not match.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Code from the app'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByTestId('recovery-codes')).toHaveTextContent('aaaaa-bbbbb');
  });

  it('turns it off with the password and a code', async () => {
    status = { enabled: true, enabledAt: '2026-09-01T00:00:00.000Z', recoveryCodesLeft: 8, required: false };
    renderCard();

    expect(await screen.findByTestId('mfa-status')).toHaveTextContent('8 recovery codes left.');
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.change(screen.getByLabelText(/Code from the app, or a recovery code/), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]: any[]) => url === '/api/mfa' && init?.method === 'DELETE');
      expect(JSON.parse(call![1].body)).toEqual({ password: 'secret', code: '654321' });
    });
  });

  it('offers no way to turn it off while the organization requires it', async () => {
    status = { enabled: true, enabledAt: '2026-09-01T00:00:00.000Z', recoveryCodesLeft: 10, required: true };
    renderCard();

    await screen.findByTestId('mfa-status');
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    expect(screen.getByText(/requires it/)).toBeInTheDocument();
  });

  it('lets an owner require it only once they have it', async () => {
    renderCard(true);
    expect(await screen.findByText('Turn it on for yourself first.')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
