import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

type DashboardModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
};

export default function DashboardModal({
  open,
  title,
  subtitle,
  onClose,
  children,
  maxWidthClassName = "max-w-2xl",
}: DashboardModalProps) {
  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const scrollY = window.scrollY;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      window.scrollTo(0, scrollY);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-start justify-center bg-black/50 px-4 pt-6 overscroll-contain"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        className={[
          "relative w-full rounded-3xl border border-sea/20 bg-white p-6 shadow-card",
          "max-h-[85dvh] overflow-hidden",
          maxWidthClassName,
        ].join(" ")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg text-ink">{title}</h3>
            {subtitle ? <p className="mt-1 text-xs text-ink/60">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-sea/30 bg-white px-3 py-1 text-xs text-ink/70 hover:border-sea"
          >
            Fechar
          </button>
        </div>
        <div className="mt-4 max-h-[calc(85dvh-88px)] overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
