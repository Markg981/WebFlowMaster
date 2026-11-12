import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CompareEnvironmentsDialog from './CompareEnvironmentsDialog';
import { defaultPolicy } from './PolicyEditor';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) =>
            String(options?.[name] ?? ''),
          )
        : _key,
  }),
}));
const navigate = vi.fn();
vi.mock('wouter', () => ({ useLocation: () => ['/test-plans', navigate] }));
let environments = [
  { id: 1, name: 'prod', description: null, loginStateCapturedAt: null },
  { id: 2, name: 'staging', description: null, loginStateCapturedAt: null },
];
vi.mock('@/hooks/use-environments', () => ({
  useEnvironments: () => ({ data: environments, isLoading: false }),
}));

/**
 * Starting a comparison from a plan: two different environments are needed before it can start,
 * the request carries an idempotency key, and a started comparison opens its report.
 */

const fetchMock = vi.fn();

const openSelect = async (trigger: HTMLElement) => {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
};
const pick = async (label: string, option: string) => {
  await openSelect(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};

beforeEach(() => {
  environments = [
    { id: 1, name: 'prod', description: null, loginStateCapturedAt: null },
    { id: 2, name: 'staging', description: null, loginStateCapturedAt: null },
  ];
  navigate.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const renderDialog = () => {
  const onClose = vi.fn();
  render(<CompareEnvironmentsDialog plan={{ id: 'plan-1', name: 'Checkout' }} onClose={onClose} />);
  return onClose;
};

describe('CompareEnvironmentsDialog', () => {
  it('starts only with two different environments, once per key, and opens the report', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cmp-1', status: 'running', created: true }),
    });
    const onClose = renderDialog();
    const start = screen.getByRole('button', { name: 'Start comparison' });
    expect(start).toBeDisabled();

    await pick('Baseline', 'prod');
    await pick('Candidate', 'prod');
    expect(screen.getByText('Choose two different environments.')).toBeInTheDocument();
    expect(start).toBeDisabled();

    await pick('Candidate', 'staging');
    fireEvent.change(screen.getByLabelText('Name (optional)'), {
      target: { value: ' Angular 22 ' },
    });
    fireEvent.click(start);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/comparisons/cmp-1'));
    expect(onClose).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/test-plans/plan-1/comparisons');
    expect(JSON.parse(init.body)).toEqual({
      baselineEnvironmentId: 1,
      candidateEnvironmentId: 2,
      mode: 'sequential',
      name: 'Angular 22',
      policy: defaultPolicy(),
    });
    expect(init.headers['Idempotency-Key']).toEqual(expect.any(String));
  });

  it('says what the server refused, and stays open', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'The plan has no tests to run.' }),
    });
    const onClose = renderDialog();
    await pick('Baseline', 'prod');
    await pick('Candidate', 'staging');
    fireEvent.click(screen.getByRole('button', { name: 'Start comparison' }));
    expect(await screen.findByText('The plan has no tests to run.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('explains that a comparison needs two environments', () => {
    environments = [{ id: 1, name: 'prod', description: null, loginStateCapturedAt: null }];
    renderDialog();
    expect(screen.getByText(/needs two environments/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start comparison' })).toBeDisabled();
  });
});
