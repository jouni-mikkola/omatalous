// Diverging bars for a change: a rise grows right of a grey midline in --rise, a fall left of it in --fall, all on one scale.
// Each row carries its own figures as text (the answer's), so the bar only shows size and direction.
import type { ReactNode } from "react";
import "../styles/charts.css";
import "../styles/step-charts.css";

export interface ChangeRow {
  key: string;
  label: ReactNode;
  /** The change the bar draws, in any unit; the sign is the direction. */
  value: number;
  /** The change in words, at the bar's end. */
  text: string;
  /** A quieter second line under the label. */
  sub?: string;
  /** Read by a screen reader instead of the parts. */
  aria: string;
}

export function ChangeBars({ rows, label, picked = null, onPick }: { rows: readonly ChangeRow[]; label: string; picked?: string | null; onPick?: (key: string) => void }) {
  const top = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="shift-bars" role="list" aria-label={label}>
      {rows.map((r) => {
        const width = (Math.abs(r.value) / top) * 50;
        const body = (
          <>
            <span className="sb-label">
              {r.label}
              {r.sub && <span className="sb-sub">{r.sub}</span>}
            </span>
            <span className="sb-track" aria-hidden="true">
              <i className="sb-mid" />
              <i className={`sb-bar ${r.value >= 0 ? "sb-rise" : "sb-fall"}`} style={r.value >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }} />
            </span>
            <span className="sb-value">{r.text}</span>
          </>
        );
        return (
          <div key={r.key} role="listitem" className={`sb-row${picked === r.key ? " picked" : ""}`}>
            {onPick ? (
              <button type="button" className="sb-step" aria-label={r.aria} aria-pressed={picked === r.key} onClick={() => onPick(r.key)}>
                {body}
              </button>
            ) : (
              <div className="sb-step" aria-label={r.aria}>
                {body}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
