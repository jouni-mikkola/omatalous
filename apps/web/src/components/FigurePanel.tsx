// Decision: which figure to plan with, by reading what it is made of
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { t } from "../text.ts";
import "../styles/figure-panel.css";

/**
 * A figure that opens its own sum: the figure is a button, and the panel under it holds the parts the caller gives
 * (the figure's owner computed them, the panel adds up nothing). It closes on Escape, on a click outside, when focus
 * leaves it and with its own button, and gives focus back to the figure. Under 640 px it stands in the middle of the
 * screen over a backdrop that is an element of its own, so the press that closes it reaches nothing under it.
 */
export function FigurePanel({ figure, label, children }: { figure: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    panel.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div
      ref={wrap}
      className="fig-panel"
      onBlur={(e) => {
        // a null target is the window losing focus or a press on something that takes none, which the pointer handler covers
        if (open && e.relatedTarget instanceof Node && !wrap.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button ref={button} type="button" className="fig-open" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
        {figure}
      </button>
      {open && <div className="fig-backdrop" onClick={() => setOpen(false)} />}
      {open && (
        <div ref={panel} id={id} className="fig-pop" role="dialog" aria-label={label} tabIndex={-1}>
          <p className="fig-pop-title">{label}</p>
          {children}
          <button
            type="button"
            className="fig-pop-close"
            onClick={() => {
              setOpen(false);
              button.current?.focus();
            }}
          >
            {t("ui.close")}
          </button>
        </div>
      )}
    </div>
  );
}
