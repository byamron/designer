import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

import "@mini/tokens.css";
import "@mini/axioms.css";
import "@mini/primitives.css";
import "@mini/archetypes.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
