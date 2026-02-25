export const PERFIL_VISITA_PRESETS = [
  "Manhã",
  "Tarde",
  "Manhã e tarde",
  "Horário comercial",
  "Dia todo",
] as const;

export const isPresetPerfilVisita = (value: string) =>
  PERFIL_VISITA_PRESETS.includes(value as (typeof PERFIL_VISITA_PRESETS)[number]);

export const isCustomTimeValue = (value: string | null) => {
  if (!value) return false;
  return /^\d{2}:\d{2}$/.test(value);
};

export const normalizePerfilVisita = (value: string | null) => (value ?? "").trim();
