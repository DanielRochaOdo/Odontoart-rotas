import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-hero-gradient flex items-center justify-center px-4">
      <div className="rounded-3xl bg-white/80 p-8 shadow-card">
        <p className="text-xs uppercase tracking-[0.35em] text-muted">Odontoart</p>
        <h1 className="mt-3 font-display text-3xl text-ink">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted">O endereço acessado não existe.</p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-xl bg-sea px-4 py-2 text-sm font-semibold text-white"
        >
          Voltar ao painel
        </Link>
      </div>
    </div>
  );
}
