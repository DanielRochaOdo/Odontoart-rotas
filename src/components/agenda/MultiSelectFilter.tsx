import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Filter } from "lucide-react";

type MultiSelectFilterProps = {
  label: string;
  options: string[];
  value: string[];
  onApply: (next: string[]) => void;
  onOpen?: () => void;
};

const makeFieldId = (label: string) =>
  `agenda-filter-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export default function MultiSelectFilter({
  label,
  options,
  value,
  onApply,
  onOpen,
}: MultiSelectFilterProps) {
  const debug = Boolean(import.meta.env?.DEV);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const fieldId = useMemo(() => makeFieldId(label), [label]);

  useEffect(() => {
    if (!debug) return;
    console.log("[MultiSelectFilter] state", { label, open });
  }, [debug, label, open]);

  useEffect(() => {
    if (!debug) return;
    console.log("[MultiSelectFilter] position", { label, position });
  }, [debug, label, position]);

  useEffect(() => {
    if (!debug) return;
    return () => {
      console.log("[MultiSelectFilter] unmount", { label });
    };
  }, [debug, label]);

  const computePosition = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = 256;
    const gap = 8;
    const padding = 12;
    let left = rect.left;
    if (left + width > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - width - padding);
    }
    const top = rect.bottom + gap;
    setPosition({ top, left });
  };

  const openMenu = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (debug) {
      console.log("[MultiSelectFilter] pointerdown trigger", {
        label,
        open,
        target: (event.target as HTMLElement | null)?.tagName,
      });
    }
    if (open) {
      setOpen(false);
      return;
    }
    setDraft(value);
    setQuery("");
    onOpen?.();
    setOpen(true);
    computePosition();
  };

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options;
    const term = query.toLowerCase();
    return options.filter((option) => option.toLowerCase().includes(term));
  }, [options, query]);

  const toggleValue = (option: string) => {
    setDraft((prev) =>
      prev.includes(option) ? prev.filter((item) => item !== option) : [...prev, option],
    );
  };

  useEffect(() => {
    if (!open) return;
    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const path = event.composedPath?.() ?? [];
      const isInside = [buttonRef, popoverRef].some((ref) => {
        const element = ref.current;
        if (!element) return false;
        return element.contains(target) || path.includes(element);
      });
      if (debug) {
        console.log("[MultiSelectFilter] document pointerdown", {
          label,
          isInside,
          target: (event.target as HTMLElement | null)?.tagName,
        });
      }
      if (isInside) return;
      if (debug) {
        console.log("[MultiSelectFilter] close by outside pointerdown", {
          label,
          target: (event.target as HTMLElement | null)?.tagName,
        });
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", handler, true);
    return () => {
      document.removeEventListener("pointerdown", handler, true);
    };
  }, [open, debug, label]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (debug) {
          console.log("[MultiSelectFilter] close by ESC", { label });
        }
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, debug, label]);

  useEffect(() => {
    if (!open) return;
    computePosition();
    const handler = () => computePosition();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [open]);

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
          if (debug) {
            console.log("[MultiSelectFilter] click trigger", { label });
          }
        }}
        className="relative inline-flex h-6 w-6 items-center justify-center rounded-md border border-sea/20 bg-white/80 text-ink/50 transition hover:border-sea hover:text-sea"
        aria-label={label}
        title={label}
      >
        <Filter size={12} />
        {value.length > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sea px-1 text-[10px] font-semibold text-white">
            {value.length}
          </span>
        ) : null}
      </button>

      {open && position
        ? createPortal(
          <div
              ref={popoverRef}
              className="fixed z-[9999] w-64 rounded-2xl border border-sea/20 bg-white p-3 shadow-xl"
              style={{ top: position.top, left: position.left }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-ink/60">Filtro</p>
                <button
                  type="button"
                  className="text-xs text-sea"
                  onClick={() => {
                    setDraft([]);
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
                className="mt-2 w-full rounded-lg border border-sea/20 bg-white/90 px-2 py-1 text-xs outline-none focus:border-sea"
              />

              <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                {filteredOptions.length === 0 ? (
                  <p className="text-xs text-ink/60">Nenhuma opcao</p>
                ) : (
                  filteredOptions.map((option) => {
                    const checked = draft.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggleValue(option)}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs text-ink hover:bg-sea/10"
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
                  className="text-xs text-ink/60"
                  onClick={() => setDraft(filteredOptions)}
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-sea px-3 py-1 text-xs font-semibold text-white shadow"
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
