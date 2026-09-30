import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FailureAnalysisDialog from './FailureAnalysisDialog';
import type { FailureAnalysis } from '@shared/failure-analysis';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'it-IT' },
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.replace(`{{${name}}}`, String(value));
      return text;
    },
  }),
}));

/**
 * The AI's reading of a failed result: asked for when there is none, shown as kept when there is,
 * asked again only on a deliberate click.
 */

const analysis: FailureAnalysis = {
  category: 'locator',
  confidence: 'high',
  summary: 'The Sign in button is no longer found by its class.',
  explanation: 'Step 3 timed out.',
  suggestion: 'Use its role and name.',
  failedStep: 3,
  proposedSelector: "role=button[name='Sign in']",
  sawScreenshot: true,
  language: 'it',
  model: 'gemini-test',
  byUsername: 'editor.a',
  at: '2026-09-30T10:00:00.000Z',
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ analysis, cached: false }) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('FailureAnalysisDialog', () => {
  it('asks for an analysis in the interface language when the result has none, and shows it', async () => {
    const onAnalysed = vi.fn();
    render(
      <FailureAnalysisDialog executionId="run-1" result={{ id: 'r-1', testName: 'Login', browser: 'chromium' }} onOpenChange={vi.fn()} onAnalysed={onAnalysed} />,
    );

    expect(await screen.findByText(analysis.summary)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/test-plan-executions/run-1/results/r-1/ai-analysis');
    expect(JSON.parse(init.body)).toEqual({ language: 'it', refresh: false });
    expect(screen.getByText('Step 3')).toBeTruthy();
    expect(screen.getByText("role=button[name='Sign in']")).toBeTruthy();
    expect(onAnalysed).toHaveBeenCalled();
  });

  it('shows a kept analysis without asking, and asks again only when told', async () => {
    render(
      <FailureAnalysisDialog executionId="run-1" result={{ id: 'r-1', testName: 'Login', browser: null, aiAnalysis: analysis }} onOpenChange={vi.fn()} onAnalysed={vi.fn()} />,
    );

    expect(screen.getByText(analysis.summary)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Analyse again'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ refresh: true });
  });

  it("shows the server's reason when there is no analysis to be had", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'AI analysis is not configured on this server (GEMINI_API_KEY).' }) });
    render(
      <FailureAnalysisDialog executionId="run-1" result={{ id: 'r-2', testName: 'Checkout', browser: null }} onOpenChange={vi.fn()} onAnalysed={vi.fn()} />,
    );

    expect((await screen.findByRole('alert')).textContent).toContain('GEMINI_API_KEY');
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
