import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Filter } from "lucide-react";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";
import { normalizeSearchText } from "../../lib/textNormalize";

type MultiSelectFilterProps = {
  label: string;
  options: string[];
  value: string[];
  onApply: (next: string[]) => void;
  onOpen?: () => void;
};

const makeFieldId = (label: string) =>
  `agenda-filter-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const normalizeOptionKey = (value: string) =>
  normalizeSearchText(value).replace(/\s+/g, " ").trim();

const areSameOption = (left: string, right: string) =>
  normalizeOptionKey(left) === normalizeOptionKey(right);

const dedupeOptions = (values: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const key = normalizeOptionKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(value);
  });
  return result;
};

export default function MultiSelectFilter({
  label,
  options,
  value,
  onApply,
  onOpen,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const fieldId = useMemo(() => makeFieldId(label), [label]);
  const optionsByKey = useMemo(() => {
    const map = new Map<string, string>();
    options.forEach((option) => {
      const key = normalizeOptionKey(option);
      if (key && !map.has(key)) {
        map.set(key, option);
      }
    });
    return map;
  }, [options]);
  const canonicalizeValue = useCallback(
    (valueToCanonicalize: string) => {
      const key = normalizeOptionKey(valueToCanonicalize);
      if (!key) return valueToCanonicalize;
      return optionsByKey.get(key) ?? valueToCanonicalize;
    },
    [optionsByKey],
  );
  const normalizedExternalValue = useMemo(
    () => dedupeOptions(value.map((item) => canonicalizeValue(item))),
    [canonicalizeValue, value],
  );
  const mergedOptions = useMemo(
    () => dedupeOptions([...options, ...value.map((item) => canonicalizeValue(item))]),
    [options, canonicalizeValue, value],
  );
  const getPosition = useCallback(
    (rect: DOMRect, viewport: { width: number }) => {
      const width = 256;
      const gap = 8;
      const padding = 12;
      let left = rect.left;
      if (left + width > viewport.width - padding) {
        left = Math.max(padding, viewport.width - width - padding);
      }
      const top = rect.bottom + gap;
      return { top, left };
    },
    [],
  );
  const { position, recomputePosition } = useAnchoredPopover({
    open,
    anchorRef: buttonRef,
    popoverRef,
    onRequestClose: () => setOpen(false),
    getPosition,
  });

  const openMenu = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    setDraft(normalizedExternalValue);
    setQuery("");
    onOpen?.();
    setOpen(true);
    recomputePosition();
  };

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return mergedOptions;
    const term = normalizeSearchText(query);
    return mergedOptions.filter((option) => normalizeSearchText(option).includes(term));
  }, [mergedOptions, query]);

  const toggleValue = (option: string) => {
    const canonical = canonicalizeValue(option);
    setDraft((prev) =>
      prev.some((item) => areSameOption(item, canonical))
        ? prev.filter((item) => !areSameOption(item, canonical))
        : dedupeOptions([...prev, canonical]),
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative z-20"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        ref={buttonRef}
        data-filter-trigger="true"
        onPointerDown={openMenu}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="relative inline-flex h-5 w-5 items-center justify-center rounded-md border border-sea/20 bg-white/80 text-ink/50 transition hover:border-sea hover:text-sea dark:bg-slate-900/60 dark:text-slate-200/60"
        aria-label={label}
        title={label}
      >
        <Filter size={10} />
        {value.length > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-sea px-1 text-[9px] font-semibold text-white">
            {value.length}
          </span>
        ) : null}
      </button>

      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-[9999] w-64 rounded-2xl border border-sea/20 bg-white p-3 shadow-xl dark:border-sea/20 dark:bg-slate-950 dark:text-slate-100"
              style={{ top: position.top, left: position.left }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-ink/60 dark:text-slate-300">Filtro</p>
                <button
                  type="button"
                  className="text-xs text-sea dark:text-seaLight"
                  onClick={() => {
                    setDraft([]);
                    setQuery("");
                    onApply([]);
                    setOpen(false);
                  }}
                >
                  Limpar
                </button>
              </div>

              <input
                id={`${fieldId}-search`}
                name={`${fieldId}-search`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar..."
                className="mt-2 w-full rounded-lg border border-sea/20 bg-white/90 px-2 py-1 text-xs outline-none focus:border-sea dark:border-sea/20 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-500"
              />

              <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                {filteredOptions.length === 0 ? (
                  <p className="text-xs text-ink/60">Nenhuma opcao</p>
                ) : (
                  filteredOptions.map((option) => {
                    const checked = draft.some((item) => areSameOption(item, option));
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggleValue(option)}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs text-ink hover:bg-sea/10 dark:text-slate-200 dark:hover:bg-sea/15"
                      >
                        <span>{option}</span>
                        {checked ? <Check size={14} className="text-sea" /> : null}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  className="text-xs text-ink/60 dark:text-slate-300"
                  onClick={() => setDraft(dedupeOptions(filteredOptions.map((item) => canonicalizeValue(item))))}
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-sea px-3 py-1 text-xs font-semibold text-white shadow dark:bg-seaLight dark:text-slate-950"
                onClick={() => {
                    onApply(draft);
                    setOpen(false);
                  }}
                >
                  Aplicar
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

