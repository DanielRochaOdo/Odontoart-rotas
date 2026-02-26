import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { extractCustomTimes } from "../src/lib/perfilVisita";

const url = process.env.VITE_SUPABASE_URL;
let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (serviceKey && serviceKey.includes("VITE_CEP_API_URL=")) {
  const marker = "VITE_CEP_API_URL=";
  const idx = serviceKey.indexOf(marker);
  const rawKey = serviceKey.slice(0, idx);
  const cepUrl = serviceKey.slice(idx + marker.length);
  serviceKey = rawKey.trim();
  if (!process.env.VITE_CEP_API_URL && cepUrl) {
    process.env.VITE_CEP_API_URL = cepUrl.trim();
  }
}

if (!url || !serviceKey) {
  throw new Error("VITE_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes no .env");
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CHUNK_SIZE = 500;

const joinTimes = (times: string[]) =>
  Array.from(new Set(times.map((item) => item.trim()).filter(Boolean))).join(" • ");

const extractTimes = (value: string | null) => extractCustomTimes(value ?? "");

const fetchAll = async <T,>(table: string, select: string): Promise<T[]> => {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }
  return all;
};

const updateInChunks = async (table: string, rows: Array<Record<string, unknown>>) => {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(async (row) => {
        const { id, ...payload } = row as { id: string };
        const { error } = await supabase.from(table).update(payload).eq("id", id);
        if (error) {
          throw new Error(error.message);
        }
      }),
    );
    void results;
  }
};

type VisitRow = {
  id: string;
  agenda_id: string | null;
  perfil_visita: string | null;
  perfil_visita_opcoes: string | null;
  completed_at: string | null;
  visit_date: string | null;
};

type AgendaRow = { id: string; perfil_visita: string | null };
type ClienteRow = { id: string; perfil_visita: string | null };

const main = async () => {
  const [visits, agendas, clientes] = await Promise.all([
    fetchAll<VisitRow>(
      "visits",
      "id, agenda_id, perfil_visita, perfil_visita_opcoes, completed_at, visit_date",
    ),
    fetchAll<AgendaRow>("agenda", "id, perfil_visita"),
    fetchAll<ClienteRow>("clientes", "id, perfil_visita"),
  ]);

  const agendaTimesMap = new Map<string, string>();
  agendas.forEach((row) => {
    const times = extractTimes(row.perfil_visita);
    if (times.length >= 2) {
      agendaTimesMap.set(row.id, joinTimes(times));
    }
  });

  const visitUpdates: Array<Record<string, unknown>> = [];
  const agendaFromVisits = new Map<string, { perfil: string; date: number }>();

  visits.forEach((visit) => {
    const optionTimes = extractTimes(visit.perfil_visita_opcoes);
    const perfilTimes = extractTimes(visit.perfil_visita);
    let times = optionTimes.length > 0 ? optionTimes : perfilTimes;
    if (times.length < 2 && visit.agenda_id) {
      const agendaTimes = agendaTimesMap.get(visit.agenda_id);
      if (agendaTimes) {
        times = extractTimes(agendaTimes);
      }
    }

    const update: Record<string, unknown> = { id: visit.id };
    let hasUpdate = false;

    if (times.length >= 2) {
      const joined = joinTimes(times);
      if (visit.perfil_visita_opcoes !== joined) {
        update.perfil_visita_opcoes = joined;
        hasUpdate = true;
      }
      if (visit.perfil_visita && visit.perfil_visita.includes(",")) {
        update.perfil_visita = joined;
        hasUpdate = true;
      }

      if (visit.agenda_id) {
        const dateValue = visit.completed_at ?? visit.visit_date ?? "";
        const timeValue = dateValue ? new Date(dateValue).getTime() : 0;
        const current = agendaFromVisits.get(visit.agenda_id);
        if (!current || timeValue > current.date) {
          agendaFromVisits.set(visit.agenda_id, { perfil: joined, date: timeValue });
        }
      }
    } else if (visit.perfil_visita && visit.perfil_visita.includes(",")) {
      const joined = joinTimes(perfilTimes);
      if (joined && visit.perfil_visita !== joined) {
        update.perfil_visita = joined;
        hasUpdate = true;
      }
    }

    if (hasUpdate) visitUpdates.push(update);
  });

  const agendaUpdates: Array<Record<string, unknown>> = [];
  agendas.forEach((agenda) => {
    const times = extractTimes(agenda.perfil_visita);
    if (times.length >= 2) {
      const joined = joinTimes(times);
      if (agenda.perfil_visita !== joined) {
        agendaUpdates.push({ id: agenda.id, perfil_visita: joined });
      }
    }
  });

  agendaFromVisits.forEach((value, agendaId) => {
    agendaUpdates.push({ id: agendaId, perfil_visita: value.perfil });
  });

  const clienteUpdates: Array<Record<string, unknown>> = [];
  clientes.forEach((cliente) => {
    const times = extractTimes(cliente.perfil_visita);
    if (times.length >= 2) {
      const joined = joinTimes(times);
      if (cliente.perfil_visita !== joined) {
        clienteUpdates.push({ id: cliente.id, perfil_visita: joined });
      }
    }
  });

  console.log(
    `Atualizando: visits=${visitUpdates.length}, agenda=${agendaUpdates.length}, clientes=${clienteUpdates.length}`,
  );

  if (visitUpdates.length) {
    await updateInChunks("visits", visitUpdates);
  }
  if (agendaUpdates.length) {
    await updateInChunks("agenda", agendaUpdates);
  }
  if (clienteUpdates.length) {
    await updateInChunks("clientes", clienteUpdates);
  }

  console.log("Backfill concluido.");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
