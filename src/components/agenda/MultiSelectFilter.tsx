import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

const useClickOutside = (ref: React.RefObject<HTMLDivElement>, handler: () => void) => {
  useEffect(() => {
    const listener = (event: MouseEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      handler();
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [handler, ref]);
};

type MultiSelectFilterProps = {
  label: string;
  options: string[];
  value: string[];
  onApply: (next: string[]) => void;
  onOpen?: () => void;
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

  useClickOutside(containerRef, () => setOpen(false));

  useEffect(() => {
    if (open) {
      setDraft(value);
      onOpen?.();
    }
  }, [open, onOpen, value]);

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

  return (
    <div ref={containerRef} className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="inline-flex items-center gap-1 rounded-lg border border-mist/70 px-2 py-1 text-xs font-semibold text-muted hover:border-sea/60 hover:text-sea"
      >
        {label}
        <ChevronDown size={14} />
      </button>

      {open ? (
        <div
          className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-mist/70 bg-white p-3 shadow-card"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted">Filtro</p>
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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar..."
            className="mt-2 w-full rounded-lg border border-mist px-2 py-1 text-xs outline-none focus:border-sea"
          />

          <div className="mt-2 max-h-40 space-y-1 overflow-auto">
            {filteredOptions.length === 0 ? (
              <p className="text-xs text-muted">Nenhuma opcao</p>
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
              className="text-xs text-muted"
              onClick={() => setDraft(filteredOptions)}
            >
              Selecionar todos
            </button>
            <button
              type="button"
              className="rounded-lg bg-sea px-3 py-1 text-xs font-semibold text-white"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              Aplicar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
