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

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 p-4"
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
