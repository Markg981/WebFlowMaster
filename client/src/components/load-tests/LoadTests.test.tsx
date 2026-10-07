import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoadTestDialog, { type LoadTestRow } from './LoadTestDialog';
import LoadRunView from './LoadRunView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
// ResponsiveContainer measures nothing in jsdom; the chart itself is recharts' business.
vi.mock('recharts', async (original) => ({
  ...(await original<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart">{children}</div>,
}));

const fetchMock = vi.fn();
const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body });

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const checkout: LoadTestRow = {
  id: 7,
  name: 'Checkout',
  description: null,
  projectId: null,
  steps: [{ apiTestId: 1, thinkTimeMs: 0 }, { apiTestId: 2, thinkTimeMs: 500 }],
  stages: [{ durationSec: 60, targetVus: 20 }, { durationSec: 120, targetVus: 20 }],
  warmUpSec: 30,
  dataSetId: 4,
  dataMode: 'vu',
  thresholds: { p95Ms: 800 },
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('LoadTestDialog', () => {
  const lists = (url: string) =>
    url === '/api/api-tests'
      ? json([{ id: 1, name: 'Sign in', method: 'POST', url: '/login' }, { id: 2, name: 'Read the cart', method: 'GET', url: '/cart' }])
      : url === '/api/test-data'
        ? json([{ id: 4, name: 'users', columns: ['email'], rows: new Array(25).fill({}) }])
        : json({});

  it('saves the scenario, the stages, the warm-up and the thresholds as they were changed', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => (init?.method ? json({ ...checkout }) : lists(url)));
    const onSaved = vi.fn();
    wrap(<LoadTestDialog isOpen test={checkout} onClose={() => {}} onSaved={onSaved} />);
    await screen.findByText('Read the cart');
    fireEvent.change(screen.getByLabelText('Warm-up (s), not judged'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('99th percentile (p99) (ms)'), { target: { value: '1500' } });
    fireEvent.click(screen.getAllByLabelText('Move up')[1]);
    fireEvent.click(screen.getByText('Add a stage'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(url).toBe('/api/load-tests/7');
    expect(JSON.parse(init.body)).toEqual({
      name: 'Checkout',
      description: null,
      projectId: null,
      steps: [{ apiTestId: 2, thinkTimeMs: 500 }, { apiTestId: 1, thinkTimeMs: 0 }],
      stages: [{ durationSec: 60, targetVus: 20 }, { durationSec: 120, targetVus: 20 }, { durationSec: 60, targetVus: 20 }],
      warmUpSec: 45,
      dataSetId: 4,
      dataMode: 'vu',
      thresholds: { p95Ms: 800, p99Ms: 1500 },
    });
  });

  it('says what is wrong before sending a definition the server would refuse', async () => {
    fetchMock.mockImplementation((url: string) => lists(url));
    wrap(<LoadTestDialog isOpen test={null} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Empty' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add at least one API test.');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });
});

describe('LoadRunView', () => {
  const stats = { requests: 900, errors: 9, errorRatePct: 1, minMs: 12, meanMs: 80, p50Ms: 70, p90Ms: 150, p95Ms: 210, p99Ms: 480, maxMs: 900 };

  it('shows the verdict, the statistics per step and the first errors of a finished run', async () => {
    fetchMock.mockImplementation(() =>
      json({
        id: 'r1', loadTestId: 7, status: 'failed', cancelRequested: false, startedAt: '2026-10-07T10:00:00Z', finishedAt: '2026-10-07T10:03:00Z',
        error: 'p95 210 ms > 200 ms',
        summary: {
          elapsedSec: 180, totalSec: 180, warmUpSec: 30, activeVus: 0, peakVus: 20,
          iterations: { completed: 440, failed: 9 }, warmUp: { requests: 120, errors: 0 },
          overall: { ...stats, rps: 6 }, steps: [{ name: 'Sign in', ...stats, requests: 450 }, { name: 'Read the cart', ...stats, requests: 450 }],
          timeline: [{ t: 0, vus: 5, requests: 10, errors: 0, p95Ms: 300 }], bucketSec: 1,
          breaches: ['p95 210 ms > 200 ms'], sampleErrors: ['Sign in: status_code equals "200" — actual: 503'],
        },
      }),
    );
    const onFinished = vi.fn();
    wrap(<LoadRunView runId="r1" canEdit onFinished={onFinished} />);
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('p95 210 ms > 200 ms');
    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.getByText('All requests')).toBeInTheDocument();
    expect(screen.getAllByText('480 ms')).toHaveLength(3);
    expect(screen.getByText('Sign in: status_code equals "200" — actual: 503')).toBeInTheDocument();
    expect(screen.queryByText('Stop the run')).not.toBeInTheDocument();
    await waitFor(() => expect(onFinished).toHaveBeenCalledOnce());
  });

  it('offers to stop a running run, and asks the server to', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      json({ id: 'r2', loadTestId: 7, status: 'running', cancelRequested: !!init?.method, startedAt: '2026-10-07T10:00:00Z', finishedAt: null, error: null, summary: null }),
    );
    wrap(<LoadRunView runId="r2" canEdit />);
    fireEvent.click(await screen.findByText('Stop the run'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/load-test-runs/r2/cancel', expect.objectContaining({ method: 'POST' })));
  });
});
