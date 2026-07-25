import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@zk-wallet/ui/styles.css";

const rootElement = document.querySelector<HTMLDivElement>("#root");

if (rootElement === null) {
  throw new Error("Application root is unavailable");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
