import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { registrarServiceWorker } from "./lib/instalable";

// El service worker solo existe para que la aplicación se pueda instalar en el
// teléfono; no cachea nada (ver public/sw.js).
registrarServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
