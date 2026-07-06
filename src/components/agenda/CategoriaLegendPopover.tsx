import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";
import { CATEGORIA_LEGEND_ITEMS } from "../../lib/categorias";

export default function CategoriaLegendPopover() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const noWrapText = (value: string) => value.replace(/\s/g, "\u00A0");
  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const getPosition = useCallback((rect: DOMRect, viewport: { width: number; height: number }) => {
    const width = Math.min(540, Math.max(360, viewport.width - 24));
    const gap = 8;
    const padding = 12;
    let left = rect.left;
    if (left + width > viewport.width - padding) {
      left = Math.max(padding, viewport.width - width - padding);
    }
    let top = rect.bottom + gap;
    const estimatedHeight = 270;
    if (top + estimatedHeight > viewport.height - padding) {
      top = Math.max(padding, rect.top - estimatedHeight - gap);
    }
    return { top, left };
  }, []);
  const { position, recomputePosition } = useAnchoredPopover({
    open,
    anchorRef: buttonRef,
    popoverRef,
    onRequestClose: () => setOpen(false),
    getPosition,
  });

  const openPopover = () => {
    clearCloseTimer();
    setOpen(true);
    recomputePosition();
  };

  const closePopoverSoon = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 100);
  };

  useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, []);

  return (
    <div className="inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Legenda das categorias"
        title="Legenda das categorias"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-sea/30 bg-white/90 text-[10px] font-bold leading-none text-ink/70 transition hover:border-sea hover:text-sea focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sea/35"
        onPointerEnter={openPopover}
        onPointerLeave={closePopoverSoon}
        onFocus={openPopover}
        onBlur={closePopoverSoon}
      >
        ?
      </button>

      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-[9999] w-[min(540px,calc(100vw-24px))] overflow-x-auto rounded-2xl border border-sea/20 bg-white/95 p-3 shadow-card"
              style={{ top: position.top, left: position.left }}
              onPointerEnter={openPopover}
              onPointerLeave={closePopoverSoon}
            >
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/60">
                Legenda das categorias
              </p>
              <div className="space-y-1.5">
                {CATEGORIA_LEGEND_ITEMS.map((item) => (
                  <div
                    key={item.value}
                    className="flex min-w-max flex-nowrap items-center gap-2 whitespace-nowrap rounded-lg border border-sea/20 bg-white/90 px-2.5 py-2"
                  >
                    <span
                      className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-sea/20 bg-sea/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-sea"
                      style={{
                        whiteSpace: "nowrap",
                        wordBreak: "keep-all",
                        overflowWrap: "normal",
                      }}
                    >
                      {noWrapText(item.value)}
                    </span>
                    <p
                      className="shrink-0 whitespace-nowrap text-[11px] leading-4 text-ink/70"
                      style={{
                        whiteSpace: "nowrap",
                        wordBreak: "keep-all",
                        overflowWrap: "normal",
                      }}
                    >
                      {noWrapText(item.description)}
                    </p>
                  </div>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
