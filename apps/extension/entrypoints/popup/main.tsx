import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@zk-wallet/ui/styles.css";
import "./popup.css";

const rootElement = document.querySelector<HTMLDivElement>("#root");

if (rootElement === null) {
  throw new Error("Extension popup root is unavailable");
}

const mode = new URLSearchParams(window.location.search).get("mode");
if (mode?.endsWith("-autofill") === true) {
  document.documentElement.classList.add("autofill-document");
  document.body.classList.add("autofill-surface");
} else if (mode === "manager") {
  document.documentElement.classList.add("manager-document");
  document.body.classList.add("manager-surface");
} else {
  document.documentElement.classList.add("toolbar-document");
  document.body.classList.add("toolbar-surface");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
