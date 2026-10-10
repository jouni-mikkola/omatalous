export interface Delta {
  text: string;
  /** Direction of the change and whether that direction is good news. */
  tone: "up-good" | "up-bad" | "down-good" | "down-bad" | "neutral";
  suffix?: string;
}

/**
 * Label · value · delta vs a named period · 12-month sparkline. `foot` takes
 * the delta's place when there is nothing to compare against.
 */
export function StatTile({
  label,
  value,
  delta,
  note,
  foot,
  spark,
}: {
  label: string;
  value: string;
  delta?: Delta;
  note?: string | (string | undefined)[];
  foot?: string;
  spark?: number[];
}) {
  const arrow = delta?.tone.startsWith("up") ? "▲" : delta?.tone.startsWith("down") ? "▼" : "";
  const notes = (Array.isArray(note) ? note : [note]).filter((n): n is string => !!n);
  return (
    <div className="card">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {notes.map((n) => (
        <div key={n} className="tile-note">
          {n}
        </div>
      ))}
      <div className="tile-foot">
        <div className="delta">
          {!delta && foot && <span className="muted">{foot}</span>}
          {delta && (
            <>
              <span className={delta.tone}>
                {arrow && <span aria-hidden="true">{arrow} </span>}
                {delta.text}
              </span>
              {delta.suffix && <span> {delta.suffix}</span>}
            </>
          )}
        </div>
        {spark && spark.length > 1 && <Sparkline values={spark} />}
      </div>
    </div>
  );
}

function Sparkline({ values, width = 84, height = 26 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const x = (i: number) => 3 + (i / (values.length - 1)) * (width - 6);
  const y = (v: number) => 3 + (1 - (v - min) / (max - min || 1)) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ flex: "none" }}>
      <path d={d} fill="none" stroke="var(--series-avg)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last]!)} r={3} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}
