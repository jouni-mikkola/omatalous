/** A filter that is on, with the × that takes it off: the merchant of Tapahtumat, Arkiostot of Kauppiaat. */
export function FilterChip({ label, removeLabel, onRemove }: { label: string; removeLabel: string; onRemove: () => void }) {
  return (
    <span className="badge">
      {label}{" "}
      <button className="icon-btn" type="button" onClick={onRemove} aria-label={removeLabel}>
        ×
      </button>
    </span>
  );
}
