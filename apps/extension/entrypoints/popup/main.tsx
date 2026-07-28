import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@zk-wallet/ui/styles.css";
import "./popup.css";

const rootElement = document.querySelector<HTMLDivElement>("#root");

if (rootElement === null) {
  throw new Error("Extension popup root is unavailable");
}

if (new URLSearchParams(window.location.search).get("mode")?.endsWith("-autofill") === true) {
  document.documentElement.classList.add("autofill-document");
  document.body.classList.add("autofill-surface");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
