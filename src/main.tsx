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
const ANDROID_ASSETS_HOST = "appassets.androidplatform.net";
const THEME_STORAGE_KEY = "theme";

const isAndroidWebViewHost = () =>
  typeof window !== "undefined" && window.location.hostname === ANDROID_ASSETS_HOST;

const applyStoredTheme = () => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  const useDark = storedTheme === "dark";
  document.documentElement.classList.toggle("dark", useDark);
  document.body.classList.toggle("dark", useDark);
};

const clearServiceWorkersAndCaches = async () => {
  if (typeof window === "undefined") return;

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
  }
};

const forcePwaResetOnce = async () => {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(PWA_RESET_STORAGE_KEY) === "done") return;

  try {
    await clearServiceWorkersAndCaches();
  } finally {
    window.localStorage.setItem(PWA_RESET_STORAGE_KEY, "done");
  }
};

if (isAndroidWebViewHost()) {
  void clearServiceWorkersAndCaches();
} else {
  void forcePwaResetOnce();
}

if (!isAndroidWebViewHost()) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      void updateSW(true);
    },
  });

  initPwaInstall();
}

if (typeof window !== "undefined") {
  applyStoredTheme();
  window.addEventListener("storage", (event) => {
    if (event.key === THEME_STORAGE_KEY) applyStoredTheme();
  });
  window.addEventListener("odontoart-theme-changed", applyStoredTheme as EventListener);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
