import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { MonitorDown } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import PwaInstallHint from "../components/PwaInstallHint";
import {
  getInstallGuide,
  initPwaInstall,
  subscribePwaInstall,
  triggerPwaInstall,
  waitForInstallPrompt,
} from "../lib/pwaInstall";

type InstallGuide = {
  title: string;
  steps: string[];
};

export default function Login() {
  const { session, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [installGuide, setInstallGuide] = useState<InstallGuide | null>(null);

  const from = (location.state as { from?: Location })?.from?.pathname ?? "/";

  useEffect(() => {
    initPwaInstall();
    return subscribePwaInstall((state) => {
      setCanInstall(state.canInstall);
      setIsStandalone(state.isStandalone);
    });
  }, []);

  if (session) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const result = await signIn(email, password);
    if (result.error) {
      setError(result.error);
    }
    setLoading(false);
  };

  const handleDownloadApp = async () => {
    setInstallGuide(null);

    if (isStandalone) {
      setInstallGuide({ title: "App ja instalado", steps: ["Este dispositivo ja tem o app instalado."] });
      return;
    }

    const promptReady = canInstall || (await waitForInstallPrompt(1200));
    if (promptReady) {
      const outcome = await triggerPwaInstall();
      if (outcome === "dismissed") {
        setInstallGuide({ title: "Instalacao cancelada", steps: ["Clique em Instalar app para tentar novamente."] });
      }
      return;
    }

    setInstallGuide(getInstallGuide());
  };

  return (
    <div className="min-h-screen bg-hero-gradient">
      <div className="mx-auto w-full max-w-6xl px-4 pt-4 md:px-6 md:pt-6">
        <PwaInstallHint />
      </div>

      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center px-4 py-8 lg:flex-row lg:gap-12">
        <div className="max-w-md">
          <p className="text-xs uppercase tracking-[0.35em] text-muted">Odontoart</p>
          <h1 className="mt-3 font-display text-3xl text-ink">Agenda+ Rotas</h1>
          <p className="mt-4 text-base text-ink/70">
            Plataforma interna de gestao de visitas e roteirizacao comercial. O acesso e restrito e
            controlado pela Odontoart.
          </p>
          <div className="mt-6 rounded-2xl border border-sea/20 bg-sand/40 p-4 shadow-card">
            <p className="text-sm font-semibold text-ink">Acesso exclusivo</p>
            <p className="mt-1 text-sm text-ink/60">
              Caso precise de credenciais, fale com a supervisao comercial.
            </p>
          </div>
        </div>

        <div className="mt-8 w-full max-w-md rounded-3xl border border-sea/20 bg-white/95 p-8 shadow-card lg:mt-0">
          <h2 className="font-display text-xl text-ink">Entrar</h2>
          <p className="mt-2 text-sm text-ink/70">Use seu e-mail corporativo Odontoart.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold text-ink">
              E-mail
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-xl border border-mist px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                placeholder="nome@odontoart.com.br"
                required
              />
            </label>

            <label className="block text-sm font-semibold text-ink">
              Senha
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-mist px-3 py-2 text-sm text-ink outline-none focus:border-sea"
                placeholder="********"
                required
              />
            </label>

            {error ? <p className="text-sm text-red-500">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl border border-sea/40 bg-seaLight px-4 py-2 text-sm font-semibold text-ink shadow-md transition hover:bg-sea disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>

            <button
              type="button"
              disabled={isStandalone}
              onClick={() => void handleDownloadApp()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-sea/30 bg-white px-4 py-2 text-sm font-semibold text-sea transition hover:border-sea disabled:cursor-not-allowed disabled:opacity-70"
            >
              <MonitorDown size={16} />
              {isStandalone ? "App instalado" : "Instalar app"}
            </button>

            {installGuide ? (
              <div className="rounded-xl border border-sea/20 bg-sand/40 p-3 text-xs text-ink/80">
                <p className="font-semibold text-ink">{installGuide.title}</p>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {installGuide.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  );
}
