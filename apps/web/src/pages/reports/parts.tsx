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

export function Kv({ items }: { items: [string, string][] }) {
  return (
    <div className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="k">{k}</div>
          <div className="v">
            <Figure text={v} size="m" />
          </div>
        </div>
      ))}
    </div>
  );
}
