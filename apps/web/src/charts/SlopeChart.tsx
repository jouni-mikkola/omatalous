// Decision: which of these rose and which fell between two periods, and by how much
import { type KeyboardEvent, useId, useState } from "react";
import { money, signedMoney } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { crisp } from "./draw.ts";
import { Tip } from "./forms/parts.tsx";
import { spreadLabels } from "./kit/annotate.ts";
import { LiveReadout } from "./kit/Readout.tsx";
import { readoutText, stepIndex } from "./kit/readout.ts";
import { linear } from "./kit/scale.ts";
import "../styles/charts.css";
import "../styles/calendar-heat.css";

export interface SlopeItem {
  key: string;
  label: string;
  /** The two ends and the change between them, all from the server. */
  from: number;
  to: number;
  change: number;
  /** A mover: drawn in the tone of its change and labelled at both ends; the rest are `--series-rest` context. */
  strong: boolean;
  /** How the change reads for the household: spending up is bad. */
  tone: "bad" | "good" | "flat";
}

/** Names in a sentence: "A, B ja C". */
const listed = (names: readonly string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} ja ${names[names.length - 1]}`);

/** A name in lines of at most `max` characters, broken at spaces, two lines at most (the second cut with "…" past that). */
function wrapName(label: string, max: number): string[] {
  const lines: string[] = [];
  for (const word of label.split(" ")) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  if (lines.length <= 2) return lines;
  const rest = lines.slice(1).join(" ");
  return [lines[0]!, rest.length > max ? `${rest.slice(0, max - 1)}…` : rest];
}

const TOP = 30;
const BOTTOM = 12;
/** The room a strong line takes (critic: the slope was crushed to 70 px), and the least a plot is. */
const PER_STRONG = 24;
const MIN_H = 220;
const GAP = 16;
/** The height of a line of an end label, and the room between two labels of the right side. */
const LINE = 13;
/** The tallest a slope grows to part lines that one large line squeezes together. */
const MAX_H = 400;
/** The least room between two strong ends of one side, unless they are about equal (then no height parts them). */
const PART = 10;

/** The plot height at which the strong ends of each side stand `PART` px apart, ends within 2 % of the domain left as one. */
function crowded(strong: readonly SlopeItem[], [lo, hi]: readonly [number, number]): number {
  const range = Math.max(1, hi - lo);
  let need = 0;
  for (const side of [strong.map((i) => i.from), strong.map((i) => i.to)]) {
    const sorted = [...side].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) {
      const d = (sorted[k]! - sorted[k - 1]!) / range;
      if (d >= 0.02) need = Math.max(need, PART / d);
    }
  }
  return need;
}

/**
 * Two periods side by side, a line for each item from its first figure to its second on one axis from zero, so a steep
 * line is a large change and a crossing a change of rank. The scale and the height come from the strong lines: a
 * context line that would run off it is left out of the picture and named under it (the table view has its figures).
 * Strong lines run from the grey of the past into their tone, figure at the left, name, figure and change at the right
 * (moved apart by `spreadLabels`), the largest change with a halo. A line reads out by pointer, tap and arrow keys.
 */
export function SlopeChart({ items, fromLabel, toLabel, label }: { items: readonly SlopeItem[]; fromLabel: string; toLabel: string; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const grad = useId().replace(/:/g, "");
  const strong = items.filter((i) => i.strong);
  const basis = strong.length ? strong : items;
  const narrow = width > 0 && width < 520;
  const side = narrow ? Math.min(180, width * 0.42) : Math.max(150, Math.min(210, width * 0.3));
  const x0 = narrow ? 52 : 72;
  // a name breaks into two lines rather than being cut (critic round 3): the label is its name, then figure and change
  const names = new Map(strong.map((i) => [i.key, wrapName(i.label, Math.max(8, Math.floor((side - 16) / 6.6)))]));
  const block = (Math.max(1, ...[...names.values()].map((l) => l.length)) + 1) * LINE + 4;
  // the domain of the strong ends, to grow the plot when one large line leaves the others in a thin band
  const span = linear(
    basis.flatMap((i) => [i.from, i.to]),
    [1, 0],
    { target: 4 },
  );
  const height = Math.max(MIN_H, strong.length * Math.max(PER_STRONG, block) + TOP + BOTTOM, Math.min(MAX_H, crowded(strong, span.domain) + TOP + BOTTOM));
  const innerH = height - TOP - BOTTOM;
  const y = linear(
    basis.flatMap((i) => [i.from, i.to]),
    [innerH, 0],
    { target: 4 },
  );
  const [lo, hi] = y.domain;
  const fits = (i: SlopeItem) => i.from >= lo && i.from <= hi && i.to >= lo && i.to <= hi;
  const quiet = items.filter((i) => !i.strong && fits(i));
  const off = items.filter((i) => !i.strong && !fits(i));
  const drawn = [...strong, ...quiet];
  const x1 = Math.max(x0 + 60, Math.min(x0 + 360, width - side));
  const left = spreadLabels(strong.map((i) => ({ key: i.key, y: y(i.from) })), innerH, GAP);
  const right = spreadLabels(strong.map((i) => ({ key: i.key, y: y(i.to) })), innerH, block);
  // the largest move by its server change; ordering is no arithmetic of money
  const largest = [...strong].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
  const tone = (i: SlopeItem) => (i.tone === "bad" ? "slope-up" : i.tone === "good" ? "slope-down" : "slope-flat");
  const active = at === null ? null : drawn[at] ?? null;
  const read = active && {
    title: active.label,
    rows: [
      { name: fromLabel, value: money(active.from, false) },
      { name: toLabel, value: money(active.to, false) },
      { name: "Muutos", value: signedMoney(active.change) },
    ],
  };
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    const next = stepIndex(e.key, at, drawn.length);
    if (next === undefined) return;
    e.preventDefault();
    setAt(next);
  };
  const line = (i: SlopeItem, n: number) => (
    <g key={i.key} className={`slope ${i.strong ? tone(i) : "slope-quiet"}${at === n ? " active" : ""}`} onPointerEnter={() => setAt(n)} onPointerDown={() => setAt(n)} onPointerLeave={(e) => e.pointerType === "mouse" && setAt(null)}>
      <line className="slope-hit" x1={x0} y1={y(i.from)} x2={x1} y2={y(i.to)} />
      <line className="slope-line draw" x1={x0} y1={y(i.from)} x2={x1} y2={y(i.to)} stroke={i.strong && i.tone !== "flat" ? `url(#${grad}-${i.tone})` : undefined} />
      {i === largest && <circle className="slope-halo" cx={x1} cy={y(i.to)} r={11} />}
      <circle className="slope-dot slope-dot-before" cx={x0} cy={y(i.from)} r={3.5} />
      <circle className="slope-dot" cx={x1} cy={y(i.to)} r={i === largest ? 5.5 : 4.5} />
    </g>
  );

  return (
    <div className="chart slope-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <defs>
            {(["bad", "good"] as const).map((d) => (
              <linearGradient key={d} id={`${grad}-${d}`} gradientUnits="userSpaceOnUse" x1={x0} x2={x1} y1="0" y2="0">
                <stop offset="0" className="slope-stop-past" />
                <stop offset="0.55" className={d === "bad" ? "slope-stop-up" : "slope-stop-down"} />
              </linearGradient>
            ))}
          </defs>
          <text x={x0} y={12} textAnchor="middle" className="slope-head">
            {fromLabel}
          </text>
          <text x={x1} y={12} textAnchor="middle" className="slope-head">
            {toLabel}
          </text>
          <g transform={`translate(0,${TOP})`}>
            <line className="axis-line" x1={crisp(x0)} x2={crisp(x0)} y1={-8} y2={innerH} />
            <line className="axis-line" x1={crisp(x1)} x2={crisp(x1)} y1={-8} y2={innerH} />
            {/* zero is a line of its own when a refund takes a category below it */}
            {lo < 0 && <line className="grid-line" x1={x0} x2={x1} y1={crisp(y(0))} y2={crisp(y(0))} />}
            {left.every((l) => Math.abs(l.at - y(lo)) >= 14) && (
              <text x={x0 - 9} y={y(lo)} dy="0.32em" textAnchor="end" className="slope-zero">
                {money(lo, false)}
              </text>
            )}
            <g tabIndex={0} role="group" aria-label={`${label}. Nuolinäppäimet siirtävät viivasta toiseen.`} onKeyDown={onKey} onFocus={() => at === null && drawn.length && setAt(0)} onBlur={() => setAt(null)}>
              {quiet.map((i) => line(i, drawn.indexOf(i)))}
              {strong.map((i) => line(i, drawn.indexOf(i)))}
            </g>
            {strong.map((i, n) => (
              <g key={i.key} aria-hidden="true" className={active && active !== i ? "slope-dim" : undefined}>
                {!left[n]!.hidden && (
                  <text x={x0 - 9} y={left[n]!.at} dy="0.32em" textAnchor="end">
                    {money(i.from, false)}
                  </text>
                )}
                {!right[n]!.hidden && (
                  <text x={x1 + 12} y={right[n]!.at - (names.get(i.key)!.length * LINE) / 2}>
                    {names.get(i.key)!.map((line, k) => (
                      <tspan key={k} x={x1 + 12} dy={k === 0 ? "0.32em" : LINE} className="slope-name">
                        {line}
                      </tspan>
                    ))}
                    <tspan x={x1 + 12} dy={LINE} className="slope-figure">
                      {money(i.to, false)}
                    </tspan>
                    <tspan dx={6} className={`slope-change ${tone(i)}-text`}>
                      {signedMoney(i.change)}
                    </tspan>
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
      )}
      {off.length > 0 && (
        <p className="slope-off">
          {listed(off.map((i) => i.label))} {off.length === 1 ? "ei mahdu kuvaan. Sen" : "eivät mahdu kuvaan. Niiden"} luvut ovat taulukossa.
        </p>
      )}
      {read && active && <Tip x={x1} left={0} width={width} title={read.title} rows={read.rows} />}
      <LiveReadout text={read ? readoutText(read.title, read.rows) : ""} />
    </div>
  );
}
