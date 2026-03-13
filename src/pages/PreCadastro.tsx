import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Check, MapPin, Search, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { formatCep, sanitizeCep } from "../lib/cep";
import { fetchEmpresaByCnpjWs } from "../lib/cnpjWsApi";
import { fetchNominatimByAddress, fetchNominatimByCep } from "../lib/nominatim";
import { fetchEmpresaByEmpresaId, type OdontoartEmpresaResponseRow } from "../lib/odontoartEmpresaApi";
import { PERFIL_VISITA_PRESETS } from "../lib/perfilVisita";
import {
  approvePreCadastro,
  createPreCadastro,
  fetchMyPreCadastros,
  fetchPreCadastrosForReview,
  rejectPreCadastro,
} from "../lib/preCadastroApi";
import type { PreCadastroRow } from "../types/preCadastro";

const SITUACAO_OPTIONS = ["Ativo", "Suspenso/Inadimplente", "Cancelado"] as const;

const sanitizeDigits = (value: string) => value.replace(/\D/g, "");
const sanitizeCnpjDigits = (value: string) => sanitizeDigits(value).slice(0, 14);
const sanitizeContatoInput = (value: string) =>
  value.replace(/\./g, ",").replace(/[^\d,]/g, "").replace(/,+/g, ",").replace(/^,+/, "");

const normalizeContato = (value: string) => {
  const contatos = sanitizeContatoInput(value)
    .replace(/^,+|,+$/g, "")
    .split(",")
    .map((item) => sanitizeDigits(item).slice(0, 11))
    .filter(Boolean);
  return contatos.length ? contatos.join(", ") : null;
};

const formatCnpjInput = (value: string) => {
  const digits = sanitizeCnpjDigits(value);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};
const normalizeCnpj = (value: string | number | null | undefined) => {
  const digits = sanitizeCnpjDigits(String(value ?? ""));
  if (digits.length !== 14) return null;
  return formatCnpjInput(digits);
};

const formatCurrencyInput = (value: string) => {
  const digits = sanitizeDigits(value);
  if (!digits) return "";
  const amount = Number(digits) / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
};

const parseCurrency = (value: string) => {
  const cleaned = value.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") && cleaned.includes(".")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseNumber = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toIsoDate = (value: string) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00`).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const buildEndereco = (logradouro?: string | null, numero?: string | number | null) =>
  [
    logradouro?.trim(),
    numero !== null && numero !== undefined ? String(numero).trim() : "",
  ]
    .filter(Boolean)
    .join(", ");

const resolveValorTitular = (empresa: OdontoartEmpresaResponseRow) => {
  const direct = Number(String(empresa.ValorTitular ?? "").replace(/\./g, "").replace(",", "."));
  if (Number.isFinite(direct)) return direct;
  const fallback = Number(String(empresa.PrecoPlano?.[0]?.ValorTitular ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(fallback) ? fallback : null;
};

const resolveEmpresaFromApi = (empresa: OdontoartEmpresaResponseRow) =>
  (empresa.NomeFantazia ?? empresa.NomeFantasia ?? empresa.RazaoSocial ?? "").trim();

const resolveCnpjFromApi = (empresa: OdontoartEmpresaResponseRow) => {
  const candidates: Array<string | number | null | undefined> = [
    empresa.CNPJ,
    empresa.Cnpj,
    empresa.cnpj,
    empresa.CnpjCpf,
  ];
  for (const candidate of candidates) {
    const formatted = normalizeCnpj(candidate);
    if (formatted) return formatted;
  }
  return "";
};

const normalizeStatus = (value: string) => {
  const cleaned = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (cleaned === "ativo") return "Ativo";
  if (cleaned === "cancelado") return "Cancelado";
  if (cleaned.includes("suspenso") || cleaned.includes("inadimplente")) return "Suspenso/Inadimplente";
  return value.trim();
};

const buildInitialForm = () => ({
  codigo: "",
  cnpj: "",
  empresa: "",
  pessoa: "",
  contato: "",
  grupo: "",
  obs_comercial: "",
  obs: "",
  corte: "",
  venc: "",
  valor: "",
  data_da_ultima_visita: "",
  perfil_visita: "",
  situacao: "Ativo",
  cidade: "",
  uf: "",
  endereco: "",
  complemento: "",
  bairro: "",
  cep: "",
});

const statusClass: Record<PreCadastroRow["status"], string> = {
  PENDENTE: "border-amber-300 bg-amber-50 text-amber-800",
  APROVADO: "border-emerald-300 bg-emerald-50 text-emerald-800",
  REPROVADO: "border-red-300 bg-red-50 text-red-700",
};

const statusLabel: Record<PreCadastroRow["status"], string> = {
  PENDENTE: "Pendente",
  APROVADO: "Aprovado",
  REPROVADO: "Reprovado",
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("pt-BR").format(date);
};

export default function PreCadastro() {
  const { role, session, profile } = useAuth();
  const isVendor = role === "VENDEDOR";
  const canReview = role === "ASSISTENTE" || role === "SUPERVISOR";
  const canAccess = isVendor || canReview;

  const [activeTab, setActiveTab] = useState<"cadastro" | "status" | "aprovacoes">(isVendor ? "cadastro" : "aprovacoes");
  const [form, setForm] = useState(buildInitialForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState<"" | "codigo" | "cnpj" | "cep" | "endereco">("");
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [statusRows, setStatusRows] = useState<PreCadastroRow[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [approvalRows, setApprovalRows] = useState<PreCadastroRow[]>([]);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(isVendor ? "cadastro" : "aprovacoes");
  }, [isVendor]);

  const loadVendorStatus = useCallback(async () => {
    if (!session?.user.id) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      setStatusRows(await fetchMyPreCadastros(session.user.id));
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Erro ao carregar status.");
    } finally {
      setStatusLoading(false);
    }
  }, [session?.user.id]);

  const loadApprovals = useCallback(async () => {
    if (!canReview) return;
    setApprovalLoading(true);
    setApprovalError(null);
    try {
      setApprovalRows(await fetchPreCadastrosForReview(["PENDENTE"]));
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : "Erro ao carregar aprovacoes.");
    } finally {
      setApprovalLoading(false);
    }
  }, [canReview]);

  useEffect(() => {
    if (isVendor) void loadVendorStatus();
  }, [isVendor, loadVendorStatus]);

  useEffect(() => {
    if (canReview) void loadApprovals();
  }, [canReview, loadApprovals]);

  const canEditEndereco = Boolean(form.cidade.trim() && form.uf.trim());

  const mergeEmpresaApi = (empresa: OdontoartEmpresaResponseRow, codigoFallback: string) => {
    const codigo = empresa.Id !== null && empresa.Id !== undefined ? String(empresa.Id).trim() : codigoFallback.trim();
    const valor = resolveValorTitular(empresa);
    setForm((prev) => ({
      ...prev,
      codigo,
      cnpj: resolveCnpjFromApi(empresa) || prev.cnpj,
      corte: empresa.Corte !== null && empresa.Corte !== undefined ? String(empresa.Corte).trim() : prev.corte,
      venc: empresa.Vencimento !== null && empresa.Vencimento !== undefined ? String(empresa.Vencimento).trim() : prev.venc,
      valor: valor !== null ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor) : prev.valor,
      cep: formatCep((empresa.Cep ?? "").trim()) || prev.cep,
      empresa: resolveEmpresaFromApi(empresa) || prev.empresa,
      obs_comercial: (empresa.ObservacaoComercial ?? "").trim() || prev.obs_comercial,
      situacao: normalizeStatus(empresa.NomeSituacao ?? empresa.nomeSituacao ?? prev.situacao),
      endereco: buildEndereco(empresa.Logradouro, empresa.Numero) || prev.endereco,
      bairro: (empresa.BairroNome ?? "").trim() || prev.bairro,
      cidade: (empresa.MunicipioNome ?? "").trim() || prev.cidade,
      uf: (empresa.UfNome ?? "").trim() || prev.uf,
    }));
  };

  const handleCodigoLookup = async () => {
    const empresaId = form.codigo.trim();
    if (!empresaId) return setLookupError("Informe o codigo da empresa.");
    setLookupLoading("codigo");
    setLookupError(null);
    try {
      const empresaApi = await fetchEmpresaByEmpresaId(empresaId);
      if (!empresaApi) throw new Error("Empresa nao encontrada na API.");
      mergeEmpresaApi(empresaApi, empresaId);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Erro ao buscar codigo na API.");
    } finally {
      setLookupLoading("");
    }
  };

  const handleCnpjLookup = async () => {
    const cnpj = sanitizeCnpjDigits(form.cnpj);
    if (cnpj.length !== 14) return setLookupError("Informe um CNPJ valido.");
    setLookupLoading("cnpj");
    setLookupError(null);
    try {
      const empresaApi = await fetchEmpresaByCnpjWs(cnpj);
      setForm((prev) => ({
        ...prev,
        empresa: empresaApi.razao_social ?? prev.empresa,
        endereco: buildEndereco(empresaApi.logradouro, empresaApi.numero) || prev.endereco,
        bairro: empresaApi.bairro ?? prev.bairro,
        cidade: empresaApi.cidade ?? prev.cidade,
        uf: empresaApi.estado ?? prev.uf,
      }));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Erro ao buscar CNPJ na API.");
    } finally {
      setLookupLoading("");
    }
  };

  const handleCepLookup = async () => {
    const digits = sanitizeCep(form.cep);
    if (digits.length !== 8) return setLookupError("Informe um CEP valido.");
    setLookupLoading("cep");
    setLookupError(null);
    try {
      const mapped = await fetchNominatimByCep(digits);
      if (!mapped) throw new Error("CEP nao encontrado.");
      setForm((prev) => ({ ...prev, endereco: mapped.endereco ?? prev.endereco, bairro: mapped.bairro ?? prev.bairro, cidade: mapped.cidade ?? prev.cidade, uf: mapped.uf ?? prev.uf }));
    } catch {
      setLookupError("CEP nao encontrado ou API indisponivel.");
    } finally {
      setLookupLoading("");
    }
  };

  const handleEnderecoLookup = async () => {
    if (!form.endereco.trim() || !form.cidade.trim() || !form.uf.trim()) {
      return setLookupError("Informe endereco, cidade e UF.");
    }
    setLookupLoading("endereco");
    setLookupError(null);
    try {
      const mapped = await fetchNominatimByAddress(form.endereco.trim(), form.cidade.trim(), form.uf.trim());
      if (!mapped) throw new Error("Endereco nao encontrado.");
      setForm((prev) => ({ ...prev, bairro: mapped.bairro ?? prev.bairro, cep: mapped.cep ? formatCep(mapped.cep) : prev.cep }));
    } catch {
      setLookupError("Endereco nao encontrado ou API indisponivel.");
    } finally {
      setLookupLoading("");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.user.id) return setError("Usuario nao autenticado.");
    if (!form.empresa.trim()) return setError("Informe o nome da empresa.");
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await createPreCadastro(
        {
          codigo: form.codigo.trim() || null,
          cnpj: sanitizeCnpjDigits(form.cnpj) || null,
          corte: parseNumber(form.corte),
          venc: parseNumber(form.venc),
          valor: parseCurrency(form.valor),
          data_da_ultima_visita: toIsoDate(form.data_da_ultima_visita),
          cep: form.cep.trim() || null,
          empresa: form.empresa.trim() || null,
          pessoa: form.pessoa.trim() || null,
          contato: normalizeContato(form.contato),
          grupo: form.grupo.trim() || null,
          obs_comercial: form.obs_comercial.trim() || null,
          obs: form.obs.trim() || null,
          perfil_visita: form.perfil_visita || null,
          situacao: form.situacao || "Ativo",
          endereco: form.endereco.trim() || null,
          complemento: form.complemento.trim() || null,
          bairro: form.bairro.trim() || null,
          cidade: form.cidade.trim() || null,
          uf: form.uf.trim() || null,
        },
        { createdByUserId: session.user.id, createdByName: profile?.display_name ?? profile?.nome ?? null },
      );
      setForm(buildInitialForm());
      setMessage("Pre-cadastro enviado para aprovacao.");
      void loadVendorStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar pre-cadastro.");
    } finally {
      setSaving(false);
    }
  };

  const sortedStatusRows = useMemo(() => [...statusRows].sort((a, b) => b.created_at.localeCompare(a.created_at)), [statusRows]);

  const handleApprove = async (row: PreCadastroRow) => {
    if (!session?.user.id) return;
    setActingId(row.id);
    setApprovalError(null);
    try {
      await approvePreCadastro(row, {
        reviewerUserId: session.user.id,
        reviewNote: reviewNotes[row.id] ?? null,
      });
      setApprovalRows((prev) => prev.filter((item) => item.id !== row.id));
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : "Erro ao aprovar pre-cadastro.");
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (row: PreCadastroRow) => {
    if (!session?.user.id) return;
    const note = (reviewNotes[row.id] ?? "").trim();
    if (!note) {
      setApprovalError("Informe o motivo da reprovacao antes de reprovar.");
      return;
    }
    setActingId(row.id);
    setApprovalError(null);
    try {
      await rejectPreCadastro(row.id, {
        reviewerUserId: session.user.id,
        reviewNote: note,
      });
      setApprovalRows((prev) => prev.filter((item) => item.id !== row.id));
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : "Erro ao reprovar pre-cadastro.");
    } finally {
      setActingId(null);
    }
  };

  if (!canAccess) {
    return <div className="rounded-2xl border border-sea/20 bg-sand/30 p-6 text-sm text-ink/70">Este modulo e restrito a usuarios autorizados.</div>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-ink">Pre-cadastro</h2>
        <p className="mt-2 text-sm text-ink/60">
          {isVendor ? "Envie empresas para aprovacao e acompanhe o status." : "Aprove ou reprove empresas enviadas pelos vendedores."}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {isVendor && (
          <button type="button" onClick={() => setActiveTab("cadastro")} className={`rounded-lg px-3 py-2 text-xs font-semibold ${activeTab === "cadastro" ? "bg-sea text-white" : "border border-sea/30 bg-white text-ink/70 hover:border-sea hover:text-sea"}`}>
            Cadastro
          </button>
        )}
        {isVendor && (
          <button type="button" onClick={() => setActiveTab("status")} className={`rounded-lg px-3 py-2 text-xs font-semibold ${activeTab === "status" ? "bg-sea text-white" : "border border-sea/30 bg-white text-ink/70 hover:border-sea hover:text-sea"}`}>
            Status
          </button>
        )}
        {canReview && (
          <button type="button" onClick={() => setActiveTab("aprovacoes")} className={`rounded-lg px-3 py-2 text-xs font-semibold ${activeTab === "aprovacoes" ? "bg-sea text-white" : "border border-sea/30 bg-white text-ink/70 hover:border-sea hover:text-sea"}`}>
            Aprovacoes
          </button>
        )}
      </div>

      {activeTab === "cadastro" && isVendor && (
        <form onSubmit={handleSubmit} className="grid gap-3 rounded-2xl border border-sea/20 bg-sand/30 p-4 md:grid-cols-6">
          <label className="min-w-0 flex w-full flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
            Codigo
            <div className="min-w-0 flex items-end gap-1">
              <input value={form.codigo} onChange={(event) => setForm((prev) => ({ ...prev, codigo: event.target.value }))} className="min-w-0 w-full flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" />
              <button type="button" onClick={handleCodigoLookup} disabled={lookupLoading === "codigo" || !form.codigo.trim()} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50" title={lookupLoading === "codigo" ? "Buscando codigo..." : "Buscar por codigo"} aria-label={lookupLoading === "codigo" ? "Buscando codigo..." : "Buscar por codigo"}>
                <Search size={15} className={lookupLoading === "codigo" ? "animate-pulse" : ""} />
              </button>
            </div>
          </label>

          <label className="min-w-0 flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
            CNPJ
            <div className="relative">
              <input value={form.cnpj} onChange={(event) => setForm((prev) => ({ ...prev, cnpj: formatCnpjInput(event.target.value) }))} inputMode="numeric" maxLength={18} placeholder="00.000.000/0000-00" className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 pr-11 text-sm text-ink outline-none focus:border-sea" />
              <button type="button" onClick={handleCnpjLookup} disabled={lookupLoading === "cnpj" || sanitizeCnpjDigits(form.cnpj).length !== 14} className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-r-lg border-l border-sea/30 bg-white text-sea hover:text-seaLight disabled:opacity-50" title={lookupLoading === "cnpj" ? "Buscando CNPJ..." : "Buscar por CNPJ"} aria-label={lookupLoading === "cnpj" ? "Buscando CNPJ..." : "Buscar por CNPJ"}>
                <Building2 size={15} className={lookupLoading === "cnpj" ? "animate-pulse" : ""} />
              </button>
            </div>
          </label>

          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Empresa
            <input value={form.empresa} onChange={(event) => setForm((prev) => ({ ...prev, empresa: event.target.value }))} className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
            Pessoa
            <input value={form.pessoa} onChange={(event) => setForm((prev) => ({ ...prev, pessoa: event.target.value }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-1">
            Contato
            <input value={form.contato} onChange={(event) => setForm((prev) => ({ ...prev, contato: sanitizeContatoInput(event.target.value) }))} placeholder="85999999999,85988888888" className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Grupo
            <input value={form.grupo} onChange={(event) => setForm((prev) => ({ ...prev, grupo: event.target.value }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Obs comercial
            <input value={form.obs_comercial} onChange={(event) => setForm((prev) => ({ ...prev, obs_comercial: event.target.value }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">
            Obs
            <input value={form.obs} onChange={(event) => setForm((prev) => ({ ...prev, obs: event.target.value }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" />
          </label>

          <div className="md:col-span-6 flex flex-wrap items-end gap-2">
            <label className="w-16 flex flex-col gap-1 text-xs font-semibold text-ink/70">Corte<input value={form.corte} onChange={(event) => setForm((prev) => ({ ...prev, corte: sanitizeDigits(event.target.value).slice(0, 2) }))} inputMode="numeric" maxLength={2} className="w-full rounded-lg border border-sea/20 bg-white px-2 py-2 text-sm text-ink outline-none focus:border-sea" /></label>
            <label className="w-16 flex flex-col gap-1 text-xs font-semibold text-ink/70">Venc<input value={form.venc} onChange={(event) => setForm((prev) => ({ ...prev, venc: sanitizeDigits(event.target.value).slice(0, 2) }))} inputMode="numeric" maxLength={2} className="w-full rounded-lg border border-sea/20 bg-white px-2 py-2 text-sm text-ink outline-none focus:border-sea" /></label>
            <label className="w-36 flex flex-col gap-1 text-xs font-semibold text-ink/70">Valor<input value={form.valor} onChange={(event) => setForm((prev) => ({ ...prev, valor: formatCurrencyInput(event.target.value) }))} inputMode="decimal" className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" /></label>
            <label className="w-40 flex flex-col gap-1 text-xs font-semibold text-ink/70">Data da ultima visita<input type="date" value={form.data_da_ultima_visita} onChange={(event) => setForm((prev) => ({ ...prev, data_da_ultima_visita: event.target.value }))} className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" /></label>
            <label className="w-44 flex flex-col gap-1 text-xs font-semibold text-ink/70">Perfil visita<select value={form.perfil_visita} onChange={(event) => setForm((prev) => ({ ...prev, perfil_visita: event.target.value }))} className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea"><option value="">Selecione</option>{PERFIL_VISITA_PRESETS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
            <label className="w-40 shrink-0 flex flex-col gap-1 text-xs font-semibold text-ink/70">Situacao<select value={form.situacao} onChange={(event) => setForm((prev) => ({ ...prev, situacao: event.target.value }))} className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea">{SITUACAO_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">Cidade<input value={form.cidade} onChange={(event) => setForm((prev) => ({ ...prev, cidade: event.target.value }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" /></label>
          <div className="md:col-span-4 grid gap-3 md:grid-cols-[80px_minmax(0,1fr)] md:items-start">
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70">UF<input value={form.uf} onChange={(event) => setForm((prev) => ({ ...prev, uf: event.target.value.toUpperCase().slice(0, 3) }))} maxLength={3} className="w-full rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm uppercase tracking-wide text-ink outline-none focus:border-sea" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70"><span>Endereco + No</span><div className="flex items-end gap-1"><input value={form.endereco} onChange={(event) => setForm((prev) => ({ ...prev, endereco: event.target.value }))} disabled={!canEditEndereco} className="flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" /><button type="button" onClick={handleEnderecoLookup} disabled={lookupLoading === "endereco" || !form.endereco.trim() || !form.cidade.trim() || !form.uf.trim()} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"><MapPin size={15} className={lookupLoading === "endereco" ? "animate-pulse" : ""} /></button></div></label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">Complemento<input value={form.complemento} onChange={(event) => setForm((prev) => ({ ...prev, complemento: event.target.value }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">Bairro<input value={form.bairro} onChange={(event) => setForm((prev) => ({ ...prev, bairro: event.target.value }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink/70 md:col-span-2">CEP<div className="flex items-end gap-1"><input value={form.cep} onChange={(event) => setForm((prev) => ({ ...prev, cep: formatCep(event.target.value) }))} placeholder="00000-000" className="flex-1 rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" /><button type="button" onClick={handleCepLookup} disabled={lookupLoading === "cep" || sanitizeCep(form.cep).length !== 8} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-sea/30 bg-white text-sea hover:border-sea hover:text-seaLight disabled:opacity-50"><Search size={15} className={lookupLoading === "cep" ? "animate-pulse" : ""} /></button></div></label>

          <div className="md:col-span-6"><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-sea px-4 py-2 text-xs font-semibold text-white hover:bg-seaLight disabled:opacity-60">{saving ? "Enviando..." : "Pre cadastrar"}</button></div>
          {lookupError && <div className="md:col-span-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{lookupError}</div>}
          {message && <div className="md:col-span-6 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</div>}
          {error && <div className="md:col-span-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
        </form>
      )}

      {activeTab === "status" && isVendor && (
        <div className="rounded-2xl border border-sea/15 bg-white/95 p-4">
          {statusLoading ? <p className="text-sm text-ink/60">Carregando status...</p> : statusError ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{statusError}</div> : sortedStatusRows.length === 0 ? <p className="text-sm text-ink/60">Nenhum pre-cadastro enviado.</p> : <div className="space-y-3">{sortedStatusRows.map((row) => (
            <div key={row.id} className="rounded-xl border border-sea/15 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-sm font-semibold text-ink">{row.empresa ?? "Sem nome"}</p><p className="text-xs text-ink/60">{row.cidade ? `${row.cidade} / ${row.uf ?? ""}` : "-"} - Enviado em {formatDate(row.created_at)}</p></div>
                <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClass[row.status]}`}>{statusLabel[row.status]}</span>
              </div>
              {row.review_note ? <p className="mt-2 text-xs text-ink/70">Justificativa: <span className="font-semibold">{row.review_note}</span></p> : null}
            </div>
          ))}</div>}
        </div>
      )}

      {activeTab === "aprovacoes" && canReview && (
        <div className="rounded-2xl border border-sea/15 bg-white/95 p-4">
          {approvalLoading ? <p className="text-sm text-ink/60">Carregando pendencias...</p> : <>
            {approvalError && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{approvalError}</div>}
            {approvalRows.length === 0 ? <p className="text-sm text-ink/60">Nenhum pre-cadastro pendente.</p> : <div className="space-y-3">{approvalRows.map((row) => (
              <div key={row.id} className="rounded-xl border border-sea/15 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="text-sm font-semibold text-ink">{row.empresa ?? "Sem nome"}</p><p className="text-xs text-ink/60">Vendedor: {row.created_by_name ?? "Nao informado"} - {formatDate(row.created_at)}</p></div>
                  <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">Pendente</span>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-ink/70 md:grid-cols-3">
                  <div>Codigo: {row.codigo ?? "-"}</div><div>CNPJ: {row.cnpj ?? "-"}</div><div>Situacao: {row.situacao ?? "-"}</div><div>Cidade: {row.cidade ?? "-"}</div><div>UF: {row.uf ?? "-"}</div><div>Contato: {row.contato ?? "-"}</div>
                </div>
                <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-ink/70">Justificativa (obrigatoria para reprovar)<textarea rows={2} value={reviewNotes[row.id] ?? ""} onChange={(event) => setReviewNotes((prev) => ({ ...prev, [row.id]: event.target.value }))} className="rounded-lg border border-sea/20 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sea" /></label>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button type="button" onClick={() => void handleApprove(row)} disabled={actingId === row.id} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50" title="Aprovar" aria-label="Aprovar"><Check size={16} /></button>
                  <button type="button" onClick={() => void handleReject(row)} disabled={actingId === row.id} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50" title="Reprovar" aria-label="Reprovar"><X size={16} /></button>
                </div>
              </div>
            ))}</div>}
          </>}
        </div>
      )}
    </div>
  );
}
