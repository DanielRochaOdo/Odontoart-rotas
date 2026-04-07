import "dotenv/config";
import path from "path";
import xlsx from "xlsx";
import { createClient } from "@supabase/supabase-js";

type RawCell = string | number | boolean | Date | null | undefined;
type RawRecord = Record<string, RawCell>;

type ParsedRow = {
  codigo: string;
  categoria: string;
  sourceRow: number;
};

const DEFAULT_FILE = "C:/Users/daniel.rocha/Desktop/atualizacao_classificacao.06-04-26.xlsx";
const PAGE_SIZE = 1000;
const UPDATE_CHUNK_SIZE = 400;

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

const normalizeHeader = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizeCode = (value: RawCell) => {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\.0+$/, "").trim();
};

const normalizeCategoryKey = (value: RawCell) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const canonicalizeCategory = (value: RawCell) => {
  const key = normalizeCategoryKey(value);
  if (!key) return null;
  if (key === "inativo") return "Inativo";
  if (key === "so perda" || key === "so perdas") return "So perda";
  if (key === "queda") return "Queda";
  if (key === "crescimento") return "Crescimento";
  if (key === "so venda" || key === "so vendas") return "So venda";
  if (key === "neutro") return "Neutro";
  return null;
};

const chunk = <T>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
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

const findColumnKey = (keys: string[], aliases: string[]) => {
  const normalized = keys.map((key) => ({ key, normalized: normalizeHeader(key) }));
  for (const alias of aliases) {
    const found = normalized.find((entry) => entry.normalized === alias);
    if (found) return found.key;
  }
  return null;
};

const parseSheetRows = (rows: RawRecord[]) => {
  if (rows.length === 0) {
    throw new Error("Planilha sem linhas de dados.");
  }

  const keys = Object.keys(rows[0]);
  const codeKey = findColumnKey(keys, ["codigo", "cod"]);
  const categoryKey = findColumnKey(keys, ["categoria", "classificacao", "classificacao categoria"]);

  if (!codeKey) {
    throw new Error("Coluna de codigo nao encontrada. Esperado: codigo/cod.");
  }
  if (!categoryKey) {
    throw new Error("Coluna de categoria nao encontrada. Esperado: categoria/classificacao.");
  }

  const parsed: ParsedRow[] = [];
  const invalidRows: number[] = [];
  const invalidCategories: Array<{ row: number; value: string }> = [];

  rows.forEach((raw, index) => {
    const sourceRow = index + 2;
    const codigo = normalizeCode(raw[codeKey]);
    const categoria = canonicalizeCategory(raw[categoryKey]);

    if (!codigo || !categoria) {
      if (codigo || normalizeCategoryKey(raw[categoryKey])) {
        if (!categoria) {
          invalidCategories.push({ row: sourceRow, value: String(raw[categoryKey] ?? "") });
        } else {
          invalidRows.push(sourceRow);
        }
      }
      return;
    }

    parsed.push({ codigo, categoria, sourceRow });
  });

  if (invalidCategories.length > 0) {
    const samples = invalidCategories
      .slice(0, 10)
      .map((item) => `linha ${item.row}: ${item.value}`)
      .join("; ");
    throw new Error(`Categoria invalida em ${invalidCategories.length} linha(s). Exemplos: ${samples}`);
  }

  return {
    parsed,
    invalidRows,
    codeKey,
    categoryKey,
  };
};

const buildCodeCategoryMap = (items: ParsedRow[]) => {
  const map = new Map<string, string>();
  const conflicts: Array<{ codigo: string; first: string; next: string; row: number }> = [];

  for (const item of items) {
    const previous = map.get(item.codigo);
    if (!previous) {
      map.set(item.codigo, item.categoria);
      continue;
    }
    if (previous !== item.categoria) {
      conflicts.push({
        codigo: item.codigo,
        first: previous,
        next: item.categoria,
        row: item.sourceRow,
      });
    }
  }

  if (conflicts.length > 0) {
    const samples = conflicts
      .slice(0, 10)
      .map((item) => `codigo ${item.codigo}: ${item.first} x ${item.next} (linha ${item.row})`)
      .join("; ");
    throw new Error(`Conflito de categoria por codigo em ${conflicts.length} caso(s). ${samples}`);
  }

  return map;
};

const fetchCodigoCounts = async () => {
  const counts = new Map<string, number>();
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("clientes")
      .select("id, codigo")
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Array<{ id: string; codigo: string | null }>;

    batch.forEach((row) => {
      const codigo = normalizeCode(row.codigo);
      if (!codigo) return;
      counts.set(codigo, (counts.get(codigo) ?? 0) + 1);
    });

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return counts;
};

const main = async () => {
  const { filePath, dryRun } = parseArgs();

  console.log(`Arquivo: ${filePath}`);
  console.log(`Modo: ${dryRun ? "DRY RUN" : "ATUALIZACAO REAL"}`);

  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Planilha sem abas.");

  const rows = xlsx.utils.sheet_to_json<RawRecord>(workbook.Sheets[sheetName], { defval: "" });
  const { parsed, invalidRows, codeKey, categoryKey } = parseSheetRows(rows);
  const codeCategoryMap = buildCodeCategoryMap(parsed);

  console.log(`Aba: ${sheetName}`);
  console.log(`Colunas usadas: codigo='${codeKey}' categoria='${categoryKey}'`);
  console.log(`Linhas da planilha: ${rows.length}`);
  console.log(`Linhas validas (codigo + categoria): ${parsed.length}`);
  console.log(`Linhas ignoradas por falta de dados: ${invalidRows.length}`);
  console.log(`Codigos unicos no arquivo: ${codeCategoryMap.size}`);

  const codigoCounts = await fetchCodigoCounts();

  const codesInFile = Array.from(codeCategoryMap.keys());
  const codesFound = codesInFile.filter((code) => codigoCounts.has(code));
  const codesMissing = codesInFile.filter((code) => !codigoCounts.has(code));

  const expectedRowsToUpdate = codesFound.reduce((sum, code) => sum + (codigoCounts.get(code) ?? 0), 0);

  const groupedCodes = new Map<string, string[]>();
  for (const [codigo, categoria] of codeCategoryMap.entries()) {
    if (!codigoCounts.has(codigo)) continue;
    const list = groupedCodes.get(categoria) ?? [];
    list.push(codigo);
    groupedCodes.set(categoria, list);
  }

  console.log(`Codigos encontrados na base: ${codesFound.length}`);
  console.log(`Codigos sem correspondencia na base: ${codesMissing.length}`);
  console.log(`Empresas previstas para atualizar: ${expectedRowsToUpdate}`);

  if (codesMissing.length > 0) {
    console.log(`Exemplo de codigos sem match: ${codesMissing.slice(0, 20).join(", ")}`);
  }

  for (const [categoria, codes] of groupedCodes.entries()) {
    const empresas = codes.reduce((sum, code) => sum + (codigoCounts.get(code) ?? 0), 0);
    console.log(`Categoria ${categoria}: codigos=${codes.length} empresas=${empresas}`);
  }

  if (dryRun) return;

  let updatedCodes = 0;
  let chunkCounter = 0;
  const totalChunks = Array.from(groupedCodes.values()).reduce(
    (sum, codes) => sum + chunk(codes, UPDATE_CHUNK_SIZE).length,
    0,
  );

  for (const [categoria, codes] of groupedCodes.entries()) {
    const batches = chunk(codes, UPDATE_CHUNK_SIZE);
    for (const codeBatch of batches) {
      chunkCounter += 1;
      const { error } = await supabase
        .from("clientes")
        .update({ categoria })
        .in("codigo", codeBatch);

      if (error) {
        throw new Error(`Falha ao atualizar categoria '${categoria}' no lote ${chunkCounter}: ${error.message}`);
      }

      updatedCodes += codeBatch.length;
      console.log(`Lote ${chunkCounter}/${totalChunks} aplicado: categoria=${categoria} codigos=${codeBatch.length}`);
    }
  }

  console.log("Atualizacao concluida.");
  console.log(`Codigos atualizados: ${updatedCodes}`);
  console.log(`Empresas atualizadas (estimado por contagem previa): ${expectedRowsToUpdate}`);
};

main().catch((error) => {
  console.error("Erro fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
