import { normalizeText } from "./textNormalize";

export const CATEGORIA_OPTIONS = [
  "Inativo",
  "So perda",
  "Queda",
  "Crescimento",
  "So ganho",
  "Neutro",
] as const;

export const CATEGORIA_FILTER_SEM_CATEGORIA = "Sem categoria" as const;

export type CategoriaValue = (typeof CATEGORIA_OPTIONS)[number];

export const CATEGORIA_DESCRIPTIONS: Record<CategoriaValue, string> = {
  Inativo: "Nao teve venda e cancelamento",
  "So perda": "Teve saidas e nao teve entradas",
  Queda: "Saidas maiores que entradas",
  Crescimento: "Entradas maiores que saidas",
  "So ganho": "Teve entradas e nao teve saidas",
  Neutro: "Entradas e saidas em quantidades iguais",
};

const normalizeCategoriaKey = (value: string) =>
  normalizeText(value, { letterCase: "upper" });

export const buildCategoriaRawMap = () => {
  const rawMap = new Map<string, string[]>();

  rawMap.set(normalizeCategoriaKey("Inativo"), ["Inativo", "INATIVO"]);
  rawMap.set(normalizeCategoriaKey("So perda"), [
    "So perda",
    "SO PERDA",
    "Só perda",
    "SÓ PERDA",
  ]);
  rawMap.set(normalizeCategoriaKey("Queda"), ["Queda", "QUEDA"]);
  rawMap.set(normalizeCategoriaKey("Crescimento"), ["Crescimento", "CRESCIMENTO"]);
  rawMap.set(normalizeCategoriaKey("So ganho"), [
    "So ganho",
    "SO GANHO",
    "Só venda",
    "SÓ VENDA",
  ]);
  rawMap.set(normalizeCategoriaKey("Neutro"), ["Neutro", "NEUTRO"]);

  return rawMap;
};

export const CATEGORIA_LEGEND_ITEMS: Array<{
  value: CategoriaValue;
  description: string;
  className: string;
}> = [
  {
    value: "Inativo",
    description: CATEGORIA_DESCRIPTIONS.Inativo,
    className: "bg-white text-ink",
  },
  {
    value: "So perda",
    description: CATEGORIA_DESCRIPTIONS["So perda"],
    className: "bg-[#facc15] text-black",
  },
  {
    value: "Queda",
    description: CATEGORIA_DESCRIPTIONS.Queda,
    className: "bg-[#ef4444] text-black",
  },
  {
    value: "Crescimento",
    description: CATEGORIA_DESCRIPTIONS.Crescimento,
    className: "bg-[#a3e635] text-black",
  },
  {
    value: "So ganho",
    description: CATEGORIA_DESCRIPTIONS["So ganho"],
    className: "bg-[#22c55e] text-black",
  },
  {
    value: "Neutro",
    description: CATEGORIA_DESCRIPTIONS.Neutro,
    className: "bg-[#22d3ee] text-black",
  },
];
