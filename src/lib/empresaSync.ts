import { supabase } from "./supabase";
import { extractCustomTimes } from "./perfilVisita";

type ClienteSyncPayload = {
  id: string;
  codigo?: string | null;
  corte?: number | null;
  venc?: number | null;
  valor?: number | null;
  data_da_ultima_visita?: string | null;
  cep?: string | null;
  empresa?: string | null;
  pessoa?: string | null;
  contato?: string | null;
  nome_fantasia?: string | null;
  complemento?: string | null;
  perfil_visita?: string | null;
  situacao?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
};

const escapeOrValue = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

const toVisitPerfilPayload = (perfil: string | null) => {
  if (!perfil) {
    return { perfil_visita: null as string | null, perfil_visita_opcoes: null as string | null };
  }
  const cleanedPerfil = perfil.trim();
  const hasTimes = extractCustomTimes(cleanedPerfil).length > 0;
  return {
    perfil_visita: cleanedPerfil,
    perfil_visita_opcoes: hasTimes ? cleanedPerfil : null,
  };
};

export const syncAgendaRowAcrossModules = async (row: ClienteSyncPayload) => {
  const codigo = row.codigo?.trim() ?? "";
  const empresa = row.empresa?.trim() ?? "";
  const nomeFantasia = row.nome_fantasia?.trim() ?? "";

  const canMatch = Boolean(codigo || empresa || nomeFantasia);
  if (!canMatch) return;

  const clientePayload: Record<string, string | number | null> = {};
  if (row.codigo !== undefined) clientePayload.codigo = row.codigo;
  if (row.corte !== undefined) clientePayload.corte = row.corte;
  if (row.venc !== undefined) clientePayload.venc = row.venc;
  if (row.valor !== undefined) clientePayload.valor = row.valor;
  if (row.data_da_ultima_visita !== undefined) clientePayload.data_da_ultima_visita = row.data_da_ultima_visita;
  if (row.cep !== undefined) clientePayload.cep = row.cep;
  if (row.empresa !== undefined) clientePayload.empresa = row.empresa;
  if (row.pessoa !== undefined) clientePayload.pessoa = row.pessoa;
  if (row.contato !== undefined) clientePayload.contato = row.contato;
  if (row.nome_fantasia !== undefined) clientePayload.nome_fantasia = row.nome_fantasia;
  if (row.complemento !== undefined) clientePayload.complemento = row.complemento;
  if (row.perfil_visita !== undefined) clientePayload.perfil_visita = row.perfil_visita;
  if (row.situacao !== undefined) clientePayload.situacao = row.situacao;
  if (row.endereco !== undefined) clientePayload.endereco = row.endereco;
  if (row.bairro !== undefined) clientePayload.bairro = row.bairro;
  if (row.cidade !== undefined) clientePayload.cidade = row.cidade;
  if (row.uf !== undefined) clientePayload.uf = row.uf;

  if (Object.keys(clientePayload).length > 0) {
    let clientesQuery = supabase.from("clientes").update(clientePayload);
    if (codigo && empresa && nomeFantasia) {
      clientesQuery = clientesQuery.or(
        `codigo.eq.${escapeOrValue(codigo)},empresa.eq.${escapeOrValue(empresa)},nome_fantasia.eq.${escapeOrValue(nomeFantasia)}`,
      );
    } else if (codigo) {
      clientesQuery = clientesQuery.eq("codigo", codigo);
    } else if (empresa && nomeFantasia) {
      clientesQuery = clientesQuery.or(
        `empresa.eq.${escapeOrValue(empresa)},nome_fantasia.eq.${escapeOrValue(nomeFantasia)}`,
      );
    } else if (empresa) {
      clientesQuery = clientesQuery.eq("empresa", empresa);
    } else {
      clientesQuery = clientesQuery.eq("nome_fantasia", nomeFantasia);
    }

    const { error: clienteError } = await clientesQuery;
    if (clienteError) throw new Error(clienteError.message);
  }

  if (row.perfil_visita !== undefined) {
    const visitPerfilPayload = toVisitPerfilPayload(row.perfil_visita ?? null);
    const { error: visitsError } = await supabase
      .from("visits")
      .update(visitPerfilPayload)
      .eq("agenda_id", row.id)
      .is("completed_at", null);

    if (visitsError) throw new Error(visitsError.message);
  }
};

