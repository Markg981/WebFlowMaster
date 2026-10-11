import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { LegacyTestPlansRedirect } from './App';

/** The test plans page moved from /test-suites to /test-plans; old links must still land. */
describe('the /test-suites redirect', () => {
  it('goes to /test-plans and keeps the query', async () => {
    const location = memoryLocation({
      path: '/test-suites?planId=p1&tab=schedules',
      record: true,
    });
    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <LegacyTestPlansRedirect />
      </Router>,
    );
    await waitFor(() =>
      expect(location.history.at(-1)).toBe('/test-plans?planId=p1&tab=schedules'),
    );
  });

  it('goes to /test-plans when there is no query', async () => {
    const location = memoryLocation({ path: '/test-suites', record: true });
    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <LegacyTestPlansRedirect />
      </Router>,
    );
    await waitFor(() => expect(location.history.at(-1)).toBe('/test-plans'));
  });
});
