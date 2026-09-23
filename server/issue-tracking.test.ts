import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  dedupeKeyFor,
  failuresOf,
  issueBody,
  issueTitle,
  recurrenceComment,
  resolvedComment,
} from './issue-tracking';

/**
 * What gets filed, and what counts as the same failure.
 *
 * The second one is the whole feature. A nightly plan that fails for a week must produce one
 * issue with seven comments, not seven issues — by the third morning nobody reads any of them,
 * and the board stops being a record of anything.
 */

const failure = {
  planId: 'plan-1',
  planName: 'Nightly',
  executionId: 'exec-9',
  testName: 'Checkout',
  browser: 'chromium',
  status: 'Failed',
  reason: 'Timed out waiting for #pay',
  startedAt: new Date('2026-09-21T02:00:00.000Z'),
};

beforeEach(() => {
  delete process.env.WEBFLOW_PUBLIC_URL;
});

afterEach(() => {
  delete process.env.WEBFLOW_PUBLIC_URL;
});

describe('dedupeKeyFor', () => {
  it('is the same failure on the next night', () => {
    expect(dedupeKeyFor({ planId: 'plan-1', testName: 'Checkout', browser: 'chromium' })).toBe(
      dedupeKeyFor({ planId: 'plan-1', testName: 'Checkout', browser: 'chromium' }),
    );
  });

  it('tells one browser from another', () => {
    // A test that fails only on WebKit is a different problem from one that fails everywhere,
    // and filing them together loses the fact that distinguishes them.
    expect(dedupeKeyFor({ planId: 'p', testName: 'Checkout', browser: 'webkit' })).not.toBe(
      dedupeKeyFor({ planId: 'p', testName: 'Checkout', browser: 'chromium' }),
    );
  });

  it('tells one plan from another', () => {
    expect(dedupeKeyFor({ planId: 'smoke', testName: 'Checkout' })).not.toBe(
      dedupeKeyFor({ planId: 'nightly', testName: 'Checkout' }),
    );
  });

  it('files every ad-hoc run of a test under one key', () => {
    // Otherwise each manual re-run opens a fresh issue, which is the duplicate storm this
    // exists to prevent.
    expect(dedupeKeyFor({ testName: 'Checkout' })).toBe(dedupeKeyFor({ planId: null, testName: 'Checkout' }));
  });
});

describe('failuresOf', () => {
  it('counts a test that failed and one that never ran', () => {
    const rows = [
      { status: 'Passed' },
      { status: 'Failed' },
      { status: 'Error' },
      { status: 'Skipped' },
    ];

    expect(failuresOf(rows)).toEqual([{ status: 'Failed' }, { status: 'Error' }]);
  });
});

describe('issueTitle', () => {
  it('says what failed, where, and in which plan', () => {
    expect(issueTitle(failure)).toBe('Checkout fails on chromium — Nightly');
  });

  it('distinguishes a test that could not run from one that failed', () => {
    expect(issueTitle({ ...failure, status: 'Error' })).toContain('could not run');
  });

  it('stays a title', () => {
    const long = issueTitle({ ...failure, testName: 'x'.repeat(500) });

    expect(long.length).toBeLessThanOrEqual(200);
  });
});

describe('issueBody', () => {
  it('gives somebody who was not watching enough to decide', () => {
    const body = issueBody(failure);

    expect(body).toContain('"Checkout"');
    expect(body).toContain('Nightly');
    expect(body).toContain('chromium');
    expect(body).toContain('Timed out waiting for #pay');
  });

  it('links to the report rather than copying the evidence into the issue', () => {
    process.env.WEBFLOW_PUBLIC_URL = 'https://qa.example.com';

    expect(issueBody(failure)).toContain(
      'https://qa.example.com/test-plans/plan-1/executions/exec-9/report',
    );
  });

  it('names the run when this installation does not know its own address', () => {
    const body = issueBody(failure);

    expect(body).toContain('exec-9');
    expect(body).not.toContain('undefined');
  });

  it('truncates a reason that is a whole stack trace', () => {
    const body = issueBody({ ...failure, reason: 'x'.repeat(5000) });

    expect(body).toContain('(truncated)');
    expect(body.length).toBeLessThan(3000);
  });

  it('says what will happen the next time it fails', () => {
    // Because the reader's first question on seeing an automated issue is whether they are
    // about to get one of these every morning.
    expect(issueBody(failure)).toContain('added');
  });
});

describe('recurrenceComment', () => {
  it('counts, which is the argument seven separate issues cannot make', () => {
    expect(recurrenceComment(failure, 7)).toContain('occurrence 7');
  });
});

describe('resolvedComment', () => {
  it('reports the green run and says why it is not closing anything', () => {
    const comment = resolvedComment(failure);

    expect(comment).toContain('passed again');
    expect(comment).toContain('Left open on purpose');
  });
});
