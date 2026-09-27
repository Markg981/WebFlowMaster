import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import './i18n'; // <-- Add this line
import { watchForEndedSession } from "./lib/session-expiry";

watchForEndedSession();

createRoot(document.getElementById("root")!).render(<App />);
