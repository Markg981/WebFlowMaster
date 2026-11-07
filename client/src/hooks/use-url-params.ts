import { useCallback, useMemo } from 'react';
import { useLocation, useSearch } from 'wouter';

type Patch = Record<string, string | null | undefined>;

/**
 * Reads and writes the query string of the current page, so that state worth sharing
 * (page, filters, search) survives reload, back and a pasted link. A key set to its default
 * (or to null/'') is removed: defaults never appear in the URL.
 */
export function useUrlParams() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const update = useCallback(
    (patch: Patch, options: { replace?: boolean } = {}) => {
      // window.location is read live so two updates in one handler compose.
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      if (query === window.location.search.replace(/^\?/, '')) return;
      navigate(query ? `${location}?${query}` : location, { replace: options.replace });
    },
    [location, navigate],
  );
  return { params, update };
}

/** Integer URL param >= 1 with a default; anything unparsable falls back to the default. */
export function intParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}
