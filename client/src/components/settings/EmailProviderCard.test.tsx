import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import EmailProviderCard from './EmailProviderCard';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_: string, fallback: string) => fallback }) }));
let identity = { id: 1, organizationId: 2 };
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: identity }) }));
const request = vi.fn();
vi.mock('@/lib/queryClient', () => ({ apiRequest: (...args: unknown[]) => request(...args) }));
const settings = { smtpMode: 'custom', provider: 'generic', smtpHost: 'smtp.example.com', smtpPort: 587, smtpUsername: 'sender', smtpSecure: false, fromAddress: 'sender@example.com', hasSmtpPassword: true, hasSigningSecret: true, callbackId: 'abc', version: 1, configured: true, trackingConfigured: true };
beforeEach(() => { identity = { id: 1, organizationId: 2 }; request.mockReset(); request.mockResolvedValue({ json: async () => settings }); });
function show() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><EmailProviderCard /></QueryClientProvider>); }
it('retains write-only credentials and displays scoped callback URL', async () => {
 show(); await screen.findByDisplayValue('smtp.example.com');
 expect(screen.getByLabelText('SMTP password')).toHaveValue('');
 expect(screen.getByDisplayValue(`${window.location.origin}/api/mail-deliveries/providers/abc`)).toBeInTheDocument();
 fireEvent.click(screen.getByText('Save email settings'));
 await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/api/mail-settings', expect.objectContaining({ version: 1 })));
 const payload = request.mock.calls.find(call => call[0] === 'PUT')[2];
 expect(payload).not.toHaveProperty('smtpPassword'); expect(payload).not.toHaveProperty('signingSecret');
});
it('keeps drafts after stale writes and offers reload', async () => {
 show(); await screen.findByDisplayValue('smtp.example.com'); fireEvent.change(screen.getByLabelText('SMTP host'), { target: { value: 'draft.example.com' } });
 request.mockRejectedValueOnce({ status: 409 }); fireEvent.click(screen.getByText('Save email settings'));
 expect(await screen.findByText('Settings changed elsewhere. Your draft is preserved; reload to discard it and load the latest settings.')).toBeInTheDocument();
 expect(screen.getByLabelText('SMTP host')).toHaveValue('draft.example.com'); expect(screen.getByText('Reload settings')).toBeInTheDocument();
});
it('hides incompatible provider fields and clears drafts on identity change', async () => {
 const view = show(); await screen.findByDisplayValue('smtp.example.com'); fireEvent.change(screen.getByLabelText('SMTP password'), { target: { value: 'draft-secret' } });
 fireEvent.change(screen.getByLabelText('Tracking provider'), { target: { value: 'sendgrid' } });
 expect(screen.getByLabelText('SendGrid verification public key')).toBeInTheDocument(); expect(screen.queryByLabelText('Webhook signing secret')).not.toBeInTheDocument();
 identity = { id: 3, organizationId: 4 }; view.rerender(<QueryClientProvider client={new QueryClient()}><EmailProviderCard /></QueryClientProvider>);
 await screen.findByDisplayValue('smtp.example.com'); expect(screen.getByLabelText('SMTP password')).toHaveValue('');
});
it('explicitly clears credentials and rotates callbacks only when selected', async () => {
 show(); await screen.findByDisplayValue('smtp.example.com');
 fireEvent.click(screen.getByLabelText('Clear stored SMTP password')); fireEvent.click(screen.getByLabelText('Clear stored webhook signing secret')); fireEvent.click(screen.getByLabelText('Rotate callback URL on save'));
 fireEvent.click(screen.getByText('Save email settings'));
 await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/api/mail-settings', expect.objectContaining({ clearSmtpPassword: true, clearSigningSecret: true, rotateCallback: true })));
});
it('disables draft edits during a pending save and ignores late responses after identity switches', async () => {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 const content = () => <QueryClientProvider client={client}><EmailProviderCard /></QueryClientProvider>;
 const view = render(content()); await screen.findByDisplayValue('smtp.example.com');
 let finish!: (value: unknown) => void; request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 fireEvent.click(screen.getByText('Save email settings')); expect(screen.getByLabelText('SMTP host')).toBeDisabled();
 identity = { id: 8, organizationId: 9 }; view.rerender(content());
 await screen.findByDisplayValue('smtp.example.com'); finish({ json: async () => ({ ...settings, smtpHost: 'old-organization.example.com' }) });
 await waitFor(() => expect(screen.getByLabelText('SMTP host')).toHaveValue('smtp.example.com'));
 expect(screen.queryByDisplayValue('old-organization.example.com')).not.toBeInTheDocument();
});
it('reloads the latest revision explicitly after a conflict', async () => {
 show(); await screen.findByDisplayValue('smtp.example.com'); request.mockRejectedValueOnce({ status: 409 });
 fireEvent.click(screen.getByText('Save email settings')); await screen.findByText('Reload settings');
 request.mockResolvedValueOnce({ json: async () => ({ ...settings, version: 2, smtpHost: 'latest.example.com' }) });
 fireEvent.click(screen.getByText('Reload settings')); await screen.findByDisplayValue('latest.example.com');
 fireEvent.click(screen.getByText('Save email settings'));
 await waitFor(() => expect(request).toHaveBeenCalledWith('PUT', '/api/mail-settings', expect.objectContaining({ version: 2 })));
});
