/**
 * The marks of Säästövinkit: an area's glyph, a saving's range on a shared scale, the certainty as three steps and a
 * verdict as a sign. Each draws a figure or a word the row already prints, so all are hidden from a screen reader.
 */
import { AREA_IDS, type AreaId, type CertaintyLevel, type Verdict } from "@banking/core";

/** One 16 px line drawing per area, on a 16 by 16 box: a sign of what the area is about, never a provider's logo. */
const GLYPH: Record<AreaId, string> = {
  loans: "M2.5 8.5 8 4l5.5 4.5M4 7.5v6h8v-6M6.5 13.5v-3h3v3",
  savings: "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11M8 5v6M6 6.5h3a1 1 0 0 1 0 2H7a1 1 0 0 0 0 2h3",
  subscriptions: "M2.5 4h11v8h-11zM7 6.25v3.5L10 8z",
  bank: "M2 6 8 3l6 3M3.5 7v5M6.5 7v5M9.5 7v5M12.5 7v5M2 13.5h12",
  electricity: "M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z",
  housing: "M4 14V2.5h8V14M6.5 5h1M8.5 5h1M6.5 7.5h1M8.5 7.5h1M7 14v-3h2v3",
  insurance: "M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4zM5.75 8l1.5 1.5 3-3",
  food: "M2 6h12l-1.5 7h-9zM5 6l2-3.5M11 6 9 2.5M6 8.5v2M10 8.5v2",
  habits: "M3 6h8v3.5A3.5 3.5 0 0 1 7.5 13h-1A3.5 3.5 0 0 1 3 9.5zM11 7h1a1.5 1.5 0 0 1 0 3h-1",
  seasons: "M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5v3M10.5 2.5v3",
  tax: "M4 2h5.5L12 4.5V14H4zM9.5 2v2.5H12M6 8h4M6 10.5h4",
  kids: "M8 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4M4 13.5a4 4 0 0 1 8 0",
  car: "M2.5 10.5V8L4 4.5h8L13.5 8v2.5zM2.5 10.5v2h2v-2M11.5 10.5v2h2v-2M5 8.25h.5M10.5 8.25h.5",
};

/** The area's glyph on a disc of its own hue: the series follow the order of AREA_IDS, so an area keeps its colour on every visit. */
export function AreaMark({ id, size = 28 }: { id: AreaId; size?: number }) {
  const hue = (AREA_IDS.indexOf(id) % 7) + 1;
  return (
    <span className={`area-mark rt-hue-${hue}`} style={{ inlineSize: size, blockSize: size }} aria-hidden="true">
      <svg viewBox="0 0 16 16" width={size * 0.57} height={size * 0.57} focusable="false">
        <path d={GLYPH[id]} />
      </svg>
    </span>
  );
}

/**
 * A saving's range as a band from low to high with a tick at the mid, on a scale shared by its column (`max`, the
 * largest high beside it). An estimate, so the band is lighter than a bar of a real sum. A range of one figure is the
 * tick alone.
 */
export function RangeBar({ low, mid, high, max }: { low: number; mid: number; high: number; max: number }) {
  if (max <= 0) return null;
  const at = (v: number) => `${((Math.min(v, max) / max) * 100).toFixed(2)}%`;
  return (
    <span className="range-bar" aria-hidden="true">
      <span className="range-band" style={{ insetInlineStart: at(low), inlineSize: `calc(${at(high)} - ${at(low)})` }} />
      <span className="range-mid" style={{ insetInlineStart: at(mid) }} />
    </span>
  );
}

const STEPS: Record<CertaintyLevel, number> = { matala: 1, keskitaso: 2, korkea: 3 };

/** The certainty as three steps beside its word: the word says it, the steps let a column be read at a glance. */
export function CertaintySteps({ level }: { level: CertaintyLevel }) {
  const n = STEPS[level];
  return (
    <span className={`certainty certainty-${level}`}>
      <span className="certainty-steps" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={i <= n ? "on" : ""} />
        ))}
      </span>
      Varmuus {level}
    </span>
  );
}

/** A verdict's sign and word. The tone is a support: the sign and the word carry it without colour. */
export const VERDICT_MARK: Record<Verdict, { sign: string; text: string; tone: "good" | "bad" | "level" }> = {
  vahvistui: { sign: "✓", text: "Vahvistui", tone: "good" },
  todennäköinen: { sign: "≈", text: "Todennäköinen", tone: "level" },
  epäselvä: { sign: "?", text: "Epäselvä", tone: "level" },
  huonompi: { sign: "▲", text: "Menot kasvoivat", tone: "bad" },
  odottaa: { sign: "…", text: "Odottaa kuukausia", tone: "level" },
};

export function VerdictMark({ verdict }: { verdict: Verdict }) {
  const v = VERDICT_MARK[verdict];
  return (
    <span className={`verdict verdict-${v.tone}`}>
      <span className="verdict-sign" aria-hidden="true">
        {v.sign}
      </span>
      {v.text}
    </span>
  );
}
