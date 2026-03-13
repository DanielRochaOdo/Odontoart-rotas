import "dotenv/config";
import path from "path";
import xlsx from "xlsx";
import { createClient } from "@supabase/supabase-js";

type RawCell = string | number | boolean | Date | null | undefined;
type RawRecord = Record<string, RawCell>;

type ClienteDbRow = {
  id: string;
  codigo: string | null;
  corte: number | null;
  venc: number | null;
  valor: number | null;
  data_da_ultima_visita: string | null;
  cep: string | null;
  empresa: string | null;
  pessoa: string | null;
  contato: string | null;
  grupo: string | null;
  obs_comercial: string | null;
  obs: string | null;
  nome_fantasia: string | null;
  perfil_visita: string | null;
  situacao: string | null;
  endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  dedupe_key?: string | null;
};

type ImportPayload = Omit<ClienteDbRow, "id">;

const extractJwtToken = (raw: string | undefined) => {
  if (!raw) return undefined;
  const compact = raw.replace(/\r?\n/g, "").trim();
  const viteMarker = compact.indexOf("VITE_");
  const cleaned = viteMarker > 0 ? compact.slice(0, viteMarker) : compact;
  const match = cleaned.match(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return match?.[0];
};

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = extractJwtToken(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const DEFAULT_FILE = "C:/Users/daniel.rocha/Downloads/importacao_tratada_v2.xlsx";
const PAGE_SIZE = 1000;

const normalizeHeader = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const sanitizeDigits = (value: string) => value.replace(/\D/g, "");
const normalizeContato = (value: string) => {
  const rawTokens = value
    .split(/[;,/|\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const sourceTokens = rawTokens.length > 0 ? rawTokens : [value];

  const contatos = sourceTokens
    .map((item) => sanitizeDigits(item))
    .map((digits) => {
      if (!digits) return "";
      if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
        return digits.slice(2);
      }
      return digits;
    })
    .map((digits) => {
      if (digits.length === 10 || digits.length === 11) return digits;
      if (digits.length > 11) return digits.slice(-11);
      return "";
    })
    .filter(Boolean);

  if (!contatos.length) return null;

  const unique = Array.from(new Set(contatos));
  return unique.join(", ");
};

const sanitizeCep = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");
const formatCep = (value: string | null | undefined) => {
  const digits = sanitizeCep(value);
  if (digits.length !== 8) return value?.trim() ? value.trim() : null;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

const parseCurrency = (value: string) => {
  const cleaned = value.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const excelSerialToISOString = (serial: number) => {
  if (!Number.isFinite(serial)) return null;
  const excelEpoch = Date.UTC(1899, 11, 30);
  const millis = Math.round(serial * 24 * 60 * 60 * 1000);
  const date = new Date(excelEpoch + millis);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(0, 10)}T12:00:00.000Z`;
};

const parseDate = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const [, dayRaw, monthRaw, yearRaw] = dmy;
    const day = dayRaw.padStart(2, "0");
    const month = monthRaw.padStart(2, "0");
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return `${year}-${month}-${day}T12:00:00.000Z`;
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric >= 20000 && numeric <= 60000) {
      const excelDate = excelSerialToISOString(numeric);
      if (excelDate) return excelDate;
    }
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T12:00:00.000Z`;
};

const normalizeAddressPart = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const buildAddressKey = (item: {
  endereco?: string | null;
  cidade?: string | null;
  uf?: string | null;
  complemento?: string | null;
}) => {
  const endereco = normalizeAddressPart(item.endereco);
  if (!endereco) return "";
  const cidade = normalizeAddressPart(item.cidade);
  const uf = normalizeAddressPart(item.uf);
  const complemento = normalizeAddressPart(item.complemento);
  return `${endereco}|${cidade}|${uf}|${complemento}`;
};

const normalizeDedupePart = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const buildDedupeKey = (payload: Pick<ImportPayload, "empresa" | "nome_fantasia">) =>
  `${normalizeDedupePart(payload.empresa)}|${normalizeDedupePart(payload.nome_fantasia)}`;

const normalizeText = (value: RawCell) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value).trim();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
};

const normalizeCodigo = (value: string) => value.replace(/\.0+$/, "").trim();

const HEADER_MAP: Record<string, keyof ImportPayload | "obs_col_c"> = {
  codigo: "codigo",
  cod: "codigo",
  empresa: "empresa",
  unidade: "obs_col_c",
  "nome fantasia": "nome_fantasia",
  nome_fantasia: "nome_fantasia",
  pessoa: "pessoa",
  contato: "contato",
  grupo: "grupo",
  "obs comercial": "obs_comercial",
  obs_comercial: "obs_comercial",
  corte: "corte",
  vencimento: "venc",
  venc: "venc",
  valor: "valor",
  "data ultima visita": "data_da_ultima_visita",
  "data da ultima visita": "data_da_ultima_visita",
  data_ultima_visita: "data_da_ultima_visita",
  data_da_ultima_visita: "data_da_ultima_visita",
  perfil_visita: "perfil_visita",
  "perfil visita": "perfil_visita",
  cidade: "cidade",
  uf: "uf",
  endereco: "endereco",
  complemento: "complemento",
  bairro: "bairro",
  cep: "cep",
  obs: "obs",
  observacao: "obs",
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  let filePath = DEFAULT_FILE;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (current === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (current === "--file") {
      filePath = args[i + 1] ?? filePath;
      i += 1;
    }
  }

  return {
    filePath: path.resolve(filePath),
    dryRun,
  };
};

const resolveNomeFantasia = (explicit: string | null | undefined, obsColC: string | null | undefined, codigo: string | null | undefined) => {
  const clean = (value: string | null | undefined) => (value ?? "").trim();
  const explicitValue = clean(explicit);
  if (explicitValue) return explicitValue;
  const obsValue = clean(obsColC);
  const obsNormalized = obsValue.toLowerCase();
  if (obsValue && obsNormalized !== "-" && obsNormalized !== "n/a" && obsNormalized !== "na") {
    return obsValue;
  }
  const codigoValue = clean(codigo);
  return codigoValue || null;
};

const fetchAllClientes = async () => {
  const rows: ClienteDbRow[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("clientes")
      .select(
        "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, grupo, obs_comercial, obs, nome_fantasia, perfil_visita, situacao, endereco, complemento, bairro, cidade, uf",
      )
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);
    const batch = (data ?? []) as ClienteDbRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
};

const fetchByDedupeKey = async (payload: ImportPayload) => {
  const dedupeKey = buildDedupeKey(payload);
  const { data, error } = await supabase
    .from("clientes")
    .select(
      "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, grupo, obs_comercial, obs, nome_fantasia, perfil_visita, situacao, endereco, complemento, bairro, cidade, uf, dedupe_key",
    )
    .eq("dedupe_key", dedupeKey)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ClienteDbRow | null) ?? null;
};

const pickByAddress = (matches: ClienteDbRow[], payload: ImportPayload) => {
  if (matches.length === 1) return matches[0];
  const normalizedCodigo = (payload.codigo ?? "").trim().toLowerCase();
  const normalizedObs = (payload.obs ?? "").trim().toLowerCase();
  const normalizedEmpresa = (payload.empresa ?? "").trim().toLowerCase();

  const ranked = matches
    .map((item) => {
      let score = 0;
      if ((item.codigo ?? "").trim().toLowerCase() === normalizedCodigo && normalizedCodigo) score += 4;
      if ((item.obs ?? "").trim().toLowerCase() === normalizedObs && normalizedObs) score += 5;
      if ((item.empresa ?? "").trim().toLowerCase() === normalizedEmpresa && normalizedEmpresa) score += 2;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0].item;
};

const main = async () => {
  const { filePath, dryRun } = parseArgs();
  console.log(`Arquivo: ${filePath}`);
  console.log(`Modo: ${dryRun ? "DRY RUN" : "IMPORTACAO REAL"}`);

  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Planilha sem abas.");
  const sheet = workbook.Sheets[sheetName];
  const rawRows = xlsx.utils.sheet_to_json<RawRecord>(sheet, { defval: "" });
  if (rawRows.length === 0) throw new Error("Planilha sem linhas de dados.");

  const payloads: ImportPayload[] = [];
  for (const raw of rawRows) {
    const record: Partial<ImportPayload> & { obs_col_c?: string | null } = {};
    for (const [key, value] of Object.entries(raw)) {
      const normalizedHeader = normalizeHeader(key);
      const mapped = HEADER_MAP[normalizedHeader];
      if (!mapped) continue;
      const text = normalizeText(value);
      if (!text) continue;
      if (mapped === "obs_col_c") {
        record.obs_col_c = text;
        continue;
      }
      if (mapped === "codigo") {
        record.codigo = normalizeCodigo(text);
        continue;
      }
      if (mapped === "contato") {
        record.contato = normalizeContato(text);
        continue;
      }
      if (mapped === "corte" || mapped === "venc") {
        const digits = sanitizeDigits(text);
        record[mapped] = digits ? Number(digits) : null;
        continue;
      }
      if (mapped === "valor") {
        record.valor = parseCurrency(text);
        continue;
      }
      if (mapped === "data_da_ultima_visita") {
        record.data_da_ultima_visita = parseDate(text);
        continue;
      }
      if (mapped === "cep") {
        record.cep = formatCep(text);
        continue;
      }
      record[mapped] = text;
    }

    const payload: ImportPayload = {
      codigo: record.codigo ?? null,
      corte: record.corte ?? null,
      venc: record.venc ?? null,
      valor: record.valor ?? null,
      data_da_ultima_visita: record.data_da_ultima_visita ?? null,
      cep: record.cep ?? null,
      empresa: record.empresa ?? null,
      pessoa: record.pessoa ?? null,
      contato: record.contato ?? null,
      grupo: record.grupo ?? null,
      obs_comercial: record.obs_comercial ?? null,
      obs: record.obs ?? record.obs_col_c ?? null,
      nome_fantasia: resolveNomeFantasia(record.nome_fantasia ?? null, record.obs_col_c ?? null, record.codigo ?? null),
      perfil_visita: record.perfil_visita ?? null,
      situacao: "Ativo",
      endereco: record.endereco ?? null,
      complemento: record.complemento ?? null,
      bairro: record.bairro ?? null,
      cidade: record.cidade ?? null,
      uf: record.uf ?? null,
    };

    if (!payload.empresa) continue;
    payloads.push(payload);
  }

  const existing = await fetchAllClientes();
  const byAddress = new Map<string, ClienteDbRow[]>();
  for (const row of existing) {
    const key = buildAddressKey(row);
    if (!key) continue;
    const list = byAddress.get(key) ?? [];
    list.push(row);
    byAddress.set(key, list);
  }

  let toUpdate = 0;
  let toInsert = 0;
  let withoutAddress = 0;
  for (const payload of payloads) {
    const key = buildAddressKey(payload);
    if (!key) {
      toInsert += 1;
      withoutAddress += 1;
      continue;
    }
    const matches = byAddress.get(key) ?? [];
    if (matches.length > 0) toUpdate += 1;
    else toInsert += 1;
  }

  console.log(`Linhas validas para importar: ${payloads.length}`);
  console.log(`Previsto para atualizar (match por endereco): ${toUpdate}`);
  console.log(`Previsto para inserir: ${toInsert}`);
  console.log(`Sem endereco (insercao direta): ${withoutAddress}`);

  const contatosAmostra = payloads
    .slice(0, 10)
    .map((item) => ({ codigo: item.codigo, contato: item.contato, obs: item.obs, endereco: item.endereco }));
  console.log("Amostra (codigo/contato/obs/endereco):");
  contatosAmostra.forEach((item, idx) => {
    console.log(`${idx + 1}. ${item.codigo ?? "-"} | ${item.contato ?? "-"} | ${item.obs ?? "-"} | ${item.endereco ?? "-"}`);
  });

  if (dryRun) return;

  let updated = 0;
  let inserted = 0;
  let failed = 0;
  const failures: Array<{ index: number; codigo: string | null; error: string }> = [];

  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];
    try {
      const key = buildAddressKey(payload);
      if (key) {
        const matches = byAddress.get(key) ?? [];
        if (matches.length > 0) {
          const target = pickByAddress(matches, payload);
          const { data, error } = await supabase
            .from("clientes")
            .update(payload)
            .eq("id", target.id)
            .select(
              "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, grupo, obs_comercial, obs, nome_fantasia, perfil_visita, situacao, endereco, complemento, bairro, cidade, uf",
            )
            .single();
          if (error) throw new Error(error.message);
          const updatedRow = data as ClienteDbRow;
          const updatedList = matches.map((item) => (item.id === updatedRow.id ? updatedRow : item));
          byAddress.set(key, updatedList);
          updated += 1;
        } else {
          const { data, error } = await supabase
            .from("clientes")
            .insert(payload)
            .select(
              "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, grupo, obs_comercial, obs, nome_fantasia, perfil_visita, situacao, endereco, complemento, bairro, cidade, uf",
            )
            .single();
          if (error) throw new Error(error.message);
          const insertedRow = data as ClienteDbRow;
          const existingList = byAddress.get(key) ?? [];
          existingList.push(insertedRow);
          byAddress.set(key, existingList);
          inserted += 1;
        }
      } else {
        const { error } = await supabase.from("clientes").insert(payload);
        if (error) throw new Error(error.message);
        inserted += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      if (message.toLowerCase().includes("clientes_dedupe_key_unique")) {
        try {
          const current = await fetchByDedupeKey(payload);
          if (!current) throw new Error(message);
          const { data: updatedData, error: updateError } = await supabase
            .from("clientes")
            .update(payload)
            .eq("id", current.id)
            .select(
              "id, codigo, corte, venc, valor, data_da_ultima_visita, cep, empresa, pessoa, contato, grupo, obs_comercial, obs, nome_fantasia, perfil_visita, situacao, endereco, complemento, bairro, cidade, uf",
            )
            .single();
          if (updateError) throw new Error(updateError.message);

          const oldKey = buildAddressKey(current);
          if (oldKey) {
            const oldItems = byAddress.get(oldKey) ?? [];
            byAddress.set(
              oldKey,
              oldItems.filter((item) => item.id !== current.id),
            );
          }
          const updatedRow = updatedData as ClienteDbRow;
          const newKey = buildAddressKey(updatedRow);
          if (newKey) {
            const target = byAddress.get(newKey) ?? [];
            target.push(updatedRow);
            byAddress.set(newKey, target);
          }
          updated += 1;
        } catch (fallbackErr) {
          failed += 1;
          failures.push({
            index: index + 1,
            codigo: payload.codigo ?? null,
            error: fallbackErr instanceof Error ? fallbackErr.message : "Erro desconhecido",
          });
        }
      } else {
        failed += 1;
        failures.push({
          index: index + 1,
          codigo: payload.codigo ?? null,
          error: message,
        });
      }
    }

    if ((index + 1) % 100 === 0 || index + 1 === payloads.length) {
      console.log(`Progresso: ${index + 1}/${payloads.length} | atualizados=${updated} inseridos=${inserted} falhas=${failed}`);
    }
  }

  console.log("Importacao concluida.");
  console.log(`Atualizados: ${updated}`);
  console.log(`Inseridos: ${inserted}`);
  console.log(`Falhas: ${failed}`);

  if (failures.length > 0) {
    console.log("Primeiras falhas:");
    failures.slice(0, 20).forEach((item) => {
      console.log(`linha=${item.index} codigo=${item.codigo ?? "-"} erro=${item.error}`);
    });
  }
};

main().catch((error) => {
  console.error("Erro fatal na importacao:", error instanceof Error ? error.message : error);
  process.exit(1);
});
