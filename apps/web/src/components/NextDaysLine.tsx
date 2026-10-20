import { type CSSProperties, type KeyboardEvent, useRef, useState } from "react";
import { columnX, type DotIn, labelled, nextDot, placeDots, STEPS_HEIGHT, stepLine } from "../charts/bill-line.ts";
import { money } from "../format.ts";
import { useWidth } from "../hooks.ts";
import "../styles/charts.css";
import { type BillLine, endCents, zeroY } from "./next-days-line.ts";

/** The dot or the mark that is lit, and the row of its table that lights with it. */
export type Active = { kind: "bill" | "pay"; row: number } | null;

/** The width the line is laid out for before it is measured. */
const UNMEASURED = 600;
/** What the dimension line takes between the axis and the steps (its 16 px and the margin above), and the margin above the steps. */
const DIM_ROOM = 24;
const STEPS_GAP = 8;
/** A pay's mark: its own size, and the room it takes so that no dot is under it. */
const MARK = 14;
const MARK_ROOM = 20;

interface Item {
  kind: "bill" | "pay";
  row: number;
  column: number;
  label: string;
  title: string;
  when: string;
  leftCents: number | null;
  estimate: boolean;
}

/**
 * The payments of the window on the days from today to payday, a dot to a payment sized by its sum, under them the
 * balance stepping down by what is paid. A dot is lit by the pointer or by the keys and lights its row in the table
 * under it, and the other way round; arrows move from dot to dot. Nothing is added to the balance: a pay is a mark.
 * The table under the line says all of it in text, so the drawing is for the eyes.
 */
export function NextDaysLine({ line, active, onActive }: { line: BillLine; active: Active; onActive: (a: Active) => void }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const width = measured || UNMEASURED;
  const { axis, bills, pays, startCents } = line;
  const columns = axis.length;
  const items: Item[] = [
    ...bills.map((b): Item => ({ kind: "bill", row: b.row, column: b.column, label: b.label, title: b.name, when: b.when, leftCents: b.leftCents, estimate: b.estimate })),
    ...pays.map((p): Item => ({ kind: "pay", row: p.row, column: p.column, label: p.label, title: p.name, when: p.when, leftCents: null, estimate: false })),
  ];
  const input: DotIn[] = [...bills.map((b) => ({ column: b.column, cents: b.cents })), ...pays.map((p) => ({ column: p.column, cents: 0, fixed: MARK_ROOM }))];
  const { dots, height } = placeDots(width, columns, input);
  const steps = startCents === null ? null : stepLine(width, columns, startCents, bills);
  const shows = labelled(width, columns);

  // one tab stop for the whole line, the dot last visited; the arrows go from day to day
  const order = items.map((_, i) => i).sort((a, b) => items[a]!.column - items[b]!.column || a - b);
  const [stop, setStop] = useState(0);
  const tabStop = stop < items.length ? stop : (order[0] ?? 0);
  const els = useRef<(HTMLSpanElement | null)[]>([]);
  // the scale of the steps: the balance at the start and at the end, and zero when a step goes below it
  const end = endCents(line);
  const yStart = steps ? steps.startY : null;
  const yEnd = steps ? steps.at[columns - 1]!.y : null;
  const yZero = startCents !== null && end !== null && yStart !== null && yEnd !== null ? zeroY(startCents, end, yStart, yEnd, STEPS_HEIGHT) : null;
  const dim = axis[columns - 1]?.payday === true;
  const band = { "--nd-top": `${height}px`, "--nd-bottom": `${(dim ? DIM_ROOM : 0) + (steps ? STEPS_GAP + STEPS_HEIGHT : 0)}px` } as CSSProperties;
  const lit = active ? items.findIndex((i) => i.kind === active.kind && i.row === active.row) : -1;
  const litItem = items[lit];
  const litDot = dots[lit];
  const litAt = litItem && steps ? steps.at[litItem.column] : undefined;

  const keys = (e: KeyboardEvent, i: number) => {
    const next = nextDot(e.key, order.indexOf(i), order.length);
    if (next !== null) {
      e.preventDefault();
      const target = order[next];
      if (target !== undefined) els.current[target]?.focus();
    } else if (e.key === "Escape") onActive(null);
  };
  const flip = litDot !== undefined && litDot.x > width - 200;

  return (
    <div ref={ref} className={lit >= 0 ? "nd-line has-on" : "nd-line"} role="group" aria-labelledby="ahead-h" style={band}>
      <div className="nd-dots" style={{ height }}>
        {items.map((item, i) => {
          const dot = dots[i]!;
          const pay = item.kind === "pay";
          const size = pay ? MARK : dot.size;
          const classes = ["nd-dot", pay ? "nd-pay" : `nd-t${dot.tone}`, item.estimate ? "nd-est" : "", i === lit ? "on" : ""];
          return (
            <span
              key={`${item.kind}-${item.row}`}
              ref={(el) => {
                els.current[i] = el;
              }}
              role="img"
              tabIndex={i === tabStop ? 0 : -1}
              aria-label={item.label}
              className={classes.filter(Boolean).join(" ")}
              style={{ left: dot.x - size / 2, bottom: dot.y + (pay ? (MARK_ROOM - MARK) / 2 : 0), width: size, height: size }}
              onPointerEnter={() => onActive({ kind: item.kind, row: item.row })}
              onPointerLeave={(e) => e.currentTarget !== document.activeElement && onActive(null)}
              onFocus={() => {
                setStop(i);
                onActive({ kind: item.kind, row: item.row });
              }}
              onBlur={() => onActive(null)}
              onKeyDown={(e) => keys(e, i)}
            />
          );
        })}
        {litItem && litDot && (
          <div className="tooltip nd-tip" aria-hidden="true" style={flip ? { right: width - litDot.x + litDot.size / 2 + 8 } : { left: litDot.x + litDot.size / 2 + 8 }}>
            <b>{litItem.title}</b>
            <span>{litItem.when}</span>
            {litItem.leftCents !== null && <span>Käytettävissä {money(litItem.leftCents)}</span>}
          </div>
        )}
      </div>
      <ol className="nd-axis" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {axis.map((d, k) => (
          <li key={d.iso} className={[d.payday ? "nd-pd" : "", d.weekend ? "nd-we" : ""].filter(Boolean).join(" ") || undefined}>
            {shows(k) && (
              <>
                <span>{d.weekday}</span>
                {d.day}.
              </>
            )}
          </li>
        ))}
      </ol>
      {dim && (
        <div className="nd-dim" style={{ "--n": columns } as CSSProperties} aria-hidden="true">
          <span>{columns - 1} pv</span>
        </div>
      )}
      {steps && (
        <div className="nd-steps" style={{ height: STEPS_HEIGHT }} aria-hidden="true">
          <svg viewBox={`0 0 ${width} ${STEPS_HEIGHT}`} width={width} height={STEPS_HEIGHT}>
            <path d={steps.area} className="nd-area" />
            <path d={steps.path} className="nd-curve" />
            {yStart !== null && <line className="nd-rule" x1={0} x2={8} y1={Math.round(yStart) + 0.5} y2={Math.round(yStart) + 0.5} />}
            {yZero !== null && <line className="nd-rule" x1={0} x2={width} y1={Math.round(yZero) + 0.5} y2={Math.round(yZero) + 0.5} />}
          </svg>
          {startCents !== null && yStart !== null && (
            <span className="nd-val" style={{ left: 4, top: Math.round(yStart) + 4 }}>
              {money(startCents, false)}
            </span>
          )}
          {end !== null && end !== startCents && (
            <span className="nd-val" style={{ right: Math.max(0, width - steps.at[columns - 1]!.x - 4), top: Math.round(steps.at[columns - 1]!.y) + 8 }}>
              {money(end, false)}
            </span>
          )}
          {yZero !== null && (
            <span className="nd-val" style={{ left: 4, top: Math.round(yZero) - 20 }}>
              0 €
            </span>
          )}
          <i className="nd-end" style={{ left: steps.at[columns - 1]!.x, top: steps.at[columns - 1]!.y }} />
          {litAt && <i className="nd-point" style={{ left: litAt.x, top: litAt.y }} />}
        </div>
      )}
      {litItem && litDot && <i className="nd-guide" style={{ left: columnX(width, columns, litItem.column) }} />}
    </div>
  );
}
