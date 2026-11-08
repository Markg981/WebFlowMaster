import { useCallback, useEffect, useState } from 'react';
import { intParam, useUrlParams } from './use-url-params';

const DEFAULT_PAGE_SIZE = 25;

/**
 * Search box, page and page size of a catalog. `initialSearch` seeds the box, for a page
 * opened from a link that names a test. With `urlState` the three values live in the query
 * string (`search`, `page`, `pageSize`; defaults omitted) instead of in memory.
 */
export function useCatalogControls(initialSearch = '', urlState = false) {
  const { params, update } = useUrlParams();
  const urlSearch = (params.get('search') ?? '').trim();
  const urlPage = intParam(params.get('page'), 1);
  const urlSize = intParam(params.get('pageSize'), DEFAULT_PAGE_SIZE);

  const [search, setSearch] = useState(initialSearch);
  const [localDebounced, setLocalDebounced] = useState(initialSearch.trim());
  const [localPage, setLocalPage] = useState(1);
  const [localSize, setLocalSize] = useState(DEFAULT_PAGE_SIZE);

  const debouncedSearch = urlState ? urlSearch : localDebounced;
  const page = urlState ? urlPage : localPage;
  const pageSize = urlState ? urlSize : localSize;

  // Back/forward or a pasted link changes the URL: the box follows it.
  useEffect(() => {
    if (urlState) setSearch((current) => (current.trim() === urlSearch ? current : urlSearch));
  }, [urlState, urlSearch]);

  useEffect(() => {
    if (search.trim() === debouncedSearch) return;
    const timer = setTimeout(() => {
      if (urlState) update({ search: search.trim(), page: null });
      else {
        setLocalDebounced(search.trim());
        setLocalPage(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch, urlState, update]);

  const setPage = useCallback(
    (value: number | ((current: number) => number)) => {
      if (!urlState) return setLocalPage(value);
      const next = typeof value === 'function' ? value(urlPage) : value;
      // A functional update is a clamp done by an effect: it must not add a history entry.
      update({ page: next > 1 ? String(next) : null }, { replace: typeof value === 'function' });
    },
    [urlState, urlPage, update],
  );

  const setPageSize = (size: number) => {
    if (!urlState) {
      setLocalSize(size);
      setLocalPage(1);
    } else {
      update({ pageSize: size === DEFAULT_PAGE_SIZE ? null : String(size), page: null });
    }
  };

  return { search, setSearch, debouncedSearch, page, setPage, pageSize, setPageSize };
}
