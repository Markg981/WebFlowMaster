import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectAccessDialog from './ProjectAccessDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

/**
 * The owner's view of who can reach a project.
 *
 * What is worth a test: it starts from what the server says, owners are not offered as members
 * (they see everything anyway), and saving sends the switch and the list as they are on screen.
 */

const fetchMock = vi.fn();

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectAccessDialog projectId={7} open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: any) => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
    if (url === '/api/projects/7/access' && !init?.method) {
      return reply({ projectId: 7, name: 'Checkout', restricted: true, members: [{ userId: 2, username: 'alice', role: 'editor' }] });
    }
    if (url === '/api/organization') {
      return reply({
        members: [
          { id: 1, username: 'olga', role: 'owner' },
          { id: 2, username: 'alice', role: 'editor' },
          { id: 3, username: 'bob', role: 'editor' },
        ],
      });
    }
    if (init?.method === 'PUT') return reply({});
    return reply({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ProjectAccessDialog', () => {
  it('shows who is on the project, and saves the list as edited', async () => {
    const onOpenChange = renderDialog();

    const list = await screen.findByTestId('project-members');
    expect(within(list).getByText('alice')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Remove alice' }));
    expect(within(list).getByText('Nobody is listed: only owners can reach it.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'PUT');
      expect(JSON.parse(put![1].body)).toEqual({ restricted: false, members: [] });
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('does not offer owners, or people already listed, as members', async () => {
    renderDialog();
    await screen.findByTestId('project-members');

    fireEvent.click(await screen.findByRole('combobox', { name: 'Add a member' }));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(options).toEqual(['bob']);
  });
});
