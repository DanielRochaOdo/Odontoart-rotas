import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import xlsx from "xlsx";
import { createClient } from "@supabase/supabase-js";

type RawRow = Record<string, unknown>;

type AgendaInsert = {
  company_id?: string | null;
  data_da_ultima_visita?: string | null;
  cod_1?: string | null;
  empresa?: string | null;
  perfil_visita?: string | null;
  corte?: number | null;
  venc?: number | null;
  valor?: number | null;
  tit?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  supervisor?: string | null;
  vendedor?: string | null;
  nome_fantasia?: string | null;
  grupo?: string | null;
  situacao?: string | null;
  obs_contrato_1?: string | null;
  dedupe_key?: string | null;
  raw_row?: RawRow | null;
};

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const xlsxPath = path.resolve(__dirname, "..", "data", "agenda.xlsx");
const sheetName = " BASE";

const headerToColumn = (header: string, occurrence: number) => {
  const normalized = header.trim();
  const map: Record<string, string | null> = {
    "Data da ultima visita": "data_da_ultima_visita",
    EMPRESA: "empresa",
    "Perfil Visita": "perfil_visita",
    Corte: "corte",
    VenC: "venc",
    Valor: "valor",
    TIT: "tit",
    Endereço: "endereco",
    Bairro: "bairro",
    Cidade: "cidade",
    UF: "uf",
    Supervisor: "supervisor",
    Vendedor: "vendedor",
    "Nome Fantasia": "nome_fantasia",
    Grupo: "grupo",
    Situação: "situacao",
    "Obs. Contrato": occurrence === 1 ? "obs_contrato_1" : null,
    "Cód.": occurrence === 1 ? "cod_1" : null,
  };

  return map[normalized] ?? null;
};

const parseDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const utcDays = Math.floor(value - 25569);
    const utcValue = utcDays * 86400;
    return new Date(utcValue * 1000);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (match) {
      const day = Number(match[1]);
      const month = Number(match[2]);
      let year = Number(match[3]);
      if (year < 100) year += 2000;
      return new Date(Date.UTC(year, month - 1, day));
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

const normalizeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value
      .trim()
      .replace(/\s/g, "")
      .replace(/\.(?=\d{3})/g, "")
      .replace(/,/g, ".")
      .replace(/[^0-9.-]/g, "");
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return null;
};

const normalizeText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
};

const normalizeSituacao = (value: unknown): string | null => {
  const text = normalizeText(value);
  if (!text) return null;
  const cleaned = text.toLowerCase();
  if (cleaned.startsWith("ativo")) return "Ativo";
  if (cleaned.startsWith("inativo")) return "Inativo";
  return text;
};

const makeDedupeKey = (row: AgendaInsert) => {
  const dateKey = row.data_da_ultima_visita
    ? row.data_da_ultima_visita.slice(0, 10)
    : "";
  const parts = [row.empresa, row.nome_fantasia, dateKey, row.vendedor]
    .map((item) => (item ?? "").toString().trim().toLowerCase());

  const combined = parts.join("|");
  return combined.replace(/\s+/g, " ");
};

const chunk = <T,>(items: T[], size: number) => {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
};

const workbook = xlsx.readFile(xlsxPath, { cellDates: true });
const sheet = workbook.Sheets[sheetName];

if (!sheet) {
  console.error(`Sheet "${sheetName}" not found in ${xlsxPath}`);
  process.exit(1);
}

const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
if (!rows.length) {
  console.error("No rows found in sheet.");
  process.exit(1);
}

const rawHeaders = (rows[0] as unknown[]).map((header) => String(header ?? "").trim());
const headerOccurrences: Record<string, number> = {};
const dbColumns = rawHeaders.map((header) => {
  const occurrence = (headerOccurrences[header] ?? 0) + 1;
  headerOccurrences[header] = occurrence;
  return headerToColumn(header, occurrence);
});

const inserts: AgendaInsert[] = [];

for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
  const row = rows[rowIndex] as unknown[];
  const isEmpty = row.every((cell) => cell === null || cell === "");
  if (isEmpty) continue;

  const rawRow: RawRow = {};
  const record: AgendaInsert = {};

  rawHeaders.forEach((header, index) => {
    rawRow[header] = row[index] ?? null;
    const target = dbColumns[index];
    if (!target) return;

    const cell = row[index];

    switch (target) {
      case "data_da_ultima_visita": {
        const parsed = parseDate(cell);
        record.data_da_ultima_visita = parsed ? parsed.toISOString() : null;
        break;
      }
      case "corte":
      case "venc":
      case "valor": {
        record[target] = normalizeNumber(cell);
        break;
      }
      default: {
        record[target] = target === "situacao" ? normalizeSituacao(cell) : normalizeText(cell);
      }
    }
  });

  record.raw_row = rawRow;
  record.dedupe_key = makeDedupeKey(record) || null;
  if (!record.situacao) {
    record.situacao = "Ativo";
  }
  inserts.push(record);
}

const batches = chunk(inserts, 500);
let inserted = 0;

for (const batch of batches) {
  const { error, data } = await supabase
    .from("agenda")
    .upsert(batch, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("Insert failed:", error.message);
    process.exit(1);
  }

  inserted += data?.length ?? 0;
}

console.log(`Import finished. Inserted ${inserted} rows.`);
