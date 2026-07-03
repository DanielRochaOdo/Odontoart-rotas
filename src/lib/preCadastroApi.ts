import { createCliente } from "./clientesApi";
import { supabase } from "./supabase";
import type { CreatePreCadastroPayload, PreCadastroRow, PreCadastroStatus } from "../types/preCadastro";

const PRE_CADASTRO_SELECT_COLUMNS =
  "id, created_by_user_id, created_by_name, reviewed_by_user_id, status, review_note, approved_cliente_id, codigo, cnpj, corte, venc, valor, reajuste_pct, data_da_ultima_visita, cep, empresa, pessoa, contato, grupo, obs_comercial, obs, perfil_visita, situacao, endereco, complemento, bairro, cidade, uf, created_at, reviewed_at";

const formatCnpj = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "").slice(0, 14);
  if (!digits) return null;
  if (digits.length < 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

const mapPreCadastroToClientePayload = (row: PreCadastroRow) => ({
  codigo: row.codigo ?? null,
  corte: row.corte ?? null,
  venc: row.venc ?? null,
  valor: row.valor ?? null,
  reajuste_pct: row.reajuste_pct ?? null,
  data_da_ultima_visita: row.data_da_ultima_visita ?? null,
  cep: row.cep ?? null,
  cnpj: formatCnpj(row.cnpj),
  empresa: row.empresa ?? null,
  pessoa: row.pessoa ?? null,
  contato: row.contato ?? null,
  grupo: row.grupo ?? null,
  obs_comercial: row.obs_comercial ?? null,
  obs: row.obs ?? null,
  perfil_visita: row.perfil_visita ?? null,
  situacao: row.situacao ?? "Ativo",
  endereco: row.endereco ?? null,
  complemento: row.complemento ?? null,
  bairro: row.bairro ?? null,
  cidade: row.cidade ?? null,
  uf: row.uf ?? null,
});

export const createPreCadastro = async (
  payload: CreatePreCadastroPayload,
  options: { createdByUserId: string; createdByName?: string | null },
) => {
  const { data, error } = await supabase
    .from("pre_cadastros")
    .insert({
      created_by_user_id: options.createdByUserId,
      created_by_name: options.createdByName ?? null,
      codigo: payload.codigo ?? null,
      cnpj: payload.cnpj ?? null,
      corte: payload.corte ?? null,
      venc: payload.venc ?? null,
      valor: payload.valor ?? null,
      reajuste_pct: payload.reajuste_pct ?? null,
      data_da_ultima_visita: payload.data_da_ultima_visita ?? null,
      cep: payload.cep ?? null,
      empresa: payload.empresa ?? null,
      pessoa: payload.pessoa ?? null,
      contato: payload.contato ?? null,
      grupo: payload.grupo ?? null,
      obs_comercial: payload.obs_comercial ?? null,
      obs: payload.obs ?? null,
      perfil_visita: payload.perfil_visita ?? null,
      situacao: payload.situacao ?? "Ativo",
      endereco: payload.endereco ?? null,
      complemento: payload.complemento ?? null,
      bairro: payload.bairro ?? null,
      cidade: payload.cidade ?? null,
      uf: payload.uf ?? null,
    })
    .select(PRE_CADASTRO_SELECT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as PreCadastroRow;
};

export const fetchMyPreCadastros = async (userId: string) => {
  const { data, error } = await supabase
    .from("pre_cadastros")
    .select(PRE_CADASTRO_SELECT_COLUMNS)
    .eq("created_by_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as PreCadastroRow[];
};

export const fetchPreCadastrosForReview = async (statuses: PreCadastroStatus[] = ["PENDENTE"]) => {
  const query = supabase
    .from("pre_cadastros")
    .select(PRE_CADASTRO_SELECT_COLUMNS)
    .order("created_at", { ascending: false });

  const filtered = statuses.length ? query.in("status", statuses) : query;
  const { data, error } = await filtered;
  if (error) throw new Error(error.message);
  return (data ?? []) as PreCadastroRow[];
};

export const approvePreCadastro = async (
  row: PreCadastroRow,
  options: { reviewerUserId: string; reviewNote?: string | null },
) => {
  const createdCliente = await createCliente(mapPreCadastroToClientePayload(row));

  const { data, error } = await supabase
    .from("pre_cadastros")
    .update({
      status: "APROVADO",
      reviewed_by_user_id: options.reviewerUserId,
      review_note: options.reviewNote?.trim() || "Aprovado",
      approved_cliente_id: createdCliente.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "PENDENTE")
    .select(PRE_CADASTRO_SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Este pre-cadastro ja foi analisado.");
  return data as PreCadastroRow;
};

export const rejectPreCadastro = async (
  id: string,
  options: { reviewerUserId: string; reviewNote: string },
) => {
  const reviewNote = options.reviewNote.trim();
  if (!reviewNote) {
    throw new Error("Informe o motivo da reprovacao.");
  }

  const { data, error } = await supabase
    .from("pre_cadastros")
    .update({
      status: "REPROVADO",
      reviewed_by_user_id: options.reviewerUserId,
      review_note: reviewNote,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "PENDENTE")
    .select(PRE_CADASTRO_SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Este pre-cadastro ja foi analisado.");
  return data as PreCadastroRow;
};
