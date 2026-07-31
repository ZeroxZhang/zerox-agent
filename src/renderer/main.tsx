import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RendererErrorBoundary } from "./components/RendererErrorBoundary";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </React.StrictMode>,
);
