import { supabase } from "./supabase";

type ClienteCanonicalRow = {
  codigo: string | null;
  corte: number | null;
  venc: number | null;
  valor: number | null;
  data_da_ultima_visita: string | null;
  cep: string | null;
  empresa: string | null;
  pessoa: string | null;
  contato: string | null;
  nome_fantasia: string | null;
  complemento: string | null;
  perfil_visita: string | null;
  situacao: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
};

type AgendaSharedLike = {
  cod_1?: string | null;
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

const normalize = (value: string | null | undefined) =>
  (value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const makeCodigoKey = (codigo: string | null | undefined) => {
  const normalized = normalize(codigo);
  return normalized ? `codigo:${normalized}` : "";
};

const makeEmpresaFantasiaKey = (empresa: string | null | undefined, nomeFantasia: string | null | undefined) => {
  const empresaKey = normalize(empresa);
  const fantasiaKey = normalize(nomeFantasia);
  if (!empresaKey && !fantasiaKey) return "";
  return `empresa:${empresaKey}|fantasia:${fantasiaKey}`;
};

export const hydrateAgendaRowsFromClientes = async <T extends AgendaSharedLike>(rows: T[]) => {
  if (rows.length === 0) return rows;

  const codigos = Array.from(
    new Set(
      rows
        .map((row) => (row.cod_1 ?? "").trim())
        .filter(Boolean),
    ),
  );
  const empresas = Array.from(
    new Set(
      rows
        .map((row) => (row.empresa ?? "").trim())
        .filter(Boolean),
    ),
  );
  const fantasias = Array.from(
    new Set(
      rows
        .map((row) => (row.nome_fantasia ?? "").trim())
        .filter(Boolean),
    ),
  );

  const canonicalByKey = new Map<string, ClienteCanonicalRow>();

  if (codigos.length > 0) {
    const { data, error } = await supabase
      .from("clientes")
      .select(
        "codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf",
      )
      .in("codigo", codigos);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((item) => {
      const cliente = item as ClienteCanonicalRow;
      const key = makeCodigoKey(cliente.codigo);
      if (key) canonicalByKey.set(key, cliente);
    });
  }

  if (empresas.length > 0 || fantasias.length > 0) {
    let query = supabase.from("clientes").select(
      "codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, nome_fantasia, complemento, perfil_visita, situacao, endereco, bairro, cidade, uf",
    );
    if (empresas.length > 0 && fantasias.length > 0) {
      query = query.or(`empresa.in.(${empresas.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",")}),nome_fantasia.in.(${fantasias.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",")})`);
    } else if (empresas.length > 0) {
      query = query.in("empresa", empresas);
    } else if (fantasias.length > 0) {
      query = query.in("nome_fantasia", fantasias);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    (data ?? []).forEach((item) => {
      const cliente = item as ClienteCanonicalRow;
      const key = makeEmpresaFantasiaKey(cliente.empresa, cliente.nome_fantasia);
      if (key) canonicalByKey.set(key, cliente);
    });
  }

  return rows.map((row) => {
    const byCodigo = canonicalByKey.get(makeCodigoKey(row.cod_1));
    const byEmpresaFantasia = canonicalByKey.get(makeEmpresaFantasiaKey(row.empresa, row.nome_fantasia));
    const canonical = byCodigo ?? byEmpresaFantasia;
    if (!canonical) return row;

    return {
      ...row,
      cod_1: canonical.codigo,
      corte: canonical.corte,
      venc: canonical.venc,
      valor: canonical.valor,
      data_da_ultima_visita: canonical.data_da_ultima_visita,
      cep: canonical.cep,
      empresa: canonical.empresa,
      pessoa: canonical.pessoa,
      contato: canonical.contato,
      nome_fantasia: canonical.nome_fantasia,
      complemento: canonical.complemento,
      perfil_visita: canonical.perfil_visita,
      situacao: canonical.situacao,
      endereco: canonical.endereco,
      bairro: canonical.bairro,
      cidade: canonical.cidade,
      uf: canonical.uf,
    } as T;
  });
};

