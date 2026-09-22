import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ElementRepositoryCard from './ElementRepositoryCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      return options?.name ? text.replace('{{name}}', options.name) : text;
    },
  }),
}));

/**
 * Where a selector is corrected once instead of in every test that copied it — and where the
 * healing pass's repairs surface as a list of what the application has been moving.
 */

const fetchMock = vi.fn();

const element = {
  id: 'el-1',
  name: 'Save button',
  selector: '#save-v2',
  originalSelector: '#save',
  frameSelector: null,
  healedAt: '2026-09-20T02:00:00.000Z',
  updatedAt: '2026-09-20T02:00:00.000Z',
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ElementRepositoryCard />
    </QueryClientProvider>,
  );
}

function respond(url: string) {
  if (url === '/api/projects') return { ok: true, json: async () => [{ id: 1, name: 'App' }] };
  if (url.startsWith('/api/projects/1/elements')) return { ok: true, json: async () => [element] };
  return { ok: true, json: async () => ({}) };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => respond(url));
  vi.stubGlobal('fetch', fetchMock);
});

async function chooseProject() {
  renderCard();
  await screen.findByText('Choose a project to see the elements it owns.');
  // The Select is a listbox; picking the only project by its option text.
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  fireEvent.click(await screen.findByText('App'));
}

describe('ElementRepositoryCard', () => {
  it('asks for a project before showing anything, because a selector belongs to one application', async () => {
    renderCard();

    expect(await screen.findByText('Choose a project to see the elements it owns.')).toBeInTheDocument();
  });

  it("lists a project's elements, what they used to be, and which have been healed", async () => {
    await chooseProject();

    expect(await screen.findByText('Save button')).toBeInTheDocument();
    expect(screen.getByDisplayValue('#save-v2')).toBeInTheDocument();
    expect(screen.getByText('#save')).toBeInTheDocument();
    expect(screen.getByText('healed')).toBeInTheDocument();
  });

  it('saves a corrected selector, and says it reaches every test that uses it', async () => {
    await chooseProject();
    const input = await screen.findByDisplayValue('#save-v2');

    fireEvent.change(input, { target: { value: '#save-v3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save selector' }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'PUT');
      expect(put![0]).toBe('/api/project-elements/el-1');
      expect(JSON.parse(put![1].body)).toEqual({ selector: '#save-v3' });
    });
    expect(await screen.findByText(/will run against the new selector/i)).toBeInTheDocument();
  });

  it('will not save what has not changed', async () => {
    await chooseProject();
    await screen.findByDisplayValue('#save-v2');

    expect(screen.getByRole('button', { name: 'Save selector' })).toBeDisabled();
  });

  it('repeats the server’s refusal, including which tests still use the element', async () => {
    await chooseProject();
    await screen.findByText('Save button');
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      json: async () => ({ error: 'This element is still used by 2 test(s).', tests: ['Checkout', 'Profile'] }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete element' }));

    expect(await screen.findByText(/still used by 2 test\(s\).*Checkout, Profile/)).toBeInTheDocument();
  });
});
