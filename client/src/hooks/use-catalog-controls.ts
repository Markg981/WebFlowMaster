import { useEffect, useState } from 'react';

export function useCatalogControls() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setSize] = useState(25);
  useEffect(() => {
    if (search.trim() === debouncedSearch) return;
    const timer = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);
  return { search, setSearch, debouncedSearch, page, setPage, pageSize,
    setPageSize: (size: number) => { setSize(size); setPage(1); } };
}
