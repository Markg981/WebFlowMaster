import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PublishingPanel, { type PublishingState } from './PublishingPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''))
        : _key,
  }),
}));

/**
 * What plans run of a test, in a sentence, and the one action that fits: publish where no review
 * is required, ask for one where it is, withdraw a request of one's own.
 */

const fetchMock = vi.fn();

const base: PublishingState = {
  testId: 9,
  publishedVersion: 3,
  latestVersion: 5,
  runs: 'published',
  hasUnpublishedChanges: true,
  reviewRequired: false,
  pendingReview: null,
  rollbackTargets: [],
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('PublishingPanel', () => {
  it('says which version plans run, and publishes the latest', async () => {
    const onChanged = vi.fn();
    render(<PublishingPanel state={base} currentUserId={1} canEdit onChanged={onChanged} />);

    expect(screen.getByText('Plans run version 3.')).toBeInTheDocument();
    expect(screen.getByText('Version 5 has changes that are not published yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Publish version 5/ }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tests/9/publish');
  });

  it('asks for a review where one is required, with a note', async () => {
    render(<PublishingPanel state={{ ...base, reviewRequired: true }} currentUserId={1} canEdit onChanged={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Publish version/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Note for the reviewer'), { target: { value: 'New payment step' } });
    fireEvent.click(screen.getByRole('button', { name: /Ask for review of version 5/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tests/9/reviews');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ note: 'New payment step' });
  });

  it('shows a pending review, withdrawable only by whoever asked', () => {
    const pending = { ...base, reviewRequired: true, pendingReview: { id: 4, version: 5, requestedBy: 1, note: null } };
    const { rerender } = render(<PublishingPanel state={pending} currentUserId={1} canEdit onChanged={vi.fn()} />);
    expect(screen.getByText('Version 5 is waiting for review.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();

    rerender(<PublishingPanel state={pending} currentUserId={2} canEdit onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('says a plan skips a never-published test under the policy, and offers a viewer nothing', () => {
    render(
      <PublishingPanel
        state={{ ...base, publishedVersion: null, runs: 'nothing', reviewRequired: true }}
        currentUserId={1}
        canEdit={false}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/plans skip this test/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
