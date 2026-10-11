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
