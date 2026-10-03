import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommentsPanel from './CommentsPanel';
const state = vi.hoisted(() => ({ user: { id: 1, organizationId: 10, role: 'viewer' } as { id: number; organizationId: number; role: string } | null }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_: string, fallback: string) => fallback }) }));
const fetchMock = vi.fn();
const row = { id: 9, authorId: 1, authorName: 'Alice', body: '<b>Investigating</b>', createdAt: '2026-10-02T10:00:00Z' };
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CommentsPanel kind="ui" targetId={7} /></QueryClientProvider>); }
beforeEach(() => {
  state.user = { id: 1, organizationId: 10, role: 'viewer' };
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => [row] });
  vi.stubGlobal('fetch', fetchMock);
});
describe('CommentsPanel', () => {
  it('composes a reply with member mentions and resolves roots', async () => {
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/members') ? [{ id: 2, username: 'Bob' }] : [row] }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByLabelText('Reply message'), { target: { value: 'Can you review?' } });
    fireEvent.click(screen.getAllByLabelText('Mention Bob')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Add reply' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/comments/ui/7', expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: 'Can you review?', parentId: 9, mentionedUserIds: [2] }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve conversation' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/comments/9/resolution', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ resolved: true }) })));
  });
  it('groups replies, shows tombstones, filters and hides replies on resolved roots', async () => {
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/members') ? [] : [
      { ...row, deletedAt: '2026-10-04T00:00:00Z', body: '', resolvedAt: '2026-10-04T00:00:00Z' },
      { ...row, id: 10, authorId: 2, authorName: 'Bob', parentId: 9, body: 'Preserved reply' },
    ] }));
    mount();
    expect(await screen.findByText('This comment was deleted.')).toBeInTheDocument();
    expect(screen.getByText('Preserved reply')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Conversation filter'), { target: { value: 'mentions' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/comments/ui/7?filter=mentions', expect.anything()));
  });
  it('lets authors remove mention recipients during edits and reopen resolved roots', async () => {
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/members') ? [{ id: 2, username: 'Bob' }] : [{ ...row, mentionedUserIds: [2], resolvedAt: '2026-10-04T00:00:00Z' }] }));
    mount();
    expect(await screen.findByText('@Bob', { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }));
    fireEvent.click(screen.getAllByLabelText('Mention Bob')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/comments/9', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ body: row.body, mentionedUserIds: [] }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen conversation' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/comments/9/resolution', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ resolved: false }) })));
  });
  it('renders plain text and lets viewers submit nonempty discussion', async () => {
    mount();
    expect(await screen.findByText(row.body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add comment' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New comment'), { target: { value: ' Reviewed ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/comments/ui/7', expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: 'Reviewed' }) })));
  });
  it('offers author edit/delete and saves edits', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit comment' }));
    fireEvent.change(screen.getByLabelText('Edit comment'), { target: { value: 'Resolved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/comments/9', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ body: 'Resolved' }) })));
  });
  it('hides edit/delete from other viewers', async () => {
    state.user = { id: 2, organizationId: 10, role: 'viewer' };
    mount();
    await screen.findByText(row.body);
    expect(screen.queryByRole('button', { name: 'Delete comment' })).not.toBeInTheDocument();
  });
  it('allows owners to moderate another author discussion', async () => {
    state.user = { id: 2, organizationId: 10, role: 'owner' };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete comment' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/comments/9', expect.objectContaining({ method: 'DELETE' })));
  });
  it('reports failed requests without discarding a draft', async () => {
    mount();
    await screen.findByText(row.body);
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    fireEvent.change(screen.getByLabelText('New comment'), { target: { value: 'Keep this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the comment');
    expect(screen.getByLabelText('New comment')).toHaveValue('Keep this');
  });
  it('does not reuse a private discussion after logout and account switches with an indefinitely fresh cache', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const view = () => <QueryClientProvider client={client}><CommentsPanel kind="ui" targetId={7} /></QueryClientProvider>;
    const rendered = render(view());
    await screen.findByText(row.body);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    state.user = null;
    rendered.rerender(view());
    expect(screen.queryByText(row.body)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Another member of the same tenant cannot see this restricted project.
    state.user = { id: 2, organizationId: 10, role: 'viewer' };
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    rendered.rerender(view());
    expect(screen.queryByText(row.body)).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load comments');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // The tenant also scopes a user's cache, even when their user id is unchanged.
    state.user = { id: 1, organizationId: 20, role: 'viewer' };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [] });
    rendered.rerender(view());
    expect(screen.queryByText(row.body)).not.toBeInTheDocument();
    await screen.findByText('No comments yet.');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
