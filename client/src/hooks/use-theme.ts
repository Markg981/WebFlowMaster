import { useCallback, useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import type { UserSettings } from '@/lib/settings';

export type Theme = 'light' | 'dark';

/**
 * The one owner of the light/dark choice.
 *
 * Three places used to write the `dark` class onto <html>: the boot effect in App.tsx, the
 * topbar toggle in AppShell.tsx, and an effect on a `darkMode` state in settings-page.tsx.
 * The same server value was cached twice, under `["settings"]` and
 * `["userSettingsApp", userId]`, and the query client sets `staleTime: Infinity`, so neither
 * copy is ever refetched.
 *
 * The toggle wrote to the DOM and POSTed, and told neither cache. So turning on dark mode
 * and then opening Settings applied a cached "light" that nothing would ever refresh — and
 * because that page writes its value to <html>, the whole application went back to light and
 * stayed there. The user's own choice, undone by a screen they opened to look at it.
 *
 * Two rules fix the class of bug, not just the instance:
 *
 * 1. The DOM is the truth for what is on screen right now, so the initial state is read from
 *    it rather than guessed. Guessing "light" is what made the reversion visible even when
 *    the caches agreed.
 * 2. A write goes through every cached copy of the settings. Anything that reads one later
 *    then reads the new value, not the one from before the choice was made.
 */

const SETTINGS_QUERY_ROOTS = ['settings', 'userSettingsApp'];

/** Both query keys that hold a copy of the user's settings. */
function isSettingsKey(key: QueryKey): boolean {
  return typeof key[0] === 'string' && SETTINGS_QUERY_ROOTS.includes(key[0]);
}

export function readThemeFromDocument(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function applyThemeToDocument(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function useTheme() {
  const queryClient = useQueryClient();
  const [theme, setThemeState] = useState<Theme>(readThemeFromDocument);

  // Anything else that changes the class — the boot effect, a second tab's rehydration —
  // is followed rather than fought.
  useEffect(() => {
    const el = document.documentElement;
    // Bail out when nothing changed: the class attribute also carries whatever else is on
    // <html>, so this fires for edits that have nothing to do with the theme, and setTheme
    // has already set the state for the ones it made itself.
    const sync = () => setThemeState((prev) => {
      const next = readThemeFromDocument();
      return prev === next ? prev : next;
    });
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    sync();
    return () => observer.disconnect();
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      applyThemeToDocument(next);
      setThemeState(next);

      // Before the network call, so a later reader cannot win a race against it.
      queryClient.setQueriesData<UserSettings>(
        { predicate: (query) => isSettingsKey(query.queryKey) },
        (old) => (old && typeof old === 'object' ? { ...old, theme: next } : old),
      );

      // Best effort: the choice has already taken effect on screen either way.
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: next }),
        credentials: 'include',
      }).catch(() => {});
    },
    [queryClient],
  );

  const toggle = useCallback(
    () => setTheme(readThemeFromDocument() === 'dark' ? 'light' : 'dark'),
    [setTheme],
  );

  return { theme, isDark: theme === 'dark', setTheme, toggle };
}
