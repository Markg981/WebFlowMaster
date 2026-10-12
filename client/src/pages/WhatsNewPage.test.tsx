import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WhatsNewPage from './WhatsNewPage';
import { useWhatsNew, WHATS_NEW_SEEN_KEY } from '@/hooks/use-whats-new';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key),
    i18n: { language: 'en' },
  }),
}));

/**
 * The "What's new" page: the changelog the server ships, newest first, and the dot on the account
 * menu that it clears.
 */

const body = {
  stamp: 'Unreleased#42',
  releases: [
    {
      version: 'Unreleased',
      date: null,
      sections: [
        {
          title: 'Added',
          entries: [
            { text: 'Run `wfm run` from a pipeline', pr: 42, url: 'https://example.test/pull/42' },
            { text: 'A note without a pull request', pr: null, url: null },
          ],
        },
      ],
    },
    {
      version: '1.0.0',
      date: '2026-09-30',
      sections: [
        {
          title: 'Fixed',
          entries: [{ text: 'Old fix', pr: 3, url: 'https://example.test/pull/3' }],
        },
      ],
    },
  ],
};

const fetchMock = vi.fn();
const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function Dot() {
  const { hasNews } = useWhatsNew();
  return <span>{hasNews ? 'dot' : 'no dot'}</span>;
}

describe('WhatsNewPage', () => {
  it('lists each release with its kinds of change, code and links to the pull requests', async () => {
    wrap(<WhatsNewPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Latest changes' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '1.0.0' })).toBeTruthy();
    expect(screen.getByText('September 30, 2026')).toBeTruthy();

    const added = screen.getByRole('region', { name: 'Added' });
    expect(within(added).getByText('wfm run').tagName).toBe('CODE');
    const link = within(added).getByRole('link', { name: /#42/ });
    expect(link.getAttribute('href')).toBe('https://example.test/pull/42');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(within(added).getByText('A note without a pull request')).toBeTruthy();
    expect(within(added).getAllByRole('link')).toHaveLength(1);
  });

  it('marks what it shows as seen, which clears the dot', async () => {
    const dot = wrap(<Dot />);
    expect(await dot.findByText('dot')).toBeTruthy();
    dot.unmount();

    wrap(<WhatsNewPage />);
    await waitFor(() => expect(localStorage.getItem(WHATS_NEW_SEEN_KEY)).toBe('Unreleased#42'));

    const again = wrap(<Dot />);
    expect(await again.findByText('no dot')).toBeTruthy();
  });

  it('says so when the server has no changelog', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ stamp: null, releases: [] }) });
    wrap(<WhatsNewPage />);
    expect(await screen.findByText('This installation has no list of changes.')).toBeTruthy();
    expect(localStorage.getItem(WHATS_NEW_SEEN_KEY)).toBeNull();
  });
});
