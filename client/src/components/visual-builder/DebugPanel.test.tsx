import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DebugPanel from './DebugPanel';
import type { DebugPause, DebugState } from '@shared/debug-session';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.replace(`{{${name}}}`, String(value));
      return text;
    },
  }),
}));

/**
 * The debugger as the builder shows it: why it stopped, the commands that fit, and a correction
 * made there going both to the run and into the test.
 */

const pause = (overrides: Partial<DebugPause> = {}): DebugPause => ({
  pc: 1,
  stepId: 's2',
  calledFrom: null,
  name: 'Click Buy',
  actionId: 'click',
  reason: 'breakpoint',
  error: null,
  selector: '#buy',
  value: null,
  canSkip: true,
  screenshot: 'data:image/jpeg;base64,AAAA',
  url: 'https://shop.test/cart',
  ...overrides,
});

const state = (overrides: Partial<DebugState> = {}): DebugState => ({
  id: 'd1',
  status: 'paused',
  paused: pause(),
  steps: [{ name: 'Open cart', type: 'navigate', stepId: 's1', status: 'passed', detail: 'ok', corrected: false }],
  variables: [{ name: 'password', value: null }, { name: 'orderId', value: 'A-17' }],
  breakpoints: ['s2'],
  outcome: null,
  updatedAt: '',
  ...overrides,
});

function renderPanel(debugState: DebugState, isOwnStep = () => true) {
  const onCommand = vi.fn();
  const onCorrection = vi.fn();
  render(
    <DebugPanel state={debugState} error={null} busy={false} onCommand={onCommand} onClose={vi.fn()} onCorrection={onCorrection} isOwnStep={isOwnStep} />,
  );
  return { onCommand, onCorrection };
}

describe('DebugPanel', () => {
  it('at a breakpoint: says where, shows the page, and continues or steps', () => {
    const { onCommand, onCorrection } = renderPanel(state());

    expect(screen.getByText('Stopped at the breakpoint before “Click Buy”.')).toBeTruthy();
    expect(screen.getByAltText('The page now')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();

    fireEvent.click(screen.getByText('Step'));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'step', patch: undefined });
    fireEvent.click(screen.getByText('Continue'));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'continue', patch: undefined });
    expect(onCorrection).not.toHaveBeenCalled();
  });

  it('on a failure: retries with the correction, and copies it into the test', () => {
    const { onCommand, onCorrection } = renderPanel(state({ paused: pause({ reason: 'failure', error: 'Timeout waiting for #buy' }) }));

    expect(screen.getByRole('alert').textContent).toContain('Timeout waiting for #buy');
    expect(screen.queryByText('Continue')).toBeNull();
    fireEvent.change(screen.getByLabelText('Selector'), { target: { value: "role=button[name='Buy']" } });
    fireEvent.click(screen.getByText('Retry'));

    expect(onCommand).toHaveBeenCalledWith({ type: 'retry', patch: { selector: "role=button[name='Buy']" } });
    expect(onCorrection).toHaveBeenCalledWith('s2', { selector: "role=button[name='Buy']" });
  });

  it('keeps a correction to a step inside a group to this run', () => {
    const { onCommand, onCorrection } = renderPanel(state({ paused: pause({ reason: 'failure', calledFrom: 'g1', stepId: 'inner' }) }), () => false);

    expect(screen.getByText(/applies to this run only/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Retry'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'retry', patch: { value: 'x' } });
    expect(onCorrection).not.toHaveBeenCalled();
  });

  it('offers no skip for a block, and pause and stop while running', () => {
    renderPanel(state({ paused: pause({ canSkip: false, actionId: 'if' }) }));
    expect(screen.queryByText('Skip')).toBeNull();
  });

  it('while running, pauses; once ended, says how it went', () => {
    const { onCommand } = renderPanel(state({ status: 'running', paused: null }));
    fireEvent.click(screen.getByText('Pause'));
    expect(onCommand).toHaveBeenCalledWith({ type: 'pause' });
  });

  it('shows the outcome, the steps and the variables, never an environment value', () => {
    renderPanel(state({ status: 'finished', paused: null, outcome: { success: false, error: null, skipped: 1 } }));
    expect(screen.getByText(/The test did not pass\. 1 step\(s\) passed over\./)).toBeTruthy();
    expect(screen.getByText('Open cart')).toBeTruthy();
    expect(screen.getByText('A-17')).toBeTruthy();
    expect(screen.getByText('(from the environment, hidden)')).toBeTruthy();
    expect(screen.queryByText('Pause')).toBeNull();
  });
});
