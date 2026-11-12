import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReviewDialog from './ReviewDialog';
import type { ComparisonResultDetail } from '@/lib/api/comparisons';

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

/**
 * Reviewing one test of a comparison: accepting needs a reason, and only blocking differences no
 * known difference covers yet can be saved as known for later comparisons.
 */

const fetchMock = vi.fn();

const result = {
  id: 'res-1',
  uiTestId: 7,
  testName: 'Checkout',
  reviewStatus: 'open',
  reviewNote: null,
  reviewedAt: null,
  differences: [
    {
      stepId: 's1',
      stepIndex: 0,
      checkpoint: 'total',
      kind: 'text',
      path: 'texts[0]',
      baseline: 'a',
      candidate: 'b',
      severity: 'blocking',
    },
    {
      stepId: 's1',
      stepIndex: 0,
      checkpoint: 'total',
      kind: 'text',
      path: 'texts[1]',
      baseline: 'a',
      candidate: 'b',
      severity: 'informative',
    },
    {
      stepId: 's2',
      stepIndex: 1,
      checkpoint: 'grid',
      kind: 'table',
      path: 'rows[0][0]',
      baseline: 1,
      candidate: 2,
      severity: 'blocking',
      knownDifferenceId: 'kd-1',
    },
    {
      stepId: 's2',
      stepIndex: 1,
      checkpoint: 'grid',
      kind: 'table',
      path: 'rows[2][1]',
      baseline: 1,
      candidate: 2,
      severity: 'blocking',
    },
  ],
} as unknown as ComparisonResultDetail;

const renderDialog = () => {
  const onReviewed = vi.fn();
  const onClose = vi.fn();
  render(
    <ReviewDialog comparisonId="cmp-1" result={result} onClose={onClose} onReviewed={onReviewed} />,
  );
  return { onReviewed, onClose };
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result, knownDifferences: [] }) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ReviewDialog', () => {
  it('needs a reason before a difference can be accepted', () => {
    renderDialog();
    const save = screen.getByRole('button', { name: 'Save review' });
    expect(save).toBeDisabled();
    expect(screen.getByText('Accepting a difference needs a reason.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Why it is expected'), {
      target: { value: 'new rounding' },
    });
    expect(save).toBeEnabled();
  });

  it('offers only the uncovered blocking differences and sends the chosen ones', async () => {
    const { onReviewed, onClose } = renderDialog();
    fireEvent.change(screen.getByLabelText('Why it is expected'), {
      target: { value: 'new rounding' },
    });
    fireEvent.click(screen.getByLabelText('Expect these differences in later comparisons'));
    const offered = screen.getByTestId('review-differences').querySelectorAll('li');
    expect(offered).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));

    await waitFor(() => expect(onReviewed).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/comparisons/cmp-1/results/res-1/review');
    expect(JSON.parse(init.body)).toEqual({
      status: 'accepted',
      note: 'new rounding',
      saveAsKnownDifference: { scope: 'test', differences: [0, 3] },
    });
  });

  it('sends a defect without a note and without known differences', async () => {
    const { onReviewed } = renderDialog();
    fireEvent.click(screen.getByLabelText('Defect: the candidate is wrong'));
    expect(screen.queryByLabelText('Expect these differences in later comparisons')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));

    await waitFor(() => expect(onReviewed).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: 'defect' });
  });
});
