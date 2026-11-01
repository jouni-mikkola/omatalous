import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";
import { cx } from "./cx.ts";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  ariaLabel?: string;
}

/**
 * Views of one subject, one shown at a time: a real tablist (arrow keys, Home and End move between the tabs, only the
 * chosen tab is in the tab order) and the panel it names. The tabs choose; the children are the chosen panel.
 */
export function Tabs<T extends string>({ label, value, tabs, onChange, children, className, panelClassName }: {
  label: string;
  value: T;
  tabs: readonly TabItem<T>[];
  onChange: (id: T) => void;
  children?: ReactNode;
  className?: string;
  panelClassName?: string;
}) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const idOf = (id: string) => `${base}-tab-${id}`;
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.id === value);
    const to = e.key === "ArrowRight" ? (at + 1) % tabs.length : e.key === "ArrowLeft" ? (at - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    const next = tabs[to]!;
    onChange(next.id);
    list.current?.querySelector<HTMLElement>(`[id="${idOf(next.id)}"]`)?.focus();
  };
  return (
    <>
      <div ref={list} className={cx("tabs", className)} role="tablist" aria-label={label} onKeyDown={move}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={idOf(t.id)} aria-selected={t.id === value} aria-controls={`${base}-panel`} aria-label={t.ariaLabel} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {children !== undefined && (
        <div id={`${base}-panel`} role="tabpanel" aria-labelledby={idOf(value)} className={panelClassName}>
          {children}
        </div>
      )}
    </>
  );
}
