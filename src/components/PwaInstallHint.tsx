import { useCallback, useEffect, useMemo, useState } from "react";
import { MonitorDown, Share2, X } from "lucide-react";
import { initPwaInstall, subscribePwaInstall, triggerPwaInstall } from "../lib/pwaInstall";

const IOS_DISMISS_KEY = "pwa_install_ios_dismissed";
const ANDROID_DISMISS_KEY = "pwa_install_android_dismissed";

export default function PwaInstallHint() {
  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [iosDismissed, setIosDismissed] = useState(false);
  const [androidDismissed, setAndroidDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    initPwaInstall();
    setIosDismissed(localStorage.getItem(IOS_DISMISS_KEY) === "1");
    setAndroidDismissed(localStorage.getItem(ANDROID_DISMISS_KEY) === "1");
    return subscribePwaInstall((state) => {
      setCanInstall(state.canInstall);
      setIsStandalone(state.isStandalone);
    });
  }, []);

  const isIosSafari = useMemo(() => {
    if (typeof window === "undefined") return false;
    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua);
    const safari = /safari/.test(ua);
    const otherIosBrowser = /crios|fxios|edgios|opios/.test(ua);
    return ios && safari && !otherIosBrowser;
  }, []);

  const dismissIos = useCallback(() => {
    localStorage.setItem(IOS_DISMISS_KEY, "1");
    setIosDismissed(true);
  }, []);

  const dismissAndroid = useCallback(() => {
    localStorage.setItem(ANDROID_DISMISS_KEY, "1");
    setAndroidDismissed(true);
  }, []);

  const installApp = useCallback(async () => {
    const outcome = await triggerPwaInstall();
    if (outcome === "dismissed") {
      localStorage.setItem(ANDROID_DISMISS_KEY, "1");
      setAndroidDismissed(true);
    }
  }, []);

  if (isStandalone) return null;

  if (canInstall && !androidDismissed) {
    return (
      <div className="mb-3 rounded-xl border border-sea/25 bg-white/95 p-3 shadow-card md:hidden">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-sea/10 p-2 text-sea">
            <MonitorDown size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Instalar aplicativo</p>
            <p className="text-xs text-ink/70">Toque para instalar e usar em tela cheia no celular.</p>
            <button
              type="button"
              onClick={() => void installApp()}
              className="mt-2 rounded-lg border border-sea/40 bg-seaLight px-3 py-1.5 text-xs font-semibold text-ink"
            >
              Instalar app
            </button>
          </div>
          <button type="button" onClick={dismissAndroid} className="rounded-md p-1 text-ink/50" aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (isIosSafari && !iosDismissed) {
    return (
      <div className="mb-3 rounded-xl border border-sea/25 bg-white/95 p-3 shadow-card md:hidden">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-sea/10 p-2 text-sea">
            <Share2 size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Instalar no iPhone</p>
            <p className="text-xs text-ink/70">Safari: Compartilhar e depois Adicionar a Tela de Inicio.</p>
          </div>
          <button type="button" onClick={dismissIos} className="rounded-md p-1 text-ink/50" aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
