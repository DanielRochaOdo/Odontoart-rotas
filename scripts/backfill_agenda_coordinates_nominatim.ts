import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type AgendaGeoRow = {
  id: string;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  latitude: number | null;
  longitude: number | null;
  empresa: string | null;
  nome_fantasia: string | null;
};

type SearchResult = {
  lat?: string;
  lon?: string;
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

const BASE_URL = "https://nominatim.openstreetmap.org/search";
const RATE_LIMIT_MS = 1100;
let lastRequestAt = 0;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const rateLimit = async () => {
  const now = Date.now();
  const wait = Math.max(0, RATE_LIMIT_MS - (now - lastRequestAt));
  if (wait) await delay(wait);
  lastRequestAt = Date.now();
};

const fetchCoords = async (street: string, city: string, state: string) => {
  await rateLimit();
  const params = new URLSearchParams({
    format: "json",
    limit: "1",
    country: "Brazil",
    street,
    city,
    state,
  });
  const response = await fetch(`${BASE_URL}?${params.toString()}`, {
    headers: {
      "Accept-Language": "pt-BR",
      "User-Agent": "Odontoart-rotas/1.0",
    },
  });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const data = (await response.json()) as SearchResult[];
  const first = data[0];
  if (!first?.lat || !first?.lon) return null;
  const latitude = Number(first.lat);
  const longitude = Number(first.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
};

const fetchCoordsByQuery = async (q: string) => {
  await rateLimit();
  const params = new URLSearchParams({
    format: "json",
    limit: "1",
    q,
  });
  const response = await fetch(`${BASE_URL}?${params.toString()}`, {
    headers: {
      "Accept-Language": "pt-BR",
      "User-Agent": "Odontoart-rotas/1.0",
    },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as SearchResult[];
  const first = data[0];
  if (!first?.lat || !first?.lon) return null;
  const latitude = Number(first.lat);
  const longitude = Number(first.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
};

const fetchAllAgenda = async () => {
  const all: AgendaGeoRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("agenda")
      .select("id, endereco, bairro, cidade, uf, latitude, longitude, empresa, nome_fantasia")
      .range(from, from + 999)
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as AgendaGeoRow[];
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }
  return all;
};

const labelOf = (row: AgendaGeoRow) => row.empresa ?? row.nome_fantasia ?? row.id;

const main = async () => {
  const rows = await fetchAllAgenda();
  const missing = rows.filter((r) => r.latitude === null || r.longitude === null);
  console.log(`Agenda total: ${rows.length} | sem coordenadas: ${missing.length}`);

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (let i = 0; i < missing.length; i += 1) {
    const row = missing[i];
    const city = row.cidade?.trim();
    const state = row.uf?.trim();
    const primary = [row.endereco, row.bairro].filter(Boolean).join(", ").trim();
    const fallback = (row.endereco ?? "").trim();

    if (!city || !state || (!primary && !fallback)) {
      skip += 1;
      continue;
    }

    try {
      const coords =
        (primary ? await fetchCoords(primary, city, state) : null) ??
        (fallback ? await fetchCoords(fallback, city, state) : null) ??
        (row.bairro?.trim() ? await fetchCoordsByQuery(`${row.bairro.trim()}, ${city}, ${state}, Brasil`) : null) ??
        (await fetchCoordsByQuery(`${city}, ${state}, Brasil`));
      if (!coords) {
        fail += 1;
        console.log(`[${i + 1}/${missing.length}] sem match: ${labelOf(row)}`);
        continue;
      }

      const { error } = await supabase
        .from("agenda")
        .update({
          latitude: coords.latitude,
          longitude: coords.longitude,
          geocode_source: "nominatim-script",
          geocode_updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      ok += 1;
      console.log(`[${i + 1}/${missing.length}] atualizado: ${labelOf(row)}`);
    } catch (err) {
      fail += 1;
      console.log(`[${i + 1}/${missing.length}] falha: ${labelOf(row)} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`Concluido. Atualizadas: ${ok} | sem dados: ${skip} | falhas: ${fail}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
