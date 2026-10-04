import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import EmailTemplatesCard from './EmailTemplatesCard';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let user = { id: 7, organizationId: 3 };
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user }) }));
const fetchMock = vi.fn();
const template = { purpose: 'invitation', version: 0, custom: false, subject: 'Invite', html: '<a href="{{actionUrl}}">Join</a>', text: '{{actionUrl}}', variables: ['actionUrl'] };
const response = (payload: unknown, status = 200) => ({ ok: status < 400, status, json: async () => payload, text: async () => 'conflict' });
beforeEach(() => { user = { id: 7, organizationId: 3 }; fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockResolvedValue(response({ templates: [template] })); });
function show() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><EmailTemplatesCard /></QueryClientProvider>); }
it('edits source and previews only in an empty sandbox with restrictive CSP', async () => {
  show(); await screen.findByDisplayValue('Invite');
  fetchMock.mockResolvedValueOnce(response({ subject: 'Synthetic', html: '<p>Preview</p>', text: 'Synthetic preview' }));
  fireEvent.click(screen.getByText('emailTemplates.preview'));
  const frame = await screen.findByTitle('emailTemplates.previewTitle');
  expect(frame).toHaveAttribute('sandbox', ''); expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
  expect(frame.getAttribute('srcdoc')).toContain('<p>Preview</p>');
});
it('keeps stale drafts and requires reload before another save', async () => {
  show(); const subject = await screen.findByDisplayValue('Invite'); fireEvent.change(subject, { target: { value: 'Draft' } });
  fetchMock.mockResolvedValueOnce(response({}, 409)); fireEvent.click(screen.getByText('emailTemplates.save'));
  await screen.findByText('emailTemplates.stale'); expect(screen.getByDisplayValue('Draft')).toBeInTheDocument();
  expect(screen.getByText('emailTemplates.save')).toBeDisabled();
  fetchMock.mockResolvedValueOnce(response({ subject: 'Draft', html: '<p>Preview</p>', text: 'Preview' }));
  fireEvent.click(screen.getByText('emailTemplates.preview')); await screen.findByTitle('emailTemplates.previewTitle');
  expect(screen.getByText('emailTemplates.save')).toBeDisabled();
});
it('clears tenant drafts when identity changes', async () => {
  const view = show(); const subject = await screen.findByDisplayValue('Invite'); fireEvent.change(subject, { target: { value: 'Private draft' } });
  user = { id: 8, organizationId: 4 }; view.rerender(<QueryClientProvider client={new QueryClient()}><EmailTemplatesCard /></QueryClientProvider>);
  await waitFor(() => expect(screen.queryByDisplayValue('Private draft')).not.toBeInTheDocument());
});
