import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import IssueCell from './IssueCell';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

/**
 * What this failure already is, on somebody's board.
 *
 * The one thing this must never do is offer to file a failure that is already filed. That
 * offer is how a nightly failure becomes seven issues nobody reads.
 */

const link = {
  dedupeKey: 'plan-1::Checkout::chromium',
  testName: 'Checkout',
  browser: 'chromium',
  issueKey: 'SHOP-412',
  issueUrl: 'https://acme.atlassian.net/browse/SHOP-412',
  occurrences: 3,
  resolvedAt: null,
};

describe('IssueCell', () => {
  it('links to the issue and says how often it has happened', () => {
    render(<IssueCell link={link} onFile={vi.fn()} />);

    const anchor = screen.getByRole('link');
    expect(anchor).toHaveAttribute('href', link.issueUrl);
    expect(screen.getByText('SHOP-412')).toBeInTheDocument();
    expect(screen.getByText('×3')).toBeInTheDocument();
  });

  it('does not offer to file what is already filed', () => {
    render(<IssueCell link={link} onFile={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /File/ })).not.toBeInTheDocument();
  });

  it('leaves out the count for a failure that has happened once', () => {
    render(<IssueCell link={{ ...link, occurrences: 1 }} onFile={vi.fn()} />);

    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it('files the failure when asked', async () => {
    const onFile = vi.fn().mockResolvedValue(undefined);
    render(<IssueCell onFile={onFile} />);

    fireEvent.click(screen.getByRole('button', { name: /File/ }));

    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
  });

  it('repeats what the tracker said rather than failing silently', async () => {
    const onFile = vi.fn().mockRejectedValue(new Error('403: no permission to create issues in SHOP'));
    render(<IssueCell onFile={onFile} />);

    fireEvent.click(screen.getByRole('button', { name: /File/ }));

    expect(await screen.findByText(/no permission to create issues in SHOP/)).toBeInTheDocument();
  });
});
