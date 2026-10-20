/** The one switch between a part's chart and its table: both choices always in sight, the chosen one pressed. */
export function TableToggle({ table, onChange }: { table: boolean; onChange: (table: boolean) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Näkymä">
      <button type="button" aria-pressed={!table} onClick={() => onChange(false)}>
        Kaavio
      </button>
      <button type="button" aria-pressed={table} onClick={() => onChange(true)}>
        Taulukko
      </button>
    </div>
  );
}
