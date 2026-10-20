/**
 * The frame of a rich table and the controls every one shares: the density, the column choice and the button that opens
 * a row (the sort is sort.ts, the sortable head Cells.tsx). The rows stay the page's own markup (a page has its own cells, links and pickers); rich-table.css gives them the
 * sticky head, the group rows with their subtotals and, with `cards`, the card layout of a phone.
 */
import { useState, type ReactNode } from "react";
import "../../styles/rich-table.css";

export type Density = "compact" | "comfortable";

const readDensity = (key: string): Density => {
  try {
    return localStorage.getItem(`density:${key}`) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
};

/** The density of one table, kept per browser: a household member who wants more rows on a screen asks once. */
export function useDensity(key: string): [Density, (d: Density) => void] {
  const [density, setDensity] = useState<Density>(() => readDensity(key));
  const set = (d: Density) => {
    setDensity(d);
    try {
      localStorage.setItem(`density:${key}`, d);
    } catch {
      // a private window keeps the choice for this page only
    }
  };
  return [density, set];
}

const readHidden = (key: string): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(`columns:${key}`) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** The optional columns a table hides, kept per browser like the density. Every optional column shows until it is switched off. */
export function useColumns(key: string): [ReadonlySet<string>, (column: string) => void] {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(readHidden(key)));
  const toggle = (column: string) => {
    const next = new Set(hidden);
    if (!next.delete(column)) next.add(column);
    setHidden(next);
    try {
      localStorage.setItem(`columns:${key}`, JSON.stringify([...next]));
    } catch {
      // a private window keeps the choice for this page only
    }
  };
  return [hidden, toggle];
}

export function DensitySwitch({ density, onChange }: { density: Density; onChange: (d: Density) => void }) {
  return (
    <div className="segmented rt-density" role="group" aria-label="Rivien tiheys">
      <button type="button" aria-pressed={density === "comfortable"} onClick={() => onChange("comfortable")}>
        Väljä
      </button>
      <button type="button" aria-pressed={density === "compact"} onClick={() => onChange("compact")}>
        Tiivis
      </button>
    </div>
  );
}

/** The button that opens a row's detail under it. Its name says what opens, not "Näytä tapahtumat", which Miksi? uses. */
export function DrillButton({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className="rt-drill" aria-expanded={open} aria-label={label} onClick={onToggle}>
      <span aria-hidden="true">›</span>
    </button>
  );
}

/**
 * The frame. `cards` lays each row out as a card under 600 px (the cells with a `data-label` say it before their value);
 * `scroll` lets a wide matrix scroll sideways there with its first column kept; without either the page has a phone
 * layout of its own, as Tapahtumat does. `live` is the polite sentence a sort changed ("Järjestetty: Summa, suurin ensin").
 */
export function RichTable({
  density,
  label,
  cards,
  scroll,
  live,
  className,
  children,
}: {
  density: Density;
  label?: string;
  cards?: boolean;
  scroll?: boolean;
  live?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rt-wrap${scroll ? " rt-wrap-scroll" : ""}`}>
      <table className={`rt rt-${density}${cards ? " rt-cards" : ""}${scroll ? " rt-scroll" : ""}${className ? ` ${className}` : ""}`} aria-label={label}>
        {children}
      </table>
      {live !== undefined && (
        <div className="sr-only" role="status" aria-live="polite">
          {live}
        </div>
      )}
    </div>
  );
}
