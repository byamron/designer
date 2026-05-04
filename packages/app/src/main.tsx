import React from "react";
import { createRoot } from "react-dom/client";
import "@designer/ui/styles/tokens.css";
import "@designer/ui/styles/axioms.css";
import "@designer/ui/styles/primitives.css";
import "@designer/ui/styles/archetypes.css";
import "@designer/ui/styles/team-pulse.css";
import "./styles/app.css";
import { App } from "./App";
import { initThemeBootstrap } from "./theme";

initThemeBootstrap();

const container = document.getElementById("app");
if (!container) throw new Error("#app not found");
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
