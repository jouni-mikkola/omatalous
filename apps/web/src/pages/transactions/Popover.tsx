/**
 * A panel that opens under the control that asked for it: the category picker, the filter chips' lists and the date
 * range. It closes on Escape, on a click outside and when a choice is made, and gives focus back to its control. On a
 * phone it is a sheet at the bottom of the screen (transactions.css), where a thumb reaches it.
 */
import { type ReactNode, type RefObject, useEffect, useRef } from "react";

export function Popover({ open, onClose, anchor, label, className, children }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement | null>; label: string; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
      anchor.current?.focus();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    // the first field or option takes focus, so the keyboard goes on where the eye goes
    box.current?.querySelector<HTMLElement>("input, [role=option], button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return (
    <div ref={box} className={`tx-pop${className ? ` ${className}` : ""}`} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
