export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

type InstallState = {
  canInstall: boolean;
  isStandalone: boolean;
};

type Listener = (state: InstallState) => void;
type PromptWaiter = (canInstall: boolean) => void;

let initialized = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<Listener>();
const promptWaiters = new Set<PromptWaiter>();

function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function getState(): InstallState {
  return {
    canInstall: Boolean(deferredPrompt),
    isStandalone: isStandaloneApp(),
  };
}

function notifyListeners() {
  const state = getState();
  listeners.forEach((listener) => listener(state));
  promptWaiters.forEach((waiter) => waiter(state.canInstall));
  promptWaiters.clear();
}

export function initPwaInstall() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyListeners();
  });
}

export function subscribePwaInstall(listener: Listener) {
  listeners.add(listener);
  listener(getState());
  return () => {
    listeners.delete(listener);
  };
}

export function waitForInstallPrompt(timeoutMs = 1500) {
  if (deferredPrompt) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    const waiter: PromptWaiter = (canInstall) => {
      resolve(canInstall);
    };

    promptWaiters.add(waiter);

    window.setTimeout(() => {
      if (!promptWaiters.has(waiter)) return;
      promptWaiters.delete(waiter);
      resolve(Boolean(deferredPrompt));
    }, timeoutMs);
  });
}

function detectPlatform() {
  if (typeof window === "undefined") return "desktop" as const;
  const ua = window.navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios" as const;
  if (/android/.test(ua)) return "android" as const;
  return "desktop" as const;
}

function detectBrowser() {
  if (typeof window === "undefined") return "other" as const;
  const ua = window.navigator.userAgent.toLowerCase();
  if (/edg\//.test(ua) || /edgios/.test(ua)) return "edge" as const;
  if (/firefox/.test(ua) || /fxios/.test(ua)) return "firefox" as const;
  if (/safari/.test(ua) && !/chrome|crios|edg|opr|opios/.test(ua)) return "safari" as const;
  if (/chrome/.test(ua) || /crios/.test(ua)) return "chrome" as const;
  return "other" as const;
}

export function getInstallGuide() {
  const platform = detectPlatform();
  const browser = detectBrowser();
  const secure =
    typeof window === "undefined"
      ? true
      : window.isSecureContext ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";

  if (!secure) {
    return {
      title: "Instalacao indisponivel nesta URL",
      steps: [
        "Abra o sistema em HTTPS.",
        "No mobile, evite URL HTTP por IP local.",
        "Depois toque em Instalar app novamente.",
      ],
    };
  }

  if (platform === "ios") {
    if (browser !== "safari") {
      return {
        title: "No iPhone use Safari",
        steps: [
          "Abra este site no Safari.",
          "Toque em Compartilhar.",
          "Toque em Adicionar a Tela de Inicio.",
        ],
      };
    }

    return {
      title: "Instalacao manual no iPhone",
      steps: ["Abra no Safari.", "Toque em Compartilhar.", "Toque em Adicionar a Tela de Inicio."],
    };
  }

  if (platform === "android") {
    if (browser !== "chrome" && browser !== "edge") {
      return {
        title: "Use Chrome ou Edge no Android",
        steps: [
          "Abra o sistema no Chrome ou no Edge.",
          "Menu do navegador.",
          "Toque em Instalar app.",
        ],
      };
    }

    return {
      title: "Instalacao no Android",
      steps: ["Abra no Chrome ou Edge.", "Menu do navegador.", "Toque em Instalar app."],
    };
  }

  if (browser === "chrome" || browser === "edge") {
    return {
      title: "Instalacao no computador",
      steps: ["Na barra de endereco, clique no icone Instalar app.", "Confirme em Instalar."],
    };
  }

  return {
    title: "Instalacao via navegador",
    steps: ["Use Chrome ou Edge para instalar o app.", "Depois clique no botao Baixar app novamente."],
  };
}

export async function triggerPwaInstall(): Promise<InstallOutcome> {
  if (!deferredPrompt) return "unavailable" as const;

  const promptEvent = deferredPrompt;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    return choice.outcome;
  } finally {
    deferredPrompt = null;
    notifyListeners();
  }
}
