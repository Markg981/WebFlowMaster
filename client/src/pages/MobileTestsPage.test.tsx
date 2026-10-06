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
    if (url.startsWith('/api/catalog/mobile-tests?')) {
      return reply({ items: [{ id: 7, name: 'Checkout on Android', platform: 'android', app: 'bs://a', deviceName: 'Google Pixel 8', osVersion: null, stepCount: 3, deviceCount: 2, tags: [smoke], lastRun: null }], total: 30, page: 1, pageSize: 25 });
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

it('keeps mobile history available to viewers and uses the mobile version route', async () => {
  role = 'viewer';
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'History of Checkout on Android' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/mobile-tests/7/versions')).toBe(true));
  expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
});

describe('Mobile catalog pagination and definitions', () => {
  it('requests another server page and sends literal search with page reset', async () => {
    renderPage(); await screen.findByText('Checkout on Android');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/api/catalog/mobile-tests?') && new URL(url, 'https://test').searchParams.get('page') === '2')).toBe(true));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tests' }), { target: { value: 'Checkout %_' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/api/catalog/mobile-tests?') && new URL(url, 'https://test').searchParams.get('search') === 'Checkout %_' && new URL(url, 'https://test').searchParams.get('page') === '1')).toBe(true));
  });
  it('loads the full definition before opening the editor', async () => {
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url === '/api/mobile-tests/7'
      ? Promise.resolve({ ok: true, json: async () => ({ id: 7, name: 'Full definition', platform: 'android', app: 'bs://a', deviceName: 'Pixel', osVersion: null, steps: [] }) }) : base(url, init));
    renderPage(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Checkout on Android' }));
    expect(await screen.findByDisplayValue('Full definition')).toBeTruthy();
  });
  it('does not open a blank editor when detail loading fails', async () => {
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url === '/api/mobile-tests/7'
      ? Promise.resolve({ ok: false, json: async () => ({ error: 'Denied' }) }) : base(url, init));
    renderPage(); fireEvent.click(await screen.findByRole('button', { name: 'Edit Checkout on Android' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/mobile-tests/7')).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});


it('shows counts from summaries without downloading definitions', async () => {
  renderPage();
  const row = await screen.findByTestId('mobile-test-7');
  expect(within(row).getByText('3')).toBeTruthy();
  expect(within(row).getByText('2 device/OS targets')).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/mobile-tests/7')).toBe(false);
});

it('loads matrix targets from the full definition before running', async () => {
  const base = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => url === '/api/mobile-tests/7'
    ? Promise.resolve({ ok: true, json: async () => ({ id: 7, name: 'Full run definition', platform: 'android', app: 'bs://a', deviceName: 'Pixel', osVersion: null, deviceMatrix: [{ deviceName: 'Pixel', osVersion: '14' }, { deviceName: 'Galaxy', osVersion: '13' }], steps: [] }) }) : base(url, init));
  renderPage(); fireEvent.click(await screen.findByRole('button', { name: 'Run Checkout on Android' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Full run definition');
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/mobile-tests/7')).toBe(true);
});
