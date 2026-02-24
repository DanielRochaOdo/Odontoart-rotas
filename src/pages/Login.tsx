import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { session, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: Location })?.from?.pathname ?? "/";

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

  return (
    <div className="min-h-screen bg-hero-gradient">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center justify-center px-4 py-8 lg:flex-row lg:gap-12">
        <div className="max-w-md">
          <p className="text-xs uppercase tracking-[0.35em] text-muted">Odontoart</p>
          <h1 className="mt-3 font-display text-3xl text-ink">Agenda+ Rotas</h1>
          <p className="mt-4 text-base text-muted">
            Plataforma interna de gestão de visitas e roteirização comercial. O acesso é restrito e
            controlado pela Odontoart.
          </p>
          <div className="mt-6 rounded-2xl border border-mist/60 bg-white/80 p-4 shadow-card">
            <p className="text-sm font-semibold text-ink">Acesso exclusivo</p>
            <p className="mt-1 text-sm text-muted">
              Caso precise de credenciais, fale com a supervisão comercial.
            </p>
          </div>
        </div>

        <div className="mt-8 w-full max-w-md rounded-3xl bg-white/90 p-8 shadow-card backdrop-blur lg:mt-0">
          <h2 className="font-display text-xl text-ink">Entrar</h2>
          <p className="mt-2 text-sm text-muted">Use seu e-mail corporativo Odontoart.</p>

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
                placeholder="••••••••"
                required
              />
            </label>

            {error ? <p className="text-sm text-red-500">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-sea px-4 py-2 text-sm font-semibold text-white transition hover:bg-seaLight disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
