import type { CepMapped } from "./cep";

type NominatimAddress = {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  residential?: string;
  footway?: string;
  cycleway?: string;
  path?: string;
  service?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  city_district?: string;
  city?: string;
  town?: string;
  municipality?: string;
  county?: string;
  state?: string;
  state_district?: string;
  region?: string;
  country?: string;
  postcode?: string;
  "ISO3166-2-lvl4"?: string;
};

type NominatimResult = {
  address?: NominatimAddress;
  lat?: string;
  lon?: string;
};
export type NominatimCoordinates = {
  latitude: number;
  longitude: number;
  mapped: CepMapped | null;
};

const NOMINATIM_ROOT = import.meta.env.DEV
  ? "/api/nominatim"
  : "https://nominatim.openstreetmap.org";
const BASE_URL = `${NOMINATIM_ROOT}/search`;
const REVERSE_URL = `${NOMINATIM_ROOT}/reverse`;
const REQUEST_INTERVAL_MS = 2200;
const RETRYABLE_STATUS = new Set([429, 503, 504]);
const MAX_ATTEMPTS = 3;

let lastRequestAt = 0;
let queue: Promise<void> = Promise.resolve();
let cooldownUntil = 0;
const coordinateCache = new Map<string, NominatimCoordinates | null>();
const inflightCoordinates = new Map<string, Promise<NominatimCoordinates | null>>();

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const handleAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", handleAbort, { once: true });
    }
  });

const enqueue = async <T,>(task: () => Promise<T>, signal?: AbortSignal) => {
  const run = async () => {
    const now = Date.now();
    const rateWait = Math.max(0, REQUEST_INTERVAL_MS - (now - lastRequestAt));
    const cooldownWait = Math.max(0, cooldownUntil - now);
    const wait = Math.max(rateWait, cooldownWait);
    if (wait) {
      await delay(wait, signal);
    }
    lastRequestAt = Date.now();
    return task();
  };

  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const parseRetryAfterMs = (retryAfterHeader: string | null) => {
  if (!retryAfterHeader) return null;
  const seconds = Number.parseInt(retryAfterHeader, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(retryAfterHeader);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
};

const fetchJsonWithRetry = async <T,>(
  url: string,
  signal?: AbortSignal,
): Promise<T> => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      signal,
      headers: {
        "Accept-Language": "pt-BR",
      },
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      const backoffMs =
        retryAfterMs ??
        (response.status === 429 ? 8000 * attempt : 2000 * attempt);
      cooldownUntil = Math.max(cooldownUntil, Date.now() + backoffMs);
      await delay(backoffMs, signal);
      continue;
    }

    lastError = new Error(
      response.status === 429
        ? "Limite de consultas do geocodificador excedido. Tente novamente em instantes."
        : "Falha ao consultar endereco.",
    );
    break;
  }

  throw lastError ?? new Error("Falha ao consultar endereco.");
};

const normalizeCoordinateKeyPart = (value: string) =>
  value.replace(/\s+/g, " ").trim().toUpperCase();

const withCoordinateCache = (
  cacheKey: string,
  loader: () => Promise<NominatimCoordinates | null>,
) => {
  if (coordinateCache.has(cacheKey)) {
    return Promise.resolve(coordinateCache.get(cacheKey) ?? null);
  }
  const running = inflightCoordinates.get(cacheKey);
  if (running) return running;

  const task = loader()
    .then((result) => {
      coordinateCache.set(cacheKey, result);
      return result;
    })
    .finally(() => {
      inflightCoordinates.delete(cacheKey);
    });

  inflightCoordinates.set(cacheKey, task);
  return task;
};

const getCity = (address: NominatimAddress) =>
  address.city ?? address.town ?? address.municipality ?? address.county ?? "";

const getStateCode = (address: NominatimAddress) => {
  const iso = address["ISO3166-2-lvl4"];
  if (iso && iso.includes("-")) {
    return iso.split("-")[1] ?? address.state ?? "";
  }
  return address.state ?? "";
};

const getSuburb = (address: NominatimAddress) =>
  address.suburb ??
  address.neighbourhood ??
  address.quarter ??
  address.city_district ??
  "";

const getRoad = (address: NominatimAddress) =>
  address.road ??
  address.pedestrian ??
  address.residential ??
  address.footway ??
  address.cycleway ??
  address.path ??
  address.service ??
  "";

const mapResult = (result: NominatimResult | null): CepMapped | null => {
  if (!result?.address) return null;
  const address = result.address;
  const road = getRoad(address);

  return {
    endereco: road || null,
    bairro: getSuburb(address) || null,
    cidade: getCity(address) || null,
    uf: getStateCode(address) || null,
    cep: address.postcode ?? null,
  };
};

const fetchNominatim = async (
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<NominatimResult[]> =>
  enqueue(async () => {
    const search = new URLSearchParams({
      format: "json",
      addressdetails: "1",
      limit: "1",
      ...params,
    });
    const data = await fetchJsonWithRetry<NominatimResult[]>(`${BASE_URL}?${search.toString()}`, signal);
    return data ?? [];
  }, signal);

const fetchNominatimReverse = async (
  lat: string,
  lon: string,
  signal?: AbortSignal,
): Promise<NominatimResult | null> =>
  enqueue(async () => {
    const search = new URLSearchParams({
      format: "json",
      addressdetails: "1",
      zoom: "18",
      lat,
      lon,
    });
    const data = await fetchJsonWithRetry<NominatimResult | null>(`${REVERSE_URL}?${search.toString()}`, signal);
    return data ?? null;
  }, signal);

const mergeMapped = (primary: CepMapped | null, secondary: CepMapped | null): CepMapped | null => {
  if (!primary && !secondary) return null;
  return {
    cep: secondary?.cep ?? primary?.cep ?? null,
    endereco: secondary?.endereco ?? primary?.endereco ?? null,
    bairro: secondary?.bairro ?? primary?.bairro ?? null,
    cidade: secondary?.cidade ?? primary?.cidade ?? null,
    uf: secondary?.uf ?? primary?.uf ?? null,
    complemento: secondary?.complemento ?? primary?.complemento ?? null,
  };
};

export const fetchNominatimByCep = async (cep: string, signal?: AbortSignal) => {
  const normalized =
    cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
  const data = await fetchNominatim(
    {
      postalcode: normalized,
      country: "Brazil",
    },
    signal,
  );
  const primary = mapResult(data[0] ?? null);
  const hasRoad = Boolean(primary?.endereco?.trim());
  const lat = data[0]?.lat;
  const lon = data[0]?.lon;
  if (hasRoad || !lat || !lon) {
    return primary;
  }
  try {
    const reverse = await fetchNominatimReverse(lat, lon, signal);
    const secondary = mapResult(reverse);
    return mergeMapped(primary, secondary);
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw err;
    }
    return primary;
  }
};

export const fetchNominatimByAddress = async (
  road: string,
  city: string,
  state: string,
  signal?: AbortSignal,
) => {
  const normalizedRoad = road.replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
  const normalizedCity = city.replace(/\s+/g, " ").trim();
  const normalizedState = state.replace(/\s+/g, " ").trim();

  const strictData = await fetchNominatim(
    {
      street: normalizedRoad,
      city: normalizedCity,
      state: normalizedState,
      country: "Brazil",
    },
    signal,
  );
  const strictMapped = mapResult(strictData[0] ?? null);
  if (strictMapped) return strictMapped;

  const queryData = await fetchNominatim(
    {
      q: `${normalizedRoad}, ${normalizedCity}, ${normalizedState}, Brasil`,
    },
    signal,
  );
  return mapResult(queryData[0] ?? null);
};

export const fetchNominatimCoordinatesByAddress = async (
  road: string,
  city: string,
  state: string,
  signal?: AbortSignal,
): Promise<NominatimCoordinates | null> => {
  const normalizedRoad = road.replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
  const normalizedCity = city.replace(/\s+/g, " ").trim();
  const normalizedState = state.replace(/\s+/g, " ").trim();
  const cacheKey = `ADDR:${normalizeCoordinateKeyPart(normalizedRoad)}|${normalizeCoordinateKeyPart(normalizedCity)}|${normalizeCoordinateKeyPart(normalizedState)}`;
  return withCoordinateCache(cacheKey, async () => {
    const data = await fetchNominatim(
      {
        street: normalizedRoad,
        city: normalizedCity,
        state: normalizedState,
        country: "Brazil",
      },
      signal,
    );

    let first = data[0] ?? null;
    if (!first?.lat || !first?.lon) {
      const queryData = await fetchNominatim(
        {
          q: `${normalizedRoad}, ${normalizedCity}, ${normalizedState}, Brasil`,
        },
        signal,
      );
      first = queryData[0] ?? null;
    }
    if (!first?.lat || !first?.lon) return null;

    const latitude = Number(first.lat);
    const longitude = Number(first.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return {
      latitude,
      longitude,
      mapped: mapResult(first),
    };
  });
};

export const fetchNominatimCoordinatesByQuery = async (
  query: string,
  signal?: AbortSignal,
): Promise<NominatimCoordinates | null> => {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const cacheKey = `Q:${normalizeCoordinateKeyPart(normalizedQuery)}`;
  return withCoordinateCache(cacheKey, async () => {
    const data = await fetchNominatim(
      {
        q: normalizedQuery,
      },
      signal,
    );
    const first = data[0] ?? null;
    if (!first?.lat || !first?.lon) return null;

    const latitude = Number(first.lat);
    const longitude = Number(first.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return {
      latitude,
      longitude,
      mapped: mapResult(first),
    };
  });
};
