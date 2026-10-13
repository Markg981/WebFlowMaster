import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TestRouter } from '@/test-utils/router';
import AppShell from './AppShell';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { username: 'ada.lovelace@example.com', role: 'owner' },
    logoutMutation: { mutate: vi.fn() },
  }),
}));
vi.mock('@/hooks/use-workspace-name', () => ({ useWorkspaceName: () => 'Acme' }));
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ isDark: false, toggle: vi.fn() }) }));
vi.mock('./OrganizationSwitcher', () => ({ OrganizationSwitcher: () => null }));
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./SubscriptionBanner', () => ({ SubscriptionBanner: () => null }));
const news = vi.hoisted(() => ({ hasNews: false }));
vi.mock('@/hooks/use-whats-new', () => ({ useWhatsNew: () => news }));

const renderShell = () =>
  render(
    <TestRouter path="/dashboard">
      <AppShell>
        <p>page content</p>
      </AppShell>
    </TestRouter>,
  );

/**
 * On a phone the sidebar is a drawer behind the header's menu button. It used to be a plain
 * overlay: no dialog role, Escape did nothing and Tab walked out into the page behind it.
 */
describe('AppShell navigation drawer', () => {
  it('opens as a labelled dialog and closes once a page is chosen', async () => {
    renderShell();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    fireEvent.click(within(drawer).getByRole('link', { name: 'Reports' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('banner')).toHaveTextContent('Reports');
  });

  it('closes on Escape and gives the focus back to the menu button', async () => {
    renderShell();
    const opener = screen.getByRole('button', { name: 'Open menu' });
    opener.focus();
    fireEvent.click(opener);
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });

    fireEvent.keyDown(drawer, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });
});

describe('AppShell what is new', () => {
  it('marks the account button while there are changes the member has not read', () => {
    news.hasNews = true;
    const { unmount } = renderShell();
    // The name does not change, so "click Account" keeps working; the news is the description.
    const account = screen.getByRole('button', { name: 'Account' });
    expect(account).toHaveAccessibleDescription('New changes to read in What’s new');
    expect(screen.getByTestId('whats-new-dot')).toBeTruthy();
    unmount();

    news.hasNews = false;
    renderShell();
    expect(screen.getByRole('button', { name: 'Account' })).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByTestId('whats-new-dot')).toBeNull();
  });
});

describe('AppShell contextual help', () => {
  it('links the "?" to the manual section for the page, in a new tab', () => {
    renderShell();
    const help = screen.getByRole('link', { name: /help for this page/i });
    // The test i18n runs in English; the language and anchor mapping is in scripts/help-links.test.ts.
    expect(help).toHaveAttribute('href', '/docs/en/guide/results#dashboard');
    expect(help).toHaveAttribute('target', '_blank');
  });
});
