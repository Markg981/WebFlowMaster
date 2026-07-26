import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsPage from './settings-page';
import { TestRouter } from '@/test-utils/router';

/**
 * The page talks to the API through the global `fetch`, so that is the only seam stubbed —
 * react-query runs for real. The previous version replaced `useQuery`/`useMutation` with
 * fakes and hand-invoked the captured `onSuccess`, which asserted on the test's own
 * plumbing rather than on the page.
 */

interface Project {
  id: number;
  name: string;
  userId: number;
  createdAt: string;
}

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'testuser' },
    logoutMutation: { mutate: vi.fn(), isPending: false },
  }),
}));

const userSettings = {
  theme: 'light',
  defaultTestUrl: 'http://example.com',
  playwrightBrowser: 'chromium',
  playwrightHeadless: true,
  playwrightDefaultTimeout: 30000,
  playwrightWaitTime: 1000,
  language: 'en',
};

vi.mock('../lib/settings', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    theme: 'light',
    defaultTestUrl: 'http://example.com',
    playwrightBrowser: 'chromium',
    playwrightHeadless: true,
    playwrightDefaultTimeout: 30000,
    playwrightWaitTime: 1000,
    language: 'en',
  }),
}));

const sampleProjects: Project[] = [
  { id: 1, name: 'Project Alpha', userId: 1, createdAt: new Date().toISOString() },
  { id: 2, name: 'Project Beta', userId: 1, createdAt: new Date().toISOString() },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let projects: Project[];
let deleteResponder: (id: number) => Response;

const installFetch = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url === '/api/projects' && method === 'GET') return json(projects);
      if (url === '/api/settings') return json(userSettings);
      if (url.startsWith('/api/system-settings/')) {
        const key = url.split('/').pop()!;
        return json({ key, value: key === 'logRetentionDays' ? '7' : 'info' });
      }
      const deleteMatch = url.match(/^\/api\/projects\/(\d+)$/);
      if (deleteMatch && method === 'DELETE') {
        return deleteResponder(Number(deleteMatch[1]));
      }
      return json({}, 404);
    }),
  );
};

const renderSettingsPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <TestRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </TestRouter>
  );
  return render(<SettingsPage />, { wrapper });
};

const openDeleteDialogFor = async (projectName: string) => {
  const deleteButton = await screen.findByRole('button', {
    name: `Delete project ${projectName}`,
  });
  fireEvent.click(deleteButton);
  return screen.findByRole('alertdialog');
};

beforeEach(() => {
  vi.clearAllMocks();
  projects = [...sampleProjects];
  deleteResponder = () => new Response(null, { status: 204 });
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsPage - Project Deletion', () => {
  it('opens the confirmation dialog naming the project', async () => {
    renderSettingsPage();

    await openDeleteDialogFor('Project Alpha');

    expect(screen.getByText(/Confirm Project Deletion/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Are you sure you want to delete project "Project Alpha"/i),
    ).toBeInTheDocument();
  });

  it('closes the dialog without deleting when Cancel is clicked', async () => {
    renderSettingsPage();

    await openDeleteDialogFor('Project Alpha');
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    const deleteCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(0);
  });

  it('deletes the project, refreshes the list and reports success', async () => {
    renderSettingsPage();

    await openDeleteDialogFor('Project Alpha');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/projects/1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Project Deleted' }),
      ),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('reports the server error when deletion fails', async () => {
    const errorMessage = 'Failed to delete project spectacularly';
    deleteResponder = () => json({ error: errorMessage }, 500);

    renderSettingsPage();

    await openDeleteDialogFor('Project Alpha');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error Deleting Project',
          description: errorMessage,
          variant: 'destructive',
        }),
      ),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
