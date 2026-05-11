type NormalizeCase = "none" | "lower" | "upper";

type NormalizeOptions = {
  letterCase?: NormalizeCase;
  collapseWhitespace?: boolean;
  trim?: boolean;
  stripNonAlphanumeric?: boolean;
};

const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const WHITESPACE_REGEX = /\s+/g;
const NON_ALPHANUMERIC_REGEX = /[^A-Za-z0-9]+/g;

export const normalizeText = (
  value: string | null | undefined,
  options: NormalizeOptions = {},
) => {
  const {
    letterCase = "none",
    collapseWhitespace = true,
    trim = true,
    stripNonAlphanumeric = false,
  } = options;

  let normalized = (value ?? "")
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "");

  if (stripNonAlphanumeric) {
    normalized = normalized.replace(NON_ALPHANUMERIC_REGEX, " ");
  }

  if (collapseWhitespace) {
    normalized = normalized.replace(WHITESPACE_REGEX, " ");
  }

  if (trim) {
    normalized = normalized.trim();
  }

  if (letterCase === "lower") {
    return normalized.toLowerCase();
  }

  if (letterCase === "upper") {
    return normalized.toUpperCase();
  }

  return normalized;
};

export const normalizeSearchText = (value: string | null | undefined) =>
  normalizeText(value, { letterCase: "lower" });
