import { useEffect, useState } from 'react';

/** `initialSearch` seeds the box, for a page opened from a link that names a test. */
export function useCatalogControls(initialSearch = '') {
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch.trim());
  const [page, setPage] = useState(1);
  const [pageSize, setSize] = useState(25);
  useEffect(() => {
    if (search.trim() === debouncedSearch) return;
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);
  return {
    search,
    setSearch,
    debouncedSearch,
    page,
    setPage,
    pageSize,
    setPageSize: (size: number) => {
      setSize(size);
      setPage(1);
    },
  };
}
