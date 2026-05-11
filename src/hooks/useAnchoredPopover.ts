import { useCallback, useEffect, useState, type RefObject } from "react";

type PopoverPosition = { top: number; left: number };

type UseAnchoredPopoverOptions = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  popoverRef: RefObject<HTMLElement | null>;
  onRequestClose: () => void;
  getPosition: (anchorRect: DOMRect, viewport: { width: number; height: number }) => PopoverPosition;
};

export const useAnchoredPopover = ({
  open,
  anchorRef,
  popoverRef,
  onRequestClose,
  getPosition,
}: UseAnchoredPopoverOptions) => {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const recomputePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPosition(
      getPosition(rect, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, [anchorRef, getPosition]);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => {
      recomputePosition();
    });

    const handleWindowChange = () => recomputePosition();
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [open, recomputePosition]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const path = event.composedPath?.() ?? [];
      const insideAnchor = Boolean(
        anchorRef.current && (anchorRef.current.contains(target) || path.includes(anchorRef.current)),
      );
      const insidePopover = Boolean(
        popoverRef.current && (popoverRef.current.contains(target) || path.includes(popoverRef.current)),
      );
      if (insideAnchor || insidePopover) return;
      onRequestClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onRequestClose();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onRequestClose, anchorRef, popoverRef]);

  return { position, recomputePosition };
};
