// Decision: how much of the household's life is paid with credit or savings, and how large a cut would end it
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "../../design/tokens.ts";
import { money, monthLabel } from "../../format.ts";
import { t } from "../../text.ts";
import "../../styles/money-flow.css";

interface MoneyFlowBand {
  id: string;
  label: string;
  kind: "income" | "drawn" | "spending" | "debt" | "kept";
  cents: number;
}

/** The height both columns are drawn at, and the air between two bands, in the drawing's own units. */
const HEIGHT = 320;
const GAP = 3;
/** The least a band is drawn at, so a thin one stays a visible band. */
const LEAST = 4;

/**
 * The bands of one column as rectangles from the top down. The column is always `HEIGHT` tall, so two sides of equal
 * total stand at equal height. A band under `LEAST` is lifted to it and the largest band gives up the difference.
 */
function stack(side: readonly MoneyFlowBand[]): Placed[] {
  const total = side.reduce((sum, b) => sum + b.cents, 0);
  const room = HEIGHT - GAP * Math.max(0, side.length - 1);
  const heights = side.map((b) => (total > 0 ? Math.max(LEAST, (b.cents / total) * room) : 0));
  const excess = heights.reduce((sum, h) => sum + h, 0) - room;
  if (excess !== 0 && heights.length > 0) {
    const largest = heights.indexOf(Math.max(...heights));
    heights[largest] = heights[largest]! - excess;
  }
  let y = 0;
  return side.map((band, i) => {
    const at = y;
    y += heights[i]! + GAP;
    return { band, y: at, height: heights[i]! };
  });
}

type Placed = { band: MoneyFlowBand; y: number; height: number };

/**
 * The places of `target`, moved there from where each band stood when the bands change. A band is followed by its id; a
 * new band stands in its place at once. Without motion (reduced motion, or no animation frames) the places are the
 * target's. The geometry is set as attributes, since the page allows no style attribute.
 */
function useMoved(target: readonly Placed[]): Placed[] {
  const [shown, setShown] = useState<readonly Placed[]>(target);
  const standing = useRef<readonly Placed[]>(target);
  useEffect(() => {
    const begin = standing.current;
    if (begin === target) return;
    const welcome = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    if (!welcome) {
      standing.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / motion.open);
      const eased = 1 - (1 - k) ** 3;
      const next = target.map((p) => {
        const was = begin.find((b) => b.band.id === p.band.id);
        return was ? { ...p, y: was.y + (p.y - was.y) * eased, height: was.height + (p.height - was.height) * eased } : p;
      });
      standing.current = k < 1 ? next : target;
      setShown(standing.current);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return target.map((p) => shown.find((s) => s.band.id === p.band.id) ?? p);
}

function Column({ name, side }: { name: string; side: readonly MoneyFlowBand[] }) {
  const target = useMemo(() => stack(side), [side]);
  const placed = useMoved(target);
  return (
    <svg className="mf-column" viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${name}: ${side.map((b) => `${b.label} ${money(b.cents)}`).join(", ")}`}>
      {placed.map(({ band, y, height }) => (
        <rect key={band.id} className={`mf-seg mf-${band.kind}`} x={0} y={y} width={100} height={height} />
      ))}
    </svg>
  );
}

/**
 * One row of the complete months; a press picks the month and the same press again returns to the whole period. The
 * picture itself is the caller's, so the hero and the table follow the pick too.
 */
export function MoneyFlowMonths({ months, picked, onPick }: { months: readonly string[]; picked: string | null; onPick: (month: string | null) => void }) {
  const withYear = new Set(months.map((m) => m.slice(0, 4))).size > 1;
  return (
    <div className="mf-months" role="group" aria-label={t("rpt.mf_months")}>
      {months.map((m) => (
        <button key={m} type="button" className="mf-month" aria-pressed={picked === m} onClick={() => onPick(picked === m ? null : m)}>
          {monthLabel(m, withYear)}
        </button>
      ))}
    </div>
  );
}

/**
 * The sources and the uses as two stacked columns of equal height side by side, each with a legend that names a band
 * and its sum on one line, so no label can lie over another. Money has no label, so no band links one source to one
 * use: the bands are drawn by size only and the sums are the report's. A band that `href` answers opens its rows; a
 * change of bands moves each band to its new place and height, keyed by the band.
 */
export function MoneyFlow({ sources, uses, href }: { sources: readonly MoneyFlowBand[]; uses: readonly MoneyFlowBand[]; href?: (band: MoneyFlowBand) => string | null }) {
  return (
    <div className="money-flow">
      <div className="mf-stacked">
        {[
          { name: t("rpt.mf_sources"), side: sources },
          { name: t("rpt.mf_uses"), side: uses },
        ].map(({ name, side }) => (
          <div key={name} className="mf-side">
            <p className="mf-side-name">{name}</p>
            <Column name={name} side={side} />
            <ul className="mf-legend">
              {side.map((b) => (
                <li key={b.id}>
                  <span className={`mf-key mf-${b.kind}`} />
                  <span className="mf-name">{href?.(b) ? <a href={href(b)!}>{b.label}</a> : b.label}</span>
                  <span className="mf-sum">{money(b.cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
