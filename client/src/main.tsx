import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import './i18n'; // <-- Add this line

createRoot(document.getElementById("root")!).render(<App />);
