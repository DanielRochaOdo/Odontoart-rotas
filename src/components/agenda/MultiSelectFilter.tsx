import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Filter } from "lucide-react";

const useClickOutside = (
  ref: React.RefObject<HTMLDivElement | null>,
  handler: () => void,
) => {
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

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setDraft(value);
        onOpen?.();
      }
      return next;
    });
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

  return (
    <div ref={containerRef} className="relative z-20" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          handleToggle();
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

      {open ? (
        <div
          className="absolute left-0 z-50 mt-2 w-64 rounded-2xl border border-sea/20 bg-white p-3 shadow-xl"
          onClick={(event) => event.stopPropagation()}
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
        </div>
      ) : null}
    </div>
  );
}
