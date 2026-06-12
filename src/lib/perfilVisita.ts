import { normalizeText } from "./textNormalize";

const stripAccents = (value: string) => normalizeText(value);
const PERFIL_VISITA_SPLIT_REGEX = /\s*[,;|]\s*/;

export const normalizePerfilVisita = (value: string | null) =>
  stripAccents((value ?? "").trim()).toUpperCase();

export const normalizePerfilVisitaValue = (value: string | null) => {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  const parts = raw
    .replace(/\u2022/g, ",")
    .split(PERFIL_VISITA_SPLIT_REGEX)
    .map((item) => normalizePerfilVisita(item))
    .filter(Boolean);

  if (parts.length === 0) return null;

  const uniqueParts: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    uniqueParts.push(part);
  }

  return uniqueParts.join(", ");
};

export const PERFIL_VISITA_PRESETS = [
  "HORARIO COMERCIAL",
  "ALMOCO",
  "JANTAR",
] as const;

export const PERFIL_VISITA_SINGLE_TIME_BASES = ["ALMOCO", "JANTAR"] as const;

export const getSingleTimePerfilBase = (value: string | null) => {
  const normalized = normalizePerfilVisita(value);
  const base = PERFIL_VISITA_SINGLE_TIME_BASES.find(
    (item) => normalized === item || normalized.startsWith(`${item} `),
  );
  return base ?? null;
};

export const getSingleTimePerfilValue = (value: string | null) => {
  const base = getSingleTimePerfilBase(value);
  if (!base) return "";
  const [first] = extractCustomTimes(value);
  return first ?? "";
};

export const isPresetPerfilVisita = (value: string) =>
  PERFIL_VISITA_PRESETS.includes(
    normalizePerfilVisita(value) as (typeof PERFIL_VISITA_PRESETS)[number],
  ) ||
  Boolean(getSingleTimePerfilBase(value));

export const extractCustomTimes = (value: string | null) => {
  if (!value) return [];
  const matches = value.match(/\b\d{2}:\d{2}\b/g) ?? [];
  return Array.from(new Set(matches));
};

export const isCustomTimeValue = (value: string | null) =>
  extractCustomTimes(value).length > 0;
