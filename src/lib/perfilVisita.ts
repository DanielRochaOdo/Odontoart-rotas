const stripAccents = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const normalizePerfilVisita = (value: string | null) =>
  stripAccents((value ?? "").trim()).toUpperCase();

export const PERFIL_VISITA_PRESETS = [
  "MANHA",
  "TARDE",
  "MANHA E TARDE",
  "HORARIO COMERCIAL",
  "DIA TODO",
] as const;

export const isPresetPerfilVisita = (value: string) =>
  PERFIL_VISITA_PRESETS.includes(
    normalizePerfilVisita(value) as (typeof PERFIL_VISITA_PRESETS)[number],
  );

export const extractCustomTimes = (value: string | null) => {
  if (!value) return [];
  const matches = value.match(/\b\d{2}:\d{2}\b/g) ?? [];
  return Array.from(new Set(matches));
};

export const isCustomTimeValue = (value: string | null) =>
  extractCustomTimes(value).length > 0;
