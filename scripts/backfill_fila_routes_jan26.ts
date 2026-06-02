import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type ClienteRow = {
  id: string;
  codigo: string | null;
  empresa: string | null;
  cnpj: string | null;
  situacao: string | null;
};

type ControlRow = {
  empresa_id: string;
  codigo: string | null;
  effective_state: "PENDING_WAIT" | "RELEASE_PENDING" | "READY_AUTO" | "RELEASED_MANUAL" | "BLOCKED_MANUAL";
  eligible_at: string;
  manual_block_until: string | null;
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes no .env");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CUTOFF_ISO = "2026-01-01";
const MANUAL_RELEASE_CUTOFF_MS = Date.parse("2026-06-02T00:00:00-03:00");
const ODONTOART_EMPRESA_URL =
  "https://odontoart.s4e.com.br//api/empresa/BuscaEmpresas";
const ODONTOART_DEFAULT_TOKEN =
  "7DqKKmNcZDWY2Pie35tbKwY6hAKXzS5wWl7hNLAmPWBIljmfeX";
const ODONTOART_TOKEN =
  (process.env.VITE_ODONTOART_TOKEN ?? "").trim() || ODONTOART_DEFAULT_TOKEN;

const readValueByKeysFromUnknown = (
  value: unknown,
  keys: string[],
  depth = 0,
): unknown => {
  if (depth > 6 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readValueByKeysFromUnknown(item, keys, depth + 1);
      if (found !== undefined && found !== null) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const lowerKeyMap = new Map(
    Object.keys(record).map((key) => [key.toLowerCase(), key]),
  );

  for (const key of keys) {
    const mapped = lowerKeyMap.get(key.toLowerCase());
    if (!mapped) continue;
    const candidate = record[mapped];
    if (candidate !== undefined && candidate !== null && String(candidate).trim() !== "") {
      return candidate;
    }
  }

  for (const nested of Object.values(record)) {
    const found = readValueByKeysFromUnknown(nested, keys, depth + 1);
    if (found !== undefined && found !== null) return found;
  }

  return undefined;
};

const parseDataContratoToIsoDate = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;

  const ymdSlash = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymdSlash) return `${ymdSlash[1]}-${ymdSlash[2]}-${ymdSlash[3]}`;

  const ymdDash = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdDash) return `${ymdDash[1]}-${ymdDash[2]}-${ymdDash[3]}`;

  const dmySlash = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlash) return `${dmySlash[3]}-${dmySlash[2]}-${dmySlash[1]}`;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const parseAnoMesPrimeiroPagamentoToIsoDate = (
  value: string | number | null | undefined,
) => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const yyyymm = raw.match(/^(\d{4})(\d{2})$/);
  if (yyyymm) return `${yyyymm[1]}-${yyyymm[2]}-01`;

  const yyyyDashMm = raw.match(/^(\d{4})-(\d{2})$/);
  if (yyyyDashMm) return `${yyyyDashMm[1]}-${yyyyDashMm[2]}-01`;

  const mmSlashYyyy = raw.match(/^(\d{2})\/(\d{4})$/);
  if (mmSlashYyyy) return `${mmSlashYyyy[2]}-${mmSlashYyyy[1]}-01`;

  const yyyymmdd = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (yyyymmdd) return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;

  return parseDataContratoToIsoDate(raw);
};

const resolvePrimeiroPagamentoIso = (payload: unknown) => {
  const value = readValueByKeysFromUnknown(payload, [
    "AnoMesPrimeiroPagamento",
    "anoMesPrimeiroPagamento",
    "AnoMesPrimeiroPgto",
    "anoMesPrimeiroPgto",
    "ANO_MES_PRIMEIRO_PAGAMENTO",
  ]);

  const parsed = parseAnoMesPrimeiroPagamentoToIsoDate(
    value as string | number | null | undefined,
  );
  if (parsed) return parsed;

  const fallbackDataContrato = readValueByKeysFromUnknown(payload, [
    "DataContrato",
    "dataContrato",
  ]);

  return parseDataContratoToIsoDate(
    fallbackDataContrato as string | null | undefined,
  );
};

const fetchEmpresaPayloadByCodigo = async (codigo: string) => {
  const search = new URLSearchParams({
    token: ODONTOART_TOKEN,
    empresaId: codigo.trim(),
  });
  const response = await fetch(`${ODONTOART_EMPRESA_URL}?${search.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`ERP ${codigo}: HTTP ${response.status}`);
  }
  return (await response.json()) as unknown;
};

const fetchAllActiveClientes = async () => {
  const pageSize = 1000;
  let from = 0;
  const all: ClienteRow[] = [];

  while (true) {
    const { data, error } = await withRetry(async () =>
      supabase
        .from("clientes")
        .select("id, codigo, empresa, cnpj, situacao")
        .in("situacao", ["Ativo", "ATIVO"])
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1),
    );

    if (error) throw new Error(`Erro clientes: ${error.message}`);
    const batch = (data ?? []) as ClienteRow[];
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  if (all.length > 0) return all;

  // fallback defensivo
  from = 0;
  while (true) {
    const { data, error } = await withRetry(async () =>
      supabase
        .from("clientes")
        .select("id, codigo, empresa, cnpj, situacao")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1),
    );

    if (error) throw new Error(`Erro fallback clientes: ${error.message}`);
    const batch = (data ?? []) as ClienteRow[];
    if (batch.length === 0) break;
    all.push(...batch.filter((row) => (row.situacao ?? "").toUpperCase() === "ATIVO"));
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return all;
};

const fetchControlsByEmpresaIds = async (empresaIds: string[]) => {
  const uniqueIds = Array.from(new Set(empresaIds.filter(Boolean)));
  if (!uniqueIds.length) return [] as ControlRow[];

  const chunkSize = 100;
  const allRows: ControlRow[] = [];

  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const chunk = uniqueIds.slice(index, index + chunkSize);
    const { data, error } = await withRetry(async () =>
      supabase
        .from("queue_release_controls_view")
        .select("empresa_id, codigo, effective_state, eligible_at, manual_block_until")
        .in("empresa_id", chunk),
    );

    if (error) throw new Error(`Erro controls: ${error.message}`);
    allRows.push(...((data ?? []) as ControlRow[]));
  }

  return allRows;
};

const isControlEligible = (row: ControlRow) => {
  if (row.effective_state === "RELEASED_MANUAL") return true;
  if (row.effective_state !== "READY_AUTO") return false;
  const eligibleAtMs = Date.parse(row.eligible_at);
  return Number.isFinite(eligibleAtMs) && eligibleAtMs < MANUAL_RELEASE_CUTOFF_MS;
};

const filterVisibleInRoutes = (rows: ClienteRow[], controls: ControlRow[]) => {
  if (controls.length === 0) return rows;

  const eligibilityByEmpresaId = new Map<string, boolean>();
  const eligibilityByCodigo = new Map<string, boolean>();

  controls.forEach((row) => {
    const eligible = isControlEligible(row);
    eligibilityByEmpresaId.set(row.empresa_id, eligible);

    const codigo = row.codigo?.trim();
    if (!codigo) return;
    const previous = eligibilityByCodigo.get(codigo);
    eligibilityByCodigo.set(codigo, previous === undefined ? eligible : previous && eligible);
  });

  return rows.filter((row) => {
    const byId = eligibilityByEmpresaId.get(row.id);
    if (byId !== undefined) return byId;

    const codigo = row.codigo?.trim();
    if (!codigo) return true;

    const byCode = eligibilityByCodigo.get(codigo);
    if (byCode !== undefined) return byCode;
    return true;
  });
};

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>,
) => {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      results[index] = await handler(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
};

const chunk = <T,>(arr: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const withRetry = async <T,>(
  operation: () => Promise<T>,
  attempts = 4,
  baseDelayMs = 500,
) => {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (index >= attempts - 1) break;
      await sleep(baseDelayMs * (index + 1));
    }
  }
  throw lastError;
};

const main = async () => {
  console.log("[fila-backfill-routes] inicio");

  const { data: settingsRow, error: settingsError } = await withRetry(async () =>
    supabase
      .from("queue_release_settings")
      .select("default_waiting_days")
      .eq("id", true)
      .maybeSingle(),
  );

  if (settingsError) throw new Error(`Erro settings: ${settingsError.message}`);
  const defaultWaitingDays = Math.max(
    1,
    Number((settingsRow as { default_waiting_days?: number } | null)?.default_waiting_days ?? 30),
  );

  const activeClientes = await fetchAllActiveClientes();
  const controlsBefore = await fetchControlsByEmpresaIds(activeClientes.map((row) => row.id));
  const visibleBefore = filterVisibleInRoutes(activeClientes, controlsBefore);
  const visibleBeforeIds = new Set(visibleBefore.map((row) => row.id));

  console.log(`[fila-backfill-routes] clientes ativos: ${activeClientes.length}`);
  console.log(`[fila-backfill-routes] visiveis em rotas antes: ${visibleBefore.length}`);

  const codeToRows = new Map<string, ClienteRow[]>();
  for (const row of visibleBefore) {
    const codigo = (row.codigo ?? "").trim();
    if (!codigo) continue;
    const existing = codeToRows.get(codigo);
    if (existing) existing.push(row);
    else codeToRows.set(codigo, [row]);
  }

  const codigos = Array.from(codeToRows.keys());
  console.log(`[fila-backfill-routes] codigos unicos em rotas: ${codigos.length}`);

  let processed = 0;
  const pagamentos = await runWithConcurrency(
    codigos,
    8,
    async (codigo) => {
      try {
        const payload = await fetchEmpresaPayloadByCodigo(codigo);
        const primeiroPagamentoIso = resolvePrimeiroPagamentoIso(payload);
        return { codigo, primeiroPagamentoIso, ok: true as const };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { codigo, primeiroPagamentoIso: null, ok: false as const, message };
      } finally {
        processed += 1;
        if (processed % 100 === 0 || processed === codigos.length) {
          console.log(`[fila-backfill-routes] ERP ${processed}/${codigos.length}`);
        }
      }
    },
  );

  const primeiroPagamentoByCodigo = new Map<string, string>();
  let errosErp = 0;
  for (const item of pagamentos) {
    if (!item.ok) {
      errosErp += 1;
      continue;
    }
    if (!item.primeiroPagamentoIso) continue;
    primeiroPagamentoByCodigo.set(item.codigo, item.primeiroPagamentoIso);
  }

  const candidates = visibleBefore.filter((row) => {
    const codigo = (row.codigo ?? "").trim();
    if (!codigo) return false;
    const primeiroPagamentoIso = primeiroPagamentoByCodigo.get(codigo);
    if (!primeiroPagamentoIso) return false;
    return primeiroPagamentoIso >= CUTOFF_ISO;
  });

  console.log(`[fila-backfill-routes] candidatos por AnoMesPrimeiroPagamento>=${CUTOFF_ISO}: ${candidates.length}`);
  console.log(`[fila-backfill-routes] codigos com erro ERP: ${errosErp}`);

  const controlsCandidates = await fetchControlsByEmpresaIds(candidates.map((row) => row.id));
  const controlledCandidateIds = new Set(controlsCandidates.map((row) => row.empresa_id));

  const rowsToInsert = candidates
    .filter((row) => !controlledCandidateIds.has(row.id))
    .map((row) => {
      const codigo = (row.codigo ?? "").trim();
      const dataContrato = primeiroPagamentoByCodigo.get(codigo) ?? CUTOFF_ISO;
      const base = new Date(`${dataContrato}T12:00:00.000Z`);
      base.setUTCDate(base.getUTCDate() + defaultWaitingDays);
      const eligibleAt = base.toISOString();
      const eligibleAtMs = Date.parse(eligibleAt);
      const state =
        eligibleAtMs < MANUAL_RELEASE_CUTOFF_MS
          ? "READY_AUTO"
          : eligibleAtMs <= Date.now()
            ? "RELEASE_PENDING"
            : "PENDING_WAIT";

      return {
        empresa_id: row.id,
        codigo: row.codigo,
        empresa: row.empresa,
        cnpj: row.cnpj,
        data_contrato: dataContrato,
        waiting_days_snapshot: defaultWaitingDays,
        eligible_at: eligibleAt,
        state,
        manual_block_until: null,
        manual_reason: null,
        manual_override_by: null,
        manual_override_at: null,
      };
    });

  let inserted = 0;
  for (const batch of chunk(rowsToInsert, 500)) {
    if (!batch.length) continue;
    const { error } = await withRetry(async () =>
      supabase
        .from("queue_release_controls")
        .upsert(batch, { onConflict: "empresa_id" }),
    );
    if (error) throw new Error(`Erro upsert controls: ${error.message}`);
    inserted += batch.length;
  }

  const controlsAfter = await fetchControlsByEmpresaIds(activeClientes.map((row) => row.id));
  const visibleAfter = filterVisibleInRoutes(activeClientes, controlsAfter);
  const visibleAfterIds = new Set(visibleAfter.map((row) => row.id));

  let removedFromRoutes = 0;
  for (const id of visibleBeforeIds) {
    if (!visibleAfterIds.has(id)) removedFromRoutes += 1;
  }

  console.log("[fila-backfill-routes] resumo");
  console.log(`  visiveis antes: ${visibleBefore.length}`);
  console.log(`  visiveis depois: ${visibleAfter.length}`);
  console.log(`  controles inseridos: ${inserted}`);
  console.log(`  empresas que sairam de rotas: ${removedFromRoutes}`);
};

main().catch((error) => {
  console.error("[fila-backfill-routes] erro fatal", error);
  process.exit(1);
});
