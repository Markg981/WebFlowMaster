import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { LayoutDashboard, FileText } from 'lucide-react';
import { CommandPalette } from './CommandPalette';

vi.mock('@/lib/api/test-plans', () => ({
  fetchTestPlansAPI: vi.fn(async () => [{ id: 'plan-1', name: 'Checkout smoke' }]),
}));

const sections = [
  {
    heading: 'Testing',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  { heading: 'Operations', items: [{ href: '/reports', label: 'Reports', icon: FileText }] },
];

function renderPalette(canRun = true) {
  const location = memoryLocation({ path: '/dashboard', record: true });
  const handlers = { onToggleTheme: vi.fn(), onLogout: vi.fn() };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Router hook={location.hook}>
        <CommandPalette sections={sections} canRun={canRun} isDark={false} {...handlers} />
      </Router>
    </QueryClientProvider>,
  );
  return { location, ...handlers };
}

const pressCtrlK = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

describe('CommandPalette', () => {
  it('opens with Ctrl+K and goes to the page picked', async () => {
    const { location } = renderPalette();
    expect(screen.queryByRole('dialog')).toBeNull();

    pressCtrlK();
    expect(await screen.findByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByText('Reports'));
    expect(location.history.at(-1)).toBe('/reports');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('runs a test plan by name', async () => {
    const { location } = renderPalette();
    pressCtrlK();
    fireEvent.click(await screen.findByText('Run Checkout smoke'));
    expect(location.history.at(-1)).toBe('/test-plan/plan-1/run');
  });

  it('offers no plans to a viewer, who cannot start a run', async () => {
    renderPalette(false);
    pressCtrlK();
    await screen.findByRole('dialog');
    expect(screen.queryByText(/Checkout smoke/)).toBeNull();
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('signs out from the actions', async () => {
    const { onLogout } = renderPalette();
    pressCtrlK();
    fireEvent.click(await screen.findByText('Log out'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
