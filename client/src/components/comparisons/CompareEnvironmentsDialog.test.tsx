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
 * Starting a comparison from a plan: each side needs an environment or a URL, and the sides differ,
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

    await pick('Baseline: Environment', 'prod');
    await pick('Candidate: Environment', 'prod');
    expect(
      screen.getByText('The two sides must differ: another environment or another URL.'),
    ).toBeInTheDocument();
    expect(start).toBeDisabled();

    await pick('Candidate: Environment', 'staging');
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
      baselineUrl: null,
      candidateUrl: null,
      recordedUrl: null,
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
    await pick('Baseline: Environment', 'prod');
    await pick('Candidate: Environment', 'staging');
    fireEvent.click(screen.getByRole('button', { name: 'Start comparison' }));
    expect(await screen.findByText('The plan has no tests to run.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('starts by URL alone: the candidate keeps the baseline environment', async () => {
    environments = [{ id: 1, name: 'prod', description: null, loginStateCapturedAt: null }];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'cmp-2', status: 'running', created: true }),
    });
    renderDialog();
    const start = screen.getByRole('button', { name: 'Start comparison' });
    expect(screen.getByText('Give each side an environment, a URL, or both.')).toBeInTheDocument();

    const baselineUrl = screen.getByRole('textbox', { name: 'Baseline: URL' });
    const candidateUrl = screen.getByRole('textbox', { name: 'Candidate: URL' });
    fireEvent.change(baselineUrl, { target: { value: 'https://old.example.test' } });
    fireEvent.change(candidateUrl, { target: { value: 'https://old.example.test/' } });
    expect(
      screen.getByText('The two sides must differ: another environment or another URL.'),
    ).toBeInTheDocument();
    expect(start).toBeDisabled();

    fireEvent.change(candidateUrl, { target: { value: 'ftp://new.example.test' } });
    expect(screen.getByText('An http or https address, without a user name.')).toBeInTheDocument();
    expect(start).toBeDisabled();

    fireEvent.change(candidateUrl, { target: { value: 'https://new.example.test' } });
    expect(start).toBeEnabled();
    fireEvent.click(start);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/comparisons/cmp-2'));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      baselineEnvironmentId: null,
      candidateEnvironmentId: null,
      baselineUrl: 'https://old.example.test',
      candidateUrl: 'https://new.example.test',
      recordedUrl: null,
    });
  });

  it('wants a URL on both sides before replacing the recorded address', async () => {
    renderDialog();
    await pick('Baseline: Environment', 'prod');
    await pick('Candidate: Environment', 'staging');
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Address used in the tests (optional)' }),
      {
        target: { value: 'http://localhost:4200' },
      },
    );
    expect(
      screen.getByText('The address used in the tests needs a URL on both sides.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start comparison' })).toBeDisabled();
  });
});
