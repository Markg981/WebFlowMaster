import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReproducibilityCard from './ReproducibilityCard';
import type { ReproducibilitySummary } from '@shared/execution-provenance';

const auth = vi.hoisted(() => ({ role: 'editor' }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { role: auth.role } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('wouter', () => ({ Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
const summary: ReproducibilitySummary = {
  available: true,
  provenance: { version: 1, capturedAt: '2026-10-06T20:00:00Z', inputFingerprint: 'a'.repeat(64), datasetsFingerprint: 'b'.repeat(64),
    definitions: [{ type: 'ui', id: 7, name: 'Queued checkout', version: 3, source: 'published', fingerprint: 'c'.repeat(64) }], datasets: [], liveDependencies: [] },
};
beforeEach(() => { auth.role = 'editor'; vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'replay-1', testPlanId: 'plan-1' }) }))); });
const show = (value?: ReproducibilitySummary) => render(<ReproducibilityCard executionId="run-1" planId="plan-1" summary={value} />);
describe('historical replay', () => {
  it('shows captured versions and requires explicit confirmation before queuing historical inputs', async () => {
    show(summary);
    expect(screen.getByText(/Queued checkout/)).toHaveTextContent('v3');
    fireEvent.click(screen.getByRole('button', { name: 'Replay historical configuration' }));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Queue historical replay' }));
    const link = await screen.findByRole('link', { name: 'Open queued replay' });
    expect(link).toHaveAttribute('href', '/test-plans/plan-1/executions/replay-1/report');
    expect(fetch).toHaveBeenCalledWith('/api/test-plan-executions/run-1/replay', expect.objectContaining({ method: 'POST', body: '{"mode":"historical"}', headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }) }));
  });
  it('shows a server refusal and preserves the idempotency key when retrying', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Monthly limit' }) } as Response);
    show(summary);
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Replay historical configuration' }));
      fireEvent.click(screen.getByRole('button', { name: 'Queue historical replay' }));
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(i + 1));
      await screen.findByRole('alert');
    }
    expect(screen.getByRole('alert')).toHaveTextContent('Monthly limit');
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual(vi.mocked(fetch).mock.calls[1][1]?.headers);
  });
  it('does not offer replay to a viewer or for an incomplete historical run', () => {
    auth.role = 'viewer';
    const rendered = show(summary);
    expect(screen.queryByRole('button')).toBeNull();
    rendered.unmount(); auth.role = 'editor'; show();
    expect(screen.getByText(/Historical replay is unavailable/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
