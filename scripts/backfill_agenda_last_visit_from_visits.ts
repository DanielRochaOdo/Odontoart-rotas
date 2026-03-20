import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type VisitBackfillRow = {
  id: string;
  agenda_id: string | null;
  visit_date: string | null;
  completed_at: string | null;
  completed_vidas: number | null;
  no_visit_reason: string | null;
};

type AgendaBackfillPayload = {
  id: string;
  data_da_ultima_visita: string;
  visit_completed_vidas: number | null;
};

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

const PAGE_SIZE = 1000;
const UPSERT_CHUNK_SIZE = 500;

const toDateKey = (value: string | null | undefined) => (value ?? "").slice(0, 10);

const toVisitIso = (row: VisitBackfillRow) => {
  const visitDateKey = toDateKey(row.visit_date);
  if (visitDateKey) return new Date(`${visitDateKey}T12:00:00`).toISOString();
  return row.completed_at ?? null;
};

const fetchCompletedVisits = async () => {
  const rows: VisitBackfillRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("visits")
      .select("id, agenda_id, visit_date, completed_at, completed_vidas, no_visit_reason")
      .not("agenda_id", "is", null)
      .not("completed_at", "is", null)
      .is("no_visit_reason", null)
      .order("agenda_id", { ascending: true })
      .order("visit_date", { ascending: false })
      .order("completed_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const batch = (data ?? []) as VisitBackfillRow[];
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
};

const shouldReplaceVisit = (current: AgendaBackfillPayload | undefined, candidate: AgendaBackfillPayload) => {
  if (!current) return true;

  const currentDateKey = toDateKey(current.data_da_ultima_visita);
  const candidateDateKey = toDateKey(candidate.data_da_ultima_visita);

  if (candidateDateKey > currentDateKey) return true;
  if (candidateDateKey < currentDateKey) return false;

  return true;
};

const buildLatestAgendaPayloads = (rows: VisitBackfillRow[]) => {
  const latestByAgenda = new Map<string, AgendaBackfillPayload>();

  rows.forEach((row) => {
    if (!row.agenda_id) return;
    const visitIso = toVisitIso(row);
    if (!visitIso) return;

    const candidate: AgendaBackfillPayload = {
      id: row.agenda_id,
      data_da_ultima_visita: visitIso,
      visit_completed_vidas: row.completed_vidas ?? null,
    };

    const current = latestByAgenda.get(row.agenda_id);
    if (shouldReplaceVisit(current, candidate)) {
      latestByAgenda.set(row.agenda_id, candidate);
    }
  });

  return Array.from(latestByAgenda.values());
};

const upsertAgendaPayloads = async (payloads: AgendaBackfillPayload[]) => {
  let updated = 0;

  for (let index = 0; index < payloads.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = payloads.slice(index, index + UPSERT_CHUNK_SIZE);
    const { error } = await supabase.from("agenda").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(error.message);
    updated += chunk.length;
    console.log(`Chunk ${Math.floor(index / UPSERT_CHUNK_SIZE) + 1}: ${updated}/${payloads.length}`);
  }

  return updated;
};

const main = async () => {
  const rows = await fetchCompletedVisits();
  const payloads = buildLatestAgendaPayloads(rows);

  console.log(`Visitas concluidas consideradas: ${rows.length}`);
  console.log(`Empresas com ultima visita calculada: ${payloads.length}`);

  if (payloads.length === 0) {
    console.log("Nenhum registro elegivel para backfill.");
    return;
  }

  const updated = await upsertAgendaPayloads(payloads);
  console.log(`Concluido. Registros da agenda sincronizados: ${updated}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
