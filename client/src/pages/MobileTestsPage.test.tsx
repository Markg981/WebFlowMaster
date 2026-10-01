import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MobileTestsPage from './MobileTestsPage';

let role = 'editor';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 1, role } }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.split(`{{${name}}}`).join(String(value));
      return text;
    },
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

/** Tags on mobile app tests: shown on the list, changed by editors with the library's picker. */

const fetchMock = vi.fn();
const smoke = { id: 'tag-1', name: 'smoke' };
const android = { id: 'tag-2', name: 'android' };

beforeEach(() => {
  role = 'editor';
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const reply = (body: unknown) => Promise.resolve({ ok: true, json: async () => body });
    if (url === '/api/mobile-tests') {
      return reply([{ id: 7, name: 'Checkout on Android', platform: 'android', app: 'bs://a', deviceName: 'Google Pixel 8', osVersion: null, steps: [], tags: [smoke], lastRun: null }]);
    }
    if (url === '/api/tags') return reply([smoke, android]);
    if (url === '/api/mobile-tests/7/tags' && init?.method === 'PUT') return reply({ tags: [android, smoke] });
    return reply([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MobileTestsPage />
    </QueryClientProvider>,
  );

describe('MobileTestsPage tags', () => {
  it('adds a tag to a mobile test with the picker', async () => {
    renderPage();
    await screen.findByText('Checkout on Android');
    expect(within(screen.getByTestId('mobile-test-tags-7')).getByText('smoke')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
    fireEvent.click(await screen.findByRole('button', { name: /^android$/ }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/mobile-tests/7/tags');
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body).tagIds).toEqual(['tag-1', 'tag-2']);
    });
  });

  it('shows a viewer the tags and nothing to change them with', async () => {
    role = 'viewer';
    renderPage();
    await screen.findByText('Checkout on Android');
    expect(within(screen.getByTestId('mobile-test-tags-7')).getByText('smoke')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit tags' })).toBeNull();
  });
});

describe('MobileTestsPage quarantine', () => {
  it('quarantines a mobile test with a reason', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Quarantine Checkout on Android' }));
    fireEvent.change(await screen.findByLabelText('Why'), { target: { value: 'Device farm drops the session' } });
    fireEvent.click(screen.getByRole('button', { name: 'Quarantine' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/quarantine' && init?.method === 'POST');
      expect(call).toBeDefined();
      expect(JSON.parse(call![1].body)).toEqual({ testType: 'mobile', testId: 7, reason: 'Device farm drops the session' });
    });
  });

  it('marks a test in quarantine, with its reason, and offers no second quarantine', async () => {
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/quarantine' && !init?.method
        ? Promise.resolve({ ok: true, json: async () => [{ id: 1, testType: 'mobile', testId: 7, testName: 'Checkout on Android', reason: 'Device farm drops the session' }] })
        : base(url, init),
    );
    renderPage();
    expect(await screen.findByText('In quarantine')).toHaveAttribute('title', 'Device farm drops the session');
    expect(screen.queryByRole('button', { name: 'Quarantine Checkout on Android' })).toBeNull();
  });

  it('marks a test the flaky analysis found unstable, with the device and how often', async () => {
    const base = fetchMock.getMockImplementation()!;
    const flaky = (browser: string, id: number) => ({ testName: 'x', browser, test: { type: 'mobile', id }, runs: 6, unexplainedFlips: 4 });
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url.startsWith('/api/analytics/flaky')
        ? Promise.resolve({ ok: true, json: async () => ({ items: [flaky('Pixel 8 · 14.0', 7), flaky('Galaxy S23', 7), flaky('iPhone 15', 8)] }) })
        : base(url, init),
    );
    renderPage();
    expect(await screen.findByText('Unstable')).toHaveAttribute(
      'title',
      'Pixel 8 · 14.0: changed verdict 4× in 6 runs\nGalaxy S23: changed verdict 4× in 6 runs',
    );
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/analytics/flaky?days=30')).toBe(true);
  });

  it('offers a viewer no quarantine', async () => {
    role = 'viewer';
    renderPage();
    await screen.findByText('Checkout on Android');
    expect(screen.queryByRole('button', { name: 'Quarantine Checkout on Android' })).toBeNull();
  });
});
