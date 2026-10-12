import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWhatsNew } from '@/lib/api/whats-new';

/**
 * The "What's new" page and the dot that announces it. What a member has seen is kept in this
 * browser: it is a convenience, and losing it only shows the dot once more.
 */
export const WHATS_NEW_SEEN_KEY = 'wfm.whatsNew.seen';

function readSeen(): string | null {
  try {
    return localStorage.getItem(WHATS_NEW_SEEN_KEY);
  } catch {
    return null;
  }
}

export function useWhatsNew() {
  const query = useQuery({
    queryKey: ['whatsNew'],
    queryFn: fetchWhatsNew,
    // The changelog changes with a deployment, not while a page is open.
    staleTime: 60 * 60 * 1000,
  });
  const [seen, setSeen] = useState<string | null>(readSeen);

  // Another tab that opened the page clears the dot here too.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === WHATS_NEW_SEEN_KEY) setSeen(event.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const stamp = query.data?.stamp ?? null;
  const markSeen = useCallback(() => {
    if (!stamp) return;
    try {
      localStorage.setItem(WHATS_NEW_SEEN_KEY, stamp);
    } catch {
      // Private mode or storage switched off: the dot just comes back next time.
    }
    setSeen(stamp);
  }, [stamp]);

  return { ...query, hasNews: !!stamp && stamp !== seen, markSeen };
}
