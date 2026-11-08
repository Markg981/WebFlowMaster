// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalogControls } from './use-catalog-controls';
import { useUrlParams } from './use-url-params';

const Harness = () => {
  const c = useCatalogControls('', true);
  const { params, update } = useUrlParams();
  return (
    <div>
      <input aria-label="search" value={c.search} onChange={(e) => c.setSearch(e.target.value)} />
      <span data-testid="state">{`${c.debouncedSearch}|${c.page}|${c.pageSize}|${params.get('status') ?? ''}`}</span>
      <button onClick={() => c.setPage(3)}>page3</button>
      <button onClick={() => c.setPageSize(50)}>size50</button>
      <button onClick={() => c.setPageSize(25)}>size25</button>
      <button onClick={() => update({ status: 'all', page: null })}>status</button>
    </div>
  );
};

const state = () => screen.getByTestId('state').textContent;

describe('catalog state in the URL', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/catalog');
  });
  afterEach(() => vi.useRealTimers());

  it('reads the initial state from the URL', () => {
    window.history.replaceState(null, '', '/catalog?search=abc&page=4&pageSize=50&status=all');
    render(<Harness />);
    expect(state()).toBe('abc|4|50|all');
    expect((screen.getByLabelText('search') as HTMLInputElement).value).toBe('abc');
  });

  it('uses defaults and keeps them out of the URL', () => {
    render(<Harness />);
    expect(state()).toBe('|1|25|');
    fireEvent.click(screen.getByText('page3'));
    expect(window.location.search).toBe('?page=3');
    fireEvent.click(screen.getByText('size50'));
    expect(window.location.search).toBe('?pageSize=50');
    fireEvent.click(screen.getByText('size25'));
    expect(window.location.search).toBe('');
  });

  it('writes the debounced search to the URL and resets the page', () => {
    window.history.replaceState(null, '', '/catalog?page=3');
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'login' } });
    expect(window.location.search).toBe('?page=3');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(window.location.search).toBe('?search=login');
    expect(state()).toBe('login|1|25|');
  });

  it('restores the previous state on back navigation', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('page3'));
    fireEvent.click(screen.getByText('status'));
    expect(state()).toBe('|1|25|all');
    vi.useRealTimers();
    const popped = new Promise((resolve) =>
      window.addEventListener('popstate', resolve, { once: true }),
    );
    act(() => window.history.back());
    await act(async () => {
      await popped;
    });
    expect(state()).toBe('|3|25|');
  });

  it('follows back navigation in the search box', () => {
    window.history.replaceState(null, '', '/catalog?search=first');
    render(<Harness />);
    act(() => {
      window.history.pushState(null, '', '/catalog?search=second');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect((screen.getByLabelText('search') as HTMLInputElement).value).toBe('second');
  });
});
