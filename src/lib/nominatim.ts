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

const BASE_URL = "https://nominatim.openstreetmap.org/search";
const REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

let lastRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

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
    const wait = Math.max(0, 1000 - (now - lastRequestAt));
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
    const response = await fetch(`${BASE_URL}?${search.toString()}`, {
      signal,
      headers: {
        "Accept-Language": "pt-BR",
      },
    });
    if (!response.ok) {
      throw new Error("Falha ao consultar endereco.");
    }
    const data = (await response.json()) as NominatimResult[];
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
    const response = await fetch(`${REVERSE_URL}?${search.toString()}`, {
      signal,
      headers: {
        "Accept-Language": "pt-BR",
      },
    });
    if (!response.ok) {
      throw new Error("Falha ao consultar endereco.");
    }
    const data = (await response.json()) as NominatimResult | null;
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
  const data = await fetchNominatim(
    {
      street: road,
      city,
      state,
      country: "Brazil",
    },
    signal,
  );
  return mapResult(data[0] ?? null);
};
