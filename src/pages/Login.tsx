import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { session, signIn, accessDeniedMessage, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false,
  );

  useEffect(() => {
    const syncTheme = () =>
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    syncTheme();
    window.addEventListener("odontoart-theme-changed", syncTheme);
    window.addEventListener("storage", syncTheme);
    return () => {
      window.removeEventListener("odontoart-theme-changed", syncTheme);
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

  if (session && !authLoading && !accessDeniedMessage) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await signIn(email, password);
      if (result.error) {
        setError(result.error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao realizar login.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={[
        "min-h-screen",
        isDarkMode
          ? "bg-[radial-gradient(circle_at_10%_8%,rgba(62,207,142,0.12),transparent_42%),radial-gradient(circle_at_88%_0%,rgba(0,197,115,0.08),transparent_38%),linear-gradient(140deg,#171717_0%,#121212_48%,#0f0f0f_100%)]"
          : "bg-hero-gradient",
      ].join(" ")}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center px-4 py-8 lg:flex-row lg:gap-12">
        <div className="max-w-md">
          <p className={["text-xs uppercase tracking-[0.35em]", isDarkMode ? "text-white/55" : "text-muted"].join(" ")}>
            Odontoart
          </p>
          <h1 className={["mt-3 font-display text-3xl", isDarkMode ? "text-white" : "text-ink"].join(" ")}>
            Agenda+ Rotas
          </h1>
          <p className={["mt-4 text-base", isDarkMode ? "text-white/75" : "text-ink/70"].join(" ")}>
            Plataforma interna de gestao de visitas e roteirizacao comercial. O acesso e restrito e
            controlado pela Odontoart.
          </p>
          <div
            className={[
              "mt-6 rounded-2xl border p-4 shadow-card",
              isDarkMode ? "border-sea/25 bg-white/10" : "border-sea/20 bg-sand/40",
            ].join(" ")}
          >
            <p className={["text-sm font-semibold", isDarkMode ? "text-white" : "text-ink"].join(" ")}>
              Acesso exclusivo
            </p>
            <p className={["mt-1 text-sm", isDarkMode ? "text-white/70" : "text-ink/60"].join(" ")}>
              Caso precise de credenciais, fale com a supervisao comercial.
            </p>
          </div>
        </div>

        <div
          className={[
            "mt-8 w-full max-w-md rounded-3xl border p-8 shadow-card lg:mt-0",
            isDarkMode ? "border-sea/25 bg-white/10" : "border-sea/20 bg-white/95",
          ].join(" ")}
        >
          <h2 className={["font-display text-xl", isDarkMode ? "text-white" : "text-ink"].join(" ")}>Entrar</h2>
          <p className={["mt-2 text-sm", isDarkMode ? "text-white/70" : "text-ink/70"].join(" ")}>
            Use seu e-mail corporativo Odontoart.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className={["block text-sm font-semibold", isDarkMode ? "text-white" : "text-ink"].join(" ")}>
              E-mail
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={[
                  "mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-sea",
                  isDarkMode
                    ? "border-white/10 bg-white/10 text-white placeholder:text-white/35"
                    : "border-mist bg-white text-ink",
                ].join(" ")}
                placeholder="nome@odontoart.com.br"
                required
              />
            </label>

            <label className={["block text-sm font-semibold", isDarkMode ? "text-white" : "text-ink"].join(" ")}>
              Senha
              <div className="relative mt-2">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={[
                    "w-full rounded-xl border px-3 py-2 pr-11 text-sm outline-none focus:border-sea",
                    isDarkMode
                      ? "border-white/10 bg-white/10 text-white placeholder:text-white/35"
                      : "border-mist bg-white text-ink",
                  ].join(" ")}
                  placeholder="********"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className={[
                    "absolute inset-y-0 right-0 flex items-center justify-center rounded-r-xl px-3 transition",
                    isDarkMode ? "text-white/45 hover:text-white" : "text-ink/50 hover:text-ink",
                  ].join(" ")}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {accessDeniedMessage || error ? (
              <p className={["text-sm", isDarkMode ? "text-red-300" : "text-red-500"].join(" ")}>
                {accessDeniedMessage ?? error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className={[
                "w-full rounded-xl border px-4 py-2 text-sm font-semibold shadow-md transition disabled:cursor-not-allowed disabled:opacity-70",
                isDarkMode
                  ? "border-sea/30 bg-seaLight text-white hover:bg-sea"
                  : "border-sea/40 bg-seaLight text-ink hover:bg-sea",
              ].join(" ")}
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
