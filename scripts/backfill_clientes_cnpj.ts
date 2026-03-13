import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type ClienteCodigoRow = {
  id: string;
  codigo: string | null;
  cnpj: string | null;
};

type OdontoartEmpresaPayload = {
  dados?: Array<Record<string, unknown>>;
} | Array<Record<string, unknown>>;

const ODONTOART_EMPRESA_URL = "https://odontoart.s4e.com.br//api/empresa/BuscaEmpresas";
const ODONTOART_DEFAULT_TOKEN = "7DqKKmNcZDWY2Pie35tbKwY6hAKXzS5wWl7hNLAmPWBIljmfeX";
const CNPJ_KEYS = ["Cnpj", "CNPJ", "cnpj", "CnpjCpf"] as const;
const RATE_LIMIT_MS = 250;

const url = process.env.VITE_SUPABASE_URL;
let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (serviceKey && serviceKey.includes("VITE_CEP_API_URL=")) {
  const marker = "VITE_CEP_API_URL=";
  const idx = serviceKey.indexOf(marker);
  const rawKey = serviceKey.slice(0, idx);
  serviceKey = rawKey.trim();
}

if (!url || !serviceKey) {
  throw new Error("VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes no .env");
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const sanitizeDigits = (value: string) => value.replace(/\D/g, "");

const formatCnpj = (value: string | null | undefined) => {
  const digits = sanitizeDigits(value ?? "").slice(0, 14);
  if (digits.length !== 14) return null;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

const normalizeCodigo = (value: string | null | undefined) => (value ?? "").trim();

const fetchAllClientes = async () => {
  const rows: ClienteCodigoRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("clientes")
      .select("id, codigo, cnpj")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as ClienteCodigoRow[];
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }
  return rows;
};

const extractEmpresaRow = (payload: OdontoartEmpresaPayload): Record<string, unknown> | null => {
  if (Array.isArray(payload)) {
    return payload[0] ?? null;
  }
  if (Array.isArray(payload.dados) && payload.dados.length > 0) {
    return payload.dados[0] ?? null;
  }
  return null;
};

const extractCnpjFromEmpresa = (empresa: Record<string, unknown> | null) => {
  if (!empresa) return null;
  for (const key of CNPJ_KEYS) {
    const value = empresa[key];
    if (value === null || value === undefined) continue;
    const formatted = formatCnpj(String(value));
    if (formatted) return formatted;
  }
  return null;
};

const fetchCnpjByCodigo = async (codigo: string) => {
  const token = (process.env.VITE_ODONTOART_TOKEN ?? ODONTOART_DEFAULT_TOKEN).trim();
  const search = new URLSearchParams({
    token,
    empresaId: codigo,
  });

  const response = await fetch(`${ODONTOART_EMPRESA_URL}?${search.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Falha ao consultar API (${response.status})`);
  }

  const payload = (await response.json()) as OdontoartEmpresaPayload;
  const empresa = extractEmpresaRow(payload);
  return extractCnpjFromEmpresa(empresa);
};

const main = async () => {
  const rows = await fetchAllClientes();
  const mapByCodigo = new Map<string, string[]>();
  for (const row of rows) {
    const codigo = normalizeCodigo(row.codigo);
    if (!codigo) continue;
    const ids = mapByCodigo.get(codigo) ?? [];
    ids.push(row.id);
    mapByCodigo.set(codigo, ids);
  }

  const codigos = Array.from(mapByCodigo.keys());
  console.log(`Clientes totais: ${rows.length}`);
  console.log(`Codigos unicos para consulta: ${codigos.length}`);

  let atualizados = 0;
  let semCnpjNaApi = 0;
  let erros = 0;

  for (let index = 0; index < codigos.length; index += 1) {
    const codigo = codigos[index];
    const ids = mapByCodigo.get(codigo) ?? [];
    if (ids.length === 0) continue;

    try {
      const cnpj = await fetchCnpjByCodigo(codigo);
      if (!cnpj) {
        semCnpjNaApi += 1;
        console.log(`[${index + 1}/${codigos.length}] sem CNPJ na API para codigo ${codigo}`);
        await delay(RATE_LIMIT_MS);
        continue;
      }

      const { error } = await supabase
        .from("clientes")
        .update({ cnpj })
        .in("id", ids);
      if (error) {
        throw new Error(error.message);
      }

      atualizados += ids.length;
      console.log(`[${index + 1}/${codigos.length}] atualizado codigo ${codigo} -> ${cnpj} (${ids.length} registros)`);
    } catch (err) {
      erros += 1;
      console.log(
        `[${index + 1}/${codigos.length}] erro no codigo ${codigo}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await delay(RATE_LIMIT_MS);
  }

  console.log(`Concluido. Registros atualizados: ${atualizados}`);
  console.log(`Codigos sem CNPJ na API: ${semCnpjNaApi}`);
  console.log(`Erros: ${erros}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
