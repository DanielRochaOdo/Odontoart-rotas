const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export const formatDateBr = (value: string | null | undefined, fallback = "-") => {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  const dateOnlyMatch = DATE_ONLY_REGEX.exec(trimmed);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[3]}/${dateOnlyMatch[2]}/${dateOnlyMatch[1]}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
};

export const formatDateTimeBr = (value: string | null | undefined, fallback = "-") => {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
};
