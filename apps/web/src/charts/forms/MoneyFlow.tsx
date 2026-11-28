// Decision: how much of the household's life is paid with credit or savings, and how large a cut would end it
import { money } from "../../format.ts";
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
function stack(side: readonly MoneyFlowBand[]): { band: MoneyFlowBand; y: number; height: number }[] {
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

/**
 * The sources and the uses as two stacked columns of equal height side by side, each with a legend that names a band
 * and its sum on one line, so no label can lie over another. Money has no label, so no band links one source to one
 * use: the bands are drawn by size only and the sums are the report's.
 */
export function MoneyFlow({ sources, uses }: { sources: readonly MoneyFlowBand[]; uses: readonly MoneyFlowBand[] }) {
  return (
    <div className="money-flow">
      <div className="mf-stacked">
        {[
          { name: t("rpt.mf_sources"), side: sources },
          { name: t("rpt.mf_uses"), side: uses },
        ].map(({ name, side }) => (
          <div key={name} className="mf-side">
            <p className="mf-side-name">{name}</p>
            <svg className="mf-column" viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${name}: ${side.map((b) => `${b.label} ${money(b.cents)}`).join(", ")}`}>
              {stack(side).map(({ band, y, height }) => (
                <rect key={band.id} className={`mf-seg mf-${band.kind}`} x={0} y={y} width={100} height={height} />
              ))}
            </svg>
            <ul className="mf-legend">
              {side.map((b) => (
                <li key={b.id}>
                  <span className={`mf-key mf-${b.kind}`} />
                  <span className="mf-name">{b.label}</span>
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
