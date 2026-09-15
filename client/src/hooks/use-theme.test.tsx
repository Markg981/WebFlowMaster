import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTheme, type Theme } from './use-theme';

/**
 * The reversion this pins down:
 *
 * Turn on dark mode from the topbar, then open Settings, and the whole application went back
 * to light and stayed there. The topbar wrote the class and POSTed the choice but told
 * neither of the two caches holding the settings — `["settings"]` and
 * `["userSettingsApp", userId]` — and the query client sets `staleTime: Infinity`, so
 * neither is ever refetched. Settings then read its stale "light" and wrote it to <html>.
 */

function Probe() {
  const { isDark, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="state">{isDark ? 'dark' : 'light'}</span>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
    </div>
  );
}

function renderWithClient(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
}

const settings = (theme: Theme) => ({
  theme,
  defaultTestUrl: null,
  playwrightBrowser: 'chromium' as const,
  playwrightHeadless: true,
  playwrightDefaultTimeout: 30000,
  playwrightWaitTime: 1000,
  language: 'en',
});

let client: QueryClient;

beforeEach(() => {
  document.documentElement.className = '';
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  // The class is reset in beforeEach, not here: this hook runs before Testing Library's own
  // cleanup, so the probe is still mounted and its observer would see the reset and update
  // state outside act().
});

describe('useTheme', () => {
  it('reads the current theme from the document, not from a default', async () => {
    document.documentElement.classList.add('dark');
    renderWithClient(client);
    expect(screen.getByTestId('state')).toHaveTextContent('dark');
  });

  it('applies the choice to the document', async () => {
    renderWithClient(client);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'dark' }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'light' }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('writes the choice into every cached copy of the settings', async () => {
    // Both caches as they would be after a visit to Settings and a page load.
    client.setQueryData(['settings'], settings('light'));
    client.setQueryData(['userSettingsApp', 7], settings('light'));

    renderWithClient(client);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'dark' }));
      await new Promise((r) => setTimeout(r, 0));
    });

    // Without this, the next screen to read either key applies "light" and undoes the
    // choice — and with staleTime: Infinity nothing would ever correct it.
    expect(client.getQueryData<{ theme: string }>(['settings'])?.theme).toBe('dark');
    expect(client.getQueryData<{ theme: string }>(['userSettingsApp', 7])?.theme).toBe('dark');
  });

  it('leaves unrelated queries alone', async () => {
    client.setQueryData(['projects'], [{ id: 1, name: 'Checkout' }]);
    renderWithClient(client);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'dark' }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(client.getQueryData(['projects'])).toEqual([{ id: 1, name: 'Checkout' }]);
  });

  it('persists the choice', async () => {
    renderWithClient(client);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'dark' }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('/api/settings');
    expect(call[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(call[1].body)).toEqual({ theme: 'dark' });
  });

  it('follows the class when something else changes it', async () => {
    renderWithClient(client);
    expect(screen.getByTestId('state')).toHaveTextContent('light');

    // What the cold-start applier in App.tsx does once its query lands.
    await act(async () => {
      document.documentElement.classList.add('dark');
      // Let the MutationObserver callback run before asserting.
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByTestId('state')).toHaveTextContent('dark');
  });
});
