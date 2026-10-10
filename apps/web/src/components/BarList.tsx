export interface BarItem {
  key: string;
  label: string;
  value: number;
  valueText: string;
  sub?: string;
  color: string;
  /** False for a row that has nowhere to go (the folded "Muut"). */
  link?: boolean;
}

/** Horizontal bars with the value at the tip; a row with somewhere to go is a button. */
export function BarList({ items, onSelect }: { items: BarItem[]; onSelect?: (key: string) => void }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  if (!items.length) return <div className="empty">Ei menoja valitulla jaksolla.</div>;
  return (
    <div className="barlist">
      {items.map((item) => {
        const body = (
          <>
            <span className="barlist-label">
              <i className="swatch" style={{ background: item.color }} />
              {item.label}
            </span>
            <span className="barlist-track">
              <span className="barlist-bar" style={{ display: "block", width: `${(item.value / max) * 100}%`, background: item.color }} />
            </span>
            <span className="barlist-value">
              {item.valueText}
              {item.sub && <small>{item.sub}</small>}
            </span>
          </>
        );
        return onSelect && item.link !== false ? (
          <button key={item.key} type="button" className="barlist-row" onClick={() => onSelect(item.key)} title={`Näytä tapahtumat: ${item.label}`}>
            {body}
          </button>
        ) : (
          <div key={item.key} className="barlist-row barlist-static">
            {body}
          </div>
        );
      })}
    </div>
  );
}
