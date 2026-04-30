import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { initPwaInstall } from "./lib/pwaInstall";

const PWA_RESET_VERSION = "2026-04-30-codigo-lookup-draft-restore-hotfix-1";
const PWA_RESET_STORAGE_KEY = `odontoart-pwa-reset:${PWA_RESET_VERSION}`;

const forcePwaResetOnce = async () => {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(PWA_RESET_STORAGE_KEY) === "done") return;

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn("Falha ao limpar cache/PWA legado:", error);
  } finally {
    window.localStorage.setItem(PWA_RESET_STORAGE_KEY, "done");
  }
};

void forcePwaResetOnce();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateSW(true);
  },
});

initPwaInstall();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
