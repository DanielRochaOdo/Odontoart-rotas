export const VISIT_TYPE = {
  VENDEDOR: "VENDEDOR",
  SUPERVISOR_RELACIONAMENTO: "SUPERVISOR_RELACIONAMENTO",
} as const;

export const SUPERVISOR_VISIT_REASON_OPTIONS = [
  { value: "RETENCAO", label: "Retencao" },
  { value: "RELACIONAMENTO", label: "Relacionamento" },
  { value: "EMPRESA_INADIMPLENTE", label: "Empresa inadimplente" },
  { value: "EVENTO_ODONTOMOVEL", label: "Evento/Odontomovel" },
] as const;

export type SupervisorVisitReason = (typeof SUPERVISOR_VISIT_REASON_OPTIONS)[number]["value"];

export const VISIT_REGISTER_MODE = {
  PADRAO: "PADRAO",
  SUPERVISOR_DIFERENCIADO: "SUPERVISOR_DIFERENCIADO",
} as const;

export const SUPERVISOR_DESCRICAO_VISITA_OPTIONS = [
  { value: "REUNIAO_REALIZADA", label: "Reuniao realizada" },
  { value: "VISITA_MARCADA", label: "Visita marcada" },
  { value: "VISITA_PENDENTE", label: "Visita pendente" },
  { value: "VISITA_NAO_AUTORIZADA", label: "Visita nao autorizada" },
  { value: "DUVIDAS_SOBRE_PORTAL_PLANO", label: "Duvidas sobre portal/plano" },
  { value: "LISTA_SOLICITADA", label: "Lista solicitada" },
  { value: "LISTA_RECEBIDA", label: "Lista recebida" },
  { value: "ODONTOMOVEL_ALINHADO", label: "Odontomovel alinhado" },
  { value: "ACAO_SIPAT_REALIZADA", label: "Acao/SIPAT realizada" },
  { value: "RETENCAO_REALIZADA", label: "Retencao realizada" },
  { value: "RETENCAO_SEM_SUCESSO", label: "Retencao sem sucesso" },
  { value: "CANCELAMENTO_SOLICITADO", label: "Cancelamento solicitado" },
] as const;

export type SupervisorDescricaoVisita =
  (typeof SUPERVISOR_DESCRICAO_VISITA_OPTIONS)[number]["value"];

export type SupervisorEmpresaFlagColor = "CINZA" | "VERDE" | "AMARELO" | "VERMELHO";

export const parseDateKey = (value: string | null | undefined) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export const daysSinceDateKey = (dateKey: string, now = new Date()) => {
  if (!dateKey) return null;
  const anchor = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(anchor.getTime())) return null;
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const diffMs = today.getTime() - anchor.getTime();
  return Math.floor(diffMs / 86400000);
};

export const getSupervisorEmpresaFlagColor = (daysSince: number | null): SupervisorEmpresaFlagColor => {
  if (daysSince === null || !Number.isFinite(daysSince)) return "CINZA";
  if (daysSince <= 90) return "VERDE";
  if (daysSince <= 180) return "AMARELO";
  return "VERMELHO";
};

export const getSupervisorEmpresaFlagMeta = (lastVisitDate: string | null | undefined) => {
  const key = parseDateKey(lastVisitDate);
  const daysSince = daysSinceDateKey(key);
  const color = getSupervisorEmpresaFlagColor(daysSince);
  return { color, daysSince, lastVisitDate: key || null };
};
