import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import './i18n';
import { watchForEndedSession } from "./lib/session-expiry";

watchForEndedSession();

// Every component that translates waits here while a language other than English is fetched
// (client/src/i18n.ts): on the first visit in that language, and when it is changed in Settings.
createRoot(document.getElementById("root")!).render(
  <Suspense fallback={null}>
    <App />
  </Suspense>,
);
