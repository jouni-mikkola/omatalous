// Decision: which of these rose and which fell between two periods, and by how much
import { useWidth } from "../../hooks.ts";
import { crisp } from "../draw.ts";
import { linear } from "../kit/scale.ts";
import { spreadLabels } from "./parts.tsx";

export interface SlopeItem {
  key: string;
  label: string;
  /** The two ends, from the server: the earlier period and the later one. */
  from: number;
  to: number;
  /** A mover drawn in colour and labelled at both ends; the rest are grey and read in the table view. */
  strong: boolean;
  /** How the end reads for the household: spending up is bad, a basket's visits are neutral. */
  tone: "bad" | "good" | "flat";
}

/**
 * A slope chart: each item a line from its earlier figure to its later one on one shared scale, the strong ones in the
 * tone of their meaning with their figures at both ends, the rest `--series-rest`. Two columns, so it reads at 390 px.
 */
export function Slope({ items, fromLabel, toLabel, format, label, height = 260, caption, zero = true }: { items: SlopeItem[]; fromLabel: string; toLabel: string; format: (v: number) => string; label: string; height?: number; caption?: string; zero?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const narrow = width < 520;
  const side = narrow ? 92 : 168;
  const top = 28;
  const innerH = height - top - 12;
  const y = linear(items.flatMap((i) => [i.from, i.to]), [innerH, 0], { target: 4, zero });
  // one item has its name in the caption: its ends carry the figures only
  const single = items.length === 1;
  const x0 = side;
  const x1 = Math.max(side + 40, width - side);
  const strong = items.filter((i) => i.strong);
  const name = (i: SlopeItem) => (narrow && i.label.length > 12 ? `${i.label.slice(0, 11)}…` : i.label);
  // a phone has room for a name on the left and a figure on the right; the table view has both figures of every line
  const left = spreadLabels(strong.map((i) => ({ key: i.key, y: y(i.from), text: single ? format(i.from) : narrow ? name(i) : `${name(i)} ${format(i.from)}` })), 14, innerH);
  const right = spreadLabels(strong.map((i) => ({ key: i.key, y: y(i.to), text: single || narrow ? format(i.to) : `${format(i.to)} ${name(i)}` })), 14, innerH);
  const tone = (i: SlopeItem) => (i.tone === "bad" ? "var(--bad)" : i.tone === "good" ? "var(--good)" : "var(--series-1)");
  return (
    <div className="chart" ref={ref}>
      {caption && <p className="qc-cap">{caption}</p>}
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <g transform={`translate(0,${top})`}>
            <text x={x0} y={-14} textAnchor="middle" className="qc-end-sub">
              {fromLabel}
            </text>
            <text x={x1} y={-14} textAnchor="middle" className="qc-end-sub">
              {toLabel}
            </text>
            <line className="grid-line" x1={crisp(x0)} x2={crisp(x0)} y1={0} y2={innerH} />
            <line className="grid-line" x1={crisp(x1)} x2={crisp(x1)} y1={0} y2={innerH} />
            {items
              .filter((i) => !i.strong)
              .map((i) => (
                <line key={i.key} x1={x0} x2={x1} y1={y(i.from)} y2={y(i.to)} stroke="var(--series-rest)" strokeWidth={1.5} strokeOpacity={0.6}>
                  <title>{`${i.label}: ${format(i.from)} → ${format(i.to)}`}</title>
                </line>
              ))}
            {strong.map((i) => (
              <g key={i.key}>
                <line x1={x0} x2={x1} y1={y(i.from)} y2={y(i.to)} stroke={tone(i)} strokeWidth={2.5} strokeLinecap="round" />
                <circle cx={x0} cy={y(i.from)} r={4} fill={tone(i)} stroke="var(--surface)" strokeWidth={2} />
                <circle cx={x1} cy={y(i.to)} r={4.5} fill={tone(i)} stroke="var(--surface)" strokeWidth={2} />
              </g>
            ))}
            {left.map((l) => (
              <text key={`l${l.key}`} className="qc-note" x={x0 - 8} y={l.y} dy="0.32em" textAnchor="end">
                {l.text}
              </text>
            ))}
            {right.map((l) => (
              <text key={`r${l.key}`} className="qc-note" x={x1 + 8} y={l.y} dy="0.32em">
                {l.text}
              </text>
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}
