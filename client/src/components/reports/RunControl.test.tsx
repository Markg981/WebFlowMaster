import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AttemptsBadge from './AttemptsBadge';
import CancelRunButton from './CancelRunButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, values?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : _key;
      const vars = typeof fallback === 'object' ? fallback : values ?? {};
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars[name] ?? ''));
    },
  }),
}));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => toast(...args) }));

describe('AttemptsBadge', () => {
  it('says nothing for a test that ran once, which is almost every test', () => {
    const { container } = render(<AttemptsBadge attempts={1} status="Passed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('calls a pass on a later attempt flaky', () => {
    render(<AttemptsBadge attempts={2} status="Passed" />);
    expect(screen.getByText('Flaky · passed on attempt 2')).toBeInTheDocument();
  });

  it('counts the attempts of a test that failed on all of them', () => {
    render(<AttemptsBadge attempts={3} status="Failed" />);
    expect(screen.getByText('3 attempts')).toBeInTheDocument();
  });
});

describe('CancelRunButton', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    toast.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is not offered for a run that has ended', () => {
    const { container } = render(<CancelRunButton executionId="e1" status="completed" onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a run that is stopping as stopping, and offers nothing more', () => {
    render(<CancelRunButton executionId="e1" status="cancelling" onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Stopping/ })).toBeDisabled();
  });

  it('asks first, then cancels, and says a running run finishes its step', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'cancelling' }) });
    const onChanged = vi.fn();
    render(<CancelRunButton executionId="e1" status="running" onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Cancel this run?')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel run' }).at(-1)!);

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/test-plan-executions/e1/cancel', { method: 'POST' });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stopping the run' }));
  });

  it('says why when the server refuses', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'The run has already ended (completed).' }) });
    const onChanged = vi.fn();
    render(<CancelRunButton executionId="e1" status="queued" onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel run' }).at(-1)!);

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'The run has already ended (completed).' })));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
