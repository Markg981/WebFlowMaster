import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MobileTestDialog from './MobileTestDialog';
import MobileRunDialog from './MobileRunDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.split(`{{${name}}}`).join(String(value));
      return text;
    },
  }),
}));

/** Writing a mobile app test, uploading its app, and following a run on a device. */

const fetchMock = vi.fn();
const grids = [{ id: 'g1', name: 'BrowserStack', provider: 'browserstack' }];
const test = {
  id: 7,
  name: 'Sign in',
  platform: 'android' as const,
  app: 'bs://old',
  deviceName: 'Google Pixel 8',
  osVersion: '14.0',
  steps: [{ id: 's1', action: 'tap' as const, target: '~login' }],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('MobileTestDialog', () => {
  it('marks a locator the platform cannot read, and saves only a valid test', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 7 }) });
    const onSaved = vi.fn();
    render(<MobileTestDialog isOpen test={test} grids={grids} onClose={() => {}} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('Element of step 1'), { target: { value: '#login' } });
    expect(screen.getByText(/"#login" is not a locator for Android/)).toBeTruthy();
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByRole('alert').textContent).toBe('Correct the steps marked in red first.');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Element of step 1'), { target: { value: 'text=Sign in' } });
    fireEvent.click(screen.getByText('Add step'));
    fireEvent.change(screen.getByLabelText('Element of step 2'), { target: { value: '~welcome' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/mobile-tests/7');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ name: 'Sign in', platform: 'android', app: 'bs://old', deviceName: 'Google Pixel 8', osVersion: '14.0' });
    expect(body.steps.map((s: any) => [s.action, s.target])).toEqual([['tap', 'text=Sign in'], ['tap', '~welcome']]);
  });

  it('uploads the app to the grid and takes its address and platform', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ app: 'bs://new-app' }) });
    render(<MobileTestDialog isOpen test={null} grids={grids} onClose={() => {}} onSaved={() => {}} />);
    const file = new File(['ipa'], 'Shop.ipa');
    fireEvent.change(screen.getByLabelText('App file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText('App')).toHaveValue('bs://new-app'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/browser-grids/g1/apps');
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
    expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveTextContent('iOS');
  });
});

describe('MobileRunDialog', () => {
  it('starts a run on the grid chosen and shows each step as it comes', async () => {
    let polls = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/environments') return Promise.resolve({ ok: true, json: async () => [{ id: 3, name: 'Staging' }] });
      if (init?.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({ id: 'run-1', status: 'queued' }) });
      polls += 1;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'run-1',
          status: 'failed',
          device: 'Google Pixel 8 · 14.0',
          steps: [
            { index: 0, action: 'tap', target: '~login', status: 'failed', error: 'No visible element ~login within 15s.', durationMs: 15000 },
          ],
          error: 'No visible element ~login within 15s.',
          screenshot: 'iVBORw0KGgo=',
          sessionUrl: 'https://app-automate.browserstack.com/s/abc',
        }),
      });
    });
    const onFinished = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MobileRunDialog test={test} grids={grids} onClose={() => {}} onFinished={onFinished} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Run'));
    expect(await screen.findByText('No visible element ~login within 15s.')).toBeTruthy();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe('/api/mobile-tests/7/runs');
    expect(JSON.parse(post[1].body)).toEqual({ gridId: 'g1', environmentId: null });
    expect(screen.getByText('Video and logs on the grid').closest('a')).toHaveAttribute('href', 'https://app-automate.browserstack.com/s/abc');
    expect(screen.getByAltText('The device at the end of the run')).toBeTruthy();
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(polls).toBeGreaterThan(0);
  });

  it('points to the settings when there is no device grid', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MobileRunDialog test={test} grids={[]} onClose={() => {}} onFinished={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/add one in Settings → Browser grids/)).toBeTruthy();
    expect(screen.queryByText('Run')).toBeNull();
  });
});
