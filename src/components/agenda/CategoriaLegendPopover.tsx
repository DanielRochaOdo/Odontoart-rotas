import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CATEGORIA_LEGEND_ITEMS } from "../../lib/categorias";

export default function CategoriaLegendPopover() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const computePosition = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(360, Math.max(280, window.innerWidth - 24));
    const gap = 8;
    const padding = 12;
    let left = rect.left;
    if (left + width > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - width - padding);
    }
    let top = rect.bottom + gap;
    const estimatedHeight = 270;
    if (top + estimatedHeight > window.innerHeight - padding) {
      top = Math.max(padding, rect.top - estimatedHeight - gap);
    }
    setPosition({ top, left });
  };

  const openPopover = () => {
    clearCloseTimer();
    setOpen(true);
    requestAnimationFrame(computePosition);
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

  useEffect(() => {
    if (!open) return;
    computePosition();
    const onWindowChange = () => computePosition();
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    return () => {
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const path = event.composedPath?.() ?? [];
      const insideButton = Boolean(
        buttonRef.current && (buttonRef.current.contains(target) || path.includes(buttonRef.current)),
      );
      const insidePopover = Boolean(
        popoverRef.current && (popoverRef.current.contains(target) || path.includes(popoverRef.current)),
      );
      if (!insideButton && !insidePopover) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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
              className="fixed z-[9999] w-[min(360px,calc(100vw-24px))] rounded-2xl border border-sea/20 bg-white/95 p-3 shadow-card"
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
                    className="flex items-start gap-2 rounded-lg border border-sea/20 bg-white/90 px-2.5 py-2"
                  >
                    <span className="inline-flex rounded-full border border-sea/20 bg-sea/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-sea">
                      {item.value}
                    </span>
                    <p className="pt-[1px] text-[11px] leading-4 text-ink/70">{item.description}</p>
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
