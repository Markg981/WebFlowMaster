import { useEffect, useState } from 'react';

/**
 * Whether the app is in dark mode, tracked from the `dark` class on <html>.
 * The app drives theming via that class (SettingsEffectLoader + the topbar toggle),
 * not via a next-themes provider — so components that need the theme (e.g. Monaco
 * editors) must read it from here, reactively.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
