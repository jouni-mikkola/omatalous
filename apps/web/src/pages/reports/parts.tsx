import type { ReactNode } from "react";
import { Figure } from "../../components/Figure.tsx";

/** Under a table of expense categories when one of them totals below zero (Categories and Pivot say it alike). */
export const NEGATIVE_TOTAL_NOTE = "Miinuksella olevassa kategoriassa palautuksia oli jaksolla enemmän kuin menoja.";

export function ExportLink({ href }: { href: string }) {
  return (
    <a className="btn btn-small" href={href} download>
      Lataa CSV
    </a>
  );
}

/** Label and figure pairs; a third item wraps the figure (the button that opens its rows). */
export function Kv({ items }: { items: ([string, string] | [string, string, (figure: ReactNode) => ReactNode])[] }) {
  return (
    <div className="kv">
      {items.map(([k, v, wrap]) => (
        <div key={k}>
          <div className="k">{k}</div>
          <div className="v">{wrap ? wrap(<Figure text={v} size="m" />) : <Figure text={v} size="m" />}</div>
        </div>
      ))}
    </div>
  );
}
