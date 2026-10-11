import { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './i18n';
import { watchForEndedSession } from './lib/session-expiry';

watchForEndedSession();

// Every component that translates waits here while a language other than English is fetched
// (client/src/i18n.ts): on the first visit in that language, and when it is changed in Settings.
// What shows meanwhile. A blank page looked like the app had failed to load; this is the same
// background and text colour the shell uses, so the switch to the real page is not a flash.
function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-background text-muted-foreground"
    >
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <Suspense fallback={<Loading />}>
    <App />
  </Suspense>,
);
