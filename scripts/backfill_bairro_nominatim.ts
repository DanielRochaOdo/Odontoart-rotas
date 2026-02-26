import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type BaseRow = {
  id: string;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  empresa: string | null;
  nome_fantasia: string | null;
};

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

const BASE_URL = "https://nominatim.openstreetmap.org/search";
const RATE_LIMIT_MS = 1000;
let lastRequestAt = 0;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const rateLimit = async () => {
  const now = Date.now();
  const wait = Math.max(0, RATE_LIMIT_MS - (now - lastRequestAt));
  if (wait) {
    await delay(wait);
  }
  lastRequestAt = Date.now();
};

const fetchBairro = async (road: string, city: string, state: string) => {
  await rateLimit();
  const search = new URLSearchParams({
    format: "json",
    addressdetails: "1",
    limit: "1",
    street: road,
    city,
    state,
    country: "Brazil",
  });
  const response = await fetch(`${BASE_URL}?${search.toString()}`, {
    headers: {
      "Accept-Language": "pt-BR",
      "User-Agent": "Odontoart-rotas/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Nominatim erro: ${response.status}`);
  }
  const data = (await response.json()) as Array<{ address?: { suburb?: string } }>;
  const suburb = data?.[0]?.address?.suburb;
  if (!suburb || !suburb.trim()) return null;
  return suburb.trim();
};

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

const hasValue = (value: string | null) => Boolean(value && value.trim());

const escapeOrValue = (value: string) => `"${value.replace(/\"/g, '\\\"')}"`;

const updateAgendaForCliente = async (cliente: BaseRow, bairro: string) => {
  const empresa = cliente.empresa?.trim();
  const nomeFantasia = cliente.nome_fantasia?.trim();

  let query = supabase.from("agenda").update({ bairro });

  if (empresa && nomeFantasia) {
    query = query.or(
      `empresa.eq.${escapeOrValue(empresa)},nome_fantasia.eq.${escapeOrValue(nomeFantasia)}`,
    );
  } else if (empresa) {
    query = query.eq("empresa", empresa);
  } else if (nomeFantasia) {
    query = query.eq("nome_fantasia", nomeFantasia);
  } else {
    return;
  }

  const { error } = await query;
  if (error) {
    throw new Error(error.message);
  }
};

const backfillClientes = async () => {
  const rows = await fetchAll<BaseRow>(
    "clientes",
    "id, endereco, cidade, uf, bairro, empresa, nome_fantasia",
  );
  const candidates = rows.filter(
    (row) => !hasValue(row.bairro) && hasValue(row.endereco) && hasValue(row.cidade) && hasValue(row.uf),
  );

  console.log(`clientes: ${candidates.length} registros para atualizar.`);

  let updated = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const row = candidates[index];
    const road = row.endereco?.trim() ?? "";
    const city = row.cidade?.trim() ?? "";
    const state = row.uf?.trim() ?? "";

    if (!road || !city || !state) {
      continue;
    }

    try {
      const bairro = await fetchBairro(road, city, state);
      if (!bairro) {
        console.log(`[clientes] ${index + 1}/${candidates.length} - sem bairro para ${row.id}`);
        continue;
      }

      const { error } = await supabase.from("clientes").update({ bairro }).eq("id", row.id);
      if (error) {
        console.error(`[clientes] ${row.id} - erro ao atualizar: ${error.message}`);
        continue;
      }

      try {
        await updateAgendaForCliente(row, bairro);
      } catch (agendaErr) {
        const message = agendaErr instanceof Error ? agendaErr.message : String(agendaErr);
        console.error(`[agenda] ${row.id} - erro ao refletir bairro: ${message}`);
      }

      updated += 1;
      console.log(`[clientes] ${index + 1}/${candidates.length} - atualizado: ${row.id} -> ${bairro}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[clientes] ${row.id} - falha ao consultar Nominatim: ${message}`);
    }
  }

  console.log(`clientes: ${updated} registros atualizados.`);
};

const main = async () => {
  await backfillClientes();
  console.log("Backfill de bairro concluido.");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
