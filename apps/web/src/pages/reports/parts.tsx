import type { ReactNode } from "react";
import type { ReportSection } from "./types.ts";

/** The card around one section: its id and title come from the section's own declaration. */
export function Section({ section, sub, actions, children }: { section: ReportSection; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" id={section.id}>
      <div className="card-head">
        <div>
          <h2>{section.title}</h2>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        {actions && <div className="form-row" style={{ margin: 0 }}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function ExportLink({ href }: { href: string }) {
  return (
    <a className="btn btn-small" href={href} download>
      Lataa CSV
    </a>
  );
}

export function TableToggle({ table, onToggle }: { table: boolean; onToggle: () => void }) {
  return (
    <button className="btn btn-small" onClick={onToggle} aria-pressed={table}>
      {table ? "Kaavio" : "Taulukko"}
    </button>
  );
}

export function Kv({ items }: { items: [string, string][] }) {
  return (
    <div className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="k">{k}</div>
          <div className="v">{v}</div>
        </div>
      ))}
    </div>
  );
}
