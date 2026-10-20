// Decision: which days and weekdays the money goes on, and whether a big day was a one-off
import { addDays, dayHeat, dayNumber, weekdayOf } from "@banking/core";
import { type CSSProperties, type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { dayHeading, dayMonth, money, MONTHS_SHORT } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { crisp } from "./draw.ts";
import { Tip } from "./forms/parts.tsx";
import { LiveReadout } from "./kit/Readout.tsx";
import { type Cell, gridStep, readoutText } from "./kit/readout.ts";
import { WEEKDAYS_SHORT } from "./kit/ticks.ts";
import "../styles/charts.css";
import "../styles/calendar-heat.css";

/** A day of the series: its spending, its rows, and the shade core gave it (`dayHeat`; worked out by core here when absent). */
export interface HeatDay {
  date: string;
  cents: number;
  count: number;
  heat?: number;
}

const WEEKDAYS_LONG = ["Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai", "Sunnuntai"];
const GAP = 2;
const LEFT = 24;
const TOP = 18;
/** The strip of week sums under the grid: its tallest bar, and the room over it for the figure of the largest week. */
const STRIP = 34;
const STRIP_TOP = 22;
/** The weekday column on the right: the mean of each row, so the habit of a weekday reads beside its days. */
const MEAN_W = 84;
const MEAN_BAR = 36;
const LARGEST = 24;
/** A span under this many weeks gets larger cells, so a month or a quarter fills the panel instead of a corner. */
const SHORT_WEEKS = 16;
const LARGEST_SHORT = 52;
/** The corners a rank badge may take, the cell's top right first: [x, y] as fractions of the cell. */
const CORNERS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 0],
  [1, 1],
  [0, 1],
];
/** Under this width half a year makes cells too small to point at: the calendar shows the last 13 weeks, the table all. */
const NARROW = 560;
const PHONE_WEEKS = 13;

/**
 * The key of the four shades, one wording on every heat map (critic round 3): each cell against its own usual (the
 * usual spending day of a calendar, a category's own average in Menot kuukausittain; the readout and the answer name it).
 */
export function HeatKey({ plain }: { plain?: string }) {
  const steps = ["alle puolet", "enintään sama", "enintään puolitoistakertainen", "enemmän"];
  return (
    <p className="use-key heat-key" aria-hidden="true">
      <span>Tavalliseen verrattuna:</span>
      {steps.map((s, i) => (
        <span key={s} className="heat-key-step">
          <i className={`swatch heat-key-${i + 1}`} />
          {s}
        </span>
      ))}
      {plain && <span>{plain}</span>}
    </p>
  );
}

type At = { kind: "day"; cell: Cell } | { kind: "week" | "mean"; i: number } | null;

/**
 * Days as a calendar: a column a week from Monday, a row a weekday, each day in core's shade against the usual spending
 * day (the heat tokens). Any day series draws: the days report of Raportit, the rows a filter of Tapahtumat leaves, the
 * days of another page. Three readings may share the grid's axes: the strip under it sums each column (`weeks`), the
 * column on the right averages each row (`weekdayAvgCents`), and the days in `top` are ringed and numbered. A day reads
 * out by pointer, tap and the arrow keys (`gridStep`), and the readout names the usual day the shade is set against.
 */
export function CalendarHeat<T extends { date: string }>(props: {
  /** Every day of the span, oldest first, a day with no row at 0. */
  days: readonly HeatDay[];
  today: string;
  /** The chart's question, its accessible name ("Minä päivinä rahaa menee?"). */
  question: string;
  /** The week sums of the strip, Monday first, from the server; no strip without them. */
  weeks?: readonly { from: string; cents: number }[];
  /** The mean of each weekday, Monday first, from the server; no column without it. */
  weekdayAvgCents?: readonly (number | null)[];
  /** The days to ring and number, largest first. */
  top?: readonly T[];
  /**
   * The line of a top day under the calendar (its figure, its largest purchase). With it the calendar lists the top
   * days it shows, numbered as ringed, so a phone that shows fewer weeks never names a day it does not draw.
   */
  topNote?: (day: T) => ReactNode;
  /** The usual day the shades are against, for the key and the readout (`usualDayCents`). */
  usualCents?: number | null;
  /** What the count of a day counts in the readout. */
  countName?: string;
}) {
  const { today, weekdayAvgCents, question, countName = "Ostoksia" } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<At>(null);
  const grad = useId().replace(/:/g, "");
  const shaded = props.days.every((d) => d.heat !== undefined) ? props.days.map((d) => d.heat!) : dayHeat(props.days, today).heat;
  const usual = props.usualCents !== undefined ? props.usualCents : dayHeat(props.days, today).usualCents;
  const start = props.weeks?.[0]?.from ?? (props.days[0] ? addDays(props.days[0].date, -weekdayOf(props.days[0].date)) : today);
  const allWeeks = props.days.length ? Math.floor((dayNumber(props.days[props.days.length - 1]!.date) - dayNumber(start)) / 7) + 1 : 0;
  const narrow = width > 0 && width < NARROW;
  const skip = narrow ? Math.max(0, allWeeks - PHONE_WEEKS) : 0;
  const from = addDays(start, skip * 7);
  const cols = allWeeks - skip;
  const weeks = props.weeks?.slice(skip);
  const days = props.days.map((d, i) => ({ ...d, heat: shaded[i]! })).filter((d) => d.date >= from);
  const top = (props.top ?? []).filter((d) => d.date >= from);
  const first = dayNumber(from);
  const meanW = weekdayAvgCents ? MEAN_W : 0;
  const cell = Math.max(8, Math.min(cols < SHORT_WEEKS ? LARGEST_SHORT : LARGEST, Math.floor((width - LEFT - meanW - 8) / Math.max(cols, 1)) - GAP));
  const pitch = cell + GAP;
  const gridBottom = TOP + 7 * pitch;
  const stripBase = weeks ? gridBottom + STRIP_TOP + STRIP : gridBottom;
  const height = stripBase + (weeks ? 16 : 4);
  // the rank is the day's place among all top days: a phone that leaves the first out still numbers the rest as the table does
  const rank = new Map((props.top ?? []).map((d, i) => [d.date, i + 1]));
  const cellOf = (date: string): Cell => ({ col: Math.floor((dayNumber(date) - first) / 7), row: weekdayOf(date) });
  const place = (date: string) => {
    const c = cellOf(date);
    return { x: LEFT + c.col * pitch, y: TOP + c.row * pitch };
  };
  const byCell = new Map(days.map((d, i) => [`${cellOf(d.date).col},${cellOf(d.date).row}`, i]));
  // a month's name stands over the first week whose Monday is in it, so a week of late April is never under "touko";
  // the first column takes the month of its first day shown
  const monthOf = (date: string) => MONTHS_SHORT[Number(date.slice(5, 7)) - 1]!;
  const months = Array.from({ length: cols }, (_, c) => addDays(from, c * 7))
    .map((monday, c) => ({ x: LEFT + c * pitch, label: c === 0 ? monthOf(days[0]?.date ?? monday) : monthOf(monday), turn: c === 0 || monday.slice(5, 7) !== addDays(monday, -7).slice(5, 7) }))
    .filter((m) => m.turn);
  const shown = months.filter((m, i) => i === months.length - 1 || months[i + 1]!.x - m.x >= 28);
  // a badge sits on a corner of its cell that no other ringed day touches, and away from a badge already placed
  const ringed = new Set(top.map((d) => `${place(d.date).x},${place(d.date).y}`));
  const badges = new Map<string, { cx: number; cy: number }>();
  for (const d of top) {
    const { x, y } = place(d.date);
    const free =
      CORNERS.find(([fx, fy]) => {
        const sx = fx ? pitch : -pitch;
        const sy = fy ? pitch : -pitch;
        const touched = [`${x + sx},${y}`, `${x},${y + sy}`, `${x + sx},${y + sy}`].some((k) => ringed.has(k));
        const near = [...badges.values()].some((b) => Math.hypot(b.cx - (x + fx * cell), b.cy - (y + fy * cell)) < 14);
        return !touched && !near;
      }) ?? CORNERS[0]!;
    badges.set(d.date, { cx: x + free[0] * cell, cy: y + free[1] * cell });
  }
  // geometry only: a bar's length is its share of the largest, the figures themselves are the server's
  const widestWeek = Math.max(1, ...(weeks ?? []).map((w) => w.cents));
  const peakWeek = (weeks ?? []).reduce((b, w, i, all) => (w.cents > (all[b]?.cents ?? 0) ? i : b), 0);
  const weekH = (c: number) => (c > 0 ? Math.max(2, (c / widestWeek) * STRIP) : 0);
  const means = weekdayAvgCents ?? [];
  const widestMean = Math.max(1, ...means.map((c) => c ?? 0));
  const peakDay = means.reduce<number>((b, c, i) => ((c ?? -1) > (means[b] ?? -1) ? i : b), 0);
  const meanX = LEFT + cols * pitch + 10;
  // cells come in column by column over the draw time; charts.css turns it off for a reader who asked for less motion
  const sweep = (col: number): CSSProperties => ({ "--d": `${Math.round((col / Math.max(1, cols)) * 250)}ms` }) as CSSProperties;
  const hit = (kind: "week" | "mean", i: number) => ({
    onPointerEnter: () => setAt({ kind, i }),
    onPointerDown: () => setAt({ kind, i }),
    onPointerLeave: () => setAt(null),
  });
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    const next = gridStep(e.key, at?.kind === "day" ? at.cell : null, cols, 7);
    if (next === undefined) return;
    e.preventDefault();
    setAt(next && { kind: "day", cell: next });
  };

  const atDay = at?.kind === "day" ? byCell.get(`${at.cell.col},${at.cell.row}`) : undefined;
  let readout: { x: number; title: string; rows: { name: string; value: string }[] } | null = null;
  if (atDay !== undefined) {
    const d = days[atDay]!;
    const rows = [
      { name: "Menot", value: money(d.cents, false) },
      { name: countName, value: String(d.count) },
    ];
    if (usual !== null && d.date < today) rows.push({ name: "Tavallinen ostospäivä", value: money(usual, false) });
    readout = { x: place(d.date).x + cell, title: dayHeading(d.date, today), rows };
  } else if (at?.kind === "week" && weeks?.[at.i]) {
    const w = weeks[at.i]!;
    readout = { x: LEFT + at.i * pitch + cell, title: `Viikko ${dayMonth(w.from)}–${dayMonth(addDays(w.from, 6))}`, rows: [{ name: "Menot", value: money(w.cents, false) }] };
  } else if (at?.kind === "mean") {
    const c = means[at.i];
    readout = { x: meanX, title: WEEKDAYS_LONG[at.i]!, rows: [{ name: "Keskimäärin", value: c == null ? "ei päiviä" : money(c, false) }] };
  }

  return (
    <div className="chart calendar" ref={ref}>
      <HeatKey />
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={question}>
          <defs>
            <linearGradient id={`${grad}-mean`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" className="calendar-stop-soft" />
              <stop offset="1" className="calendar-stop" />
            </linearGradient>
            <linearGradient id={`${grad}-week`} x1="0" x2="0" y1="1" y2="0">
              <stop offset="0" className="calendar-stop-soft" />
              <stop offset="1" className="calendar-stop" />
            </linearGradient>
          </defs>
          {shown.map((m) => (
            <text key={m.x} x={m.x} y={TOP - 6} className="calendar-month">
              {m.label}
            </text>
          ))}
          {WEEKDAYS_SHORT.map((w, i) => (
            <text key={w} x={0} y={TOP + i * pitch + cell - 2} className={weekdayAvgCents && i === peakDay ? "calendar-peak-label" : "calendar-weekday"}>
              {w}
            </text>
          ))}
          <g className="calendar-grid" tabIndex={0} role="group" aria-label={`${question} Nuolinäppäimet siirtävät päivästä toiseen.`} onKeyDown={onKey} onFocus={() => at === null && days.length && setAt({ kind: "day", cell: cellOf(days[days.length - 1]!.date) })} onBlur={() => setAt(null)}>
            {days.map((d, i) => {
              const { x, y } = place(d.date);
              return (
                <rect
                  key={d.date}
                  className={`calendar-day heat-${d.heat}${d.date === today ? " today" : ""}${atDay === i ? " active" : ""}`}
                  style={sweep((x - LEFT) / pitch)}
                  x={x}
                  y={y}
                  width={cell}
                  height={cell}
                  rx={2}
                  onPointerEnter={() => setAt({ kind: "day", cell: cellOf(d.date) })}
                  onPointerDown={() => setAt({ kind: "day", cell: cellOf(d.date) })}
                  onPointerLeave={(e) => e.pointerType === "mouse" && setAt(null)}
                />
              );
            })}
          </g>
          {top.map((d) => {
            const { x, y } = place(d.date);
            const { cx, cy } = badges.get(d.date)!;
            return (
              <g key={d.date} className="calendar-top" aria-hidden="true">
                <rect x={x - 2} y={y - 2} width={cell + 4} height={cell + 4} rx={3} />
                <circle cx={cx} cy={cy} r={6.5} />
                <text x={cx} y={cy + 3.5} textAnchor="middle">
                  {rank.get(d.date)}
                </text>
              </g>
            );
          })}
          {weeks && (
            <>
              {/* the strip: a column's sum under the column, the largest week named with its figure */}
              <line className="axis-line" x1={LEFT} x2={LEFT + cols * pitch - GAP} y1={crisp(stripBase)} y2={crisp(stripBase)} />
              {weeks.map((w, i) => {
                const h = weekH(w.cents);
                return (
                  <g key={w.from} className={`calendar-week${i === peakWeek ? " peak" : ""}${at?.kind === "week" && at.i === i ? " active" : ""}`}>
                    <rect className="calendar-week-hit" x={LEFT + i * pitch} y={gridBottom + 4} width={pitch} height={stripBase - gridBottom - 4} {...hit("week", i)} />
                    {h > 0 && <path className="calendar-week-bar" style={sweep(i)} fill={`url(#${grad}-week)`} d={`M${LEFT + i * pitch},${stripBase}v${-(h - 2)}q0,-2 2,-2h${cell - 4}q2,0 2,2v${h - 2}z`} />}
                  </g>
                );
              })}
              {weeks[peakWeek] && weeks[peakWeek]!.cents > 0 && (
                <text className="calendar-annot" x={Math.min(LEFT + peakWeek * pitch + cell / 2, LEFT + cols * pitch - 40)} y={stripBase - weekH(weeks[peakWeek]!.cents) - 5} textAnchor="middle">
                  {money(weeks[peakWeek]!.cents, false)}
                </text>
              )}
              <text x={0} y={stripBase - 2} className="calendar-strip-label">
                vk
              </text>
            </>
          )}
          {weekdayAvgCents && (
            <>
              {means.map((c, i) => {
                const w = c ? Math.max(2, (c / widestMean) * MEAN_BAR) : 0;
                const y = TOP + i * pitch;
                return (
                  <g key={i} className={`calendar-mean${i === peakDay ? " peak" : ""}${at?.kind === "mean" && at.i === i ? " active" : ""}`}>
                    <rect className="calendar-week-hit" x={meanX} y={y} width={MEAN_W - 10} height={pitch} {...hit("mean", i)} />
                    {w > 0 && <path className="calendar-mean-bar" fill={`url(#${grad}-mean)`} d={`M${meanX},${y + 2}H${meanX + w - 2}Q${meanX + w},${y + 2} ${meanX + w},${y + 4}V${y + cell - 4}Q${meanX + w},${y + cell - 2} ${meanX + w - 2},${y + cell - 2}H${meanX}Z`} />}
                    {c !== null && (
                      <text x={meanX + w + 5} y={y + cell - 3}>
                        {money(c, false)}
                      </text>
                    )}
                  </g>
                );
              })}
              <line className="axis-line" x1={crisp(meanX)} x2={crisp(meanX)} y1={TOP} y2={gridBottom - GAP} />
              <text x={meanX} y={TOP - 6} className="calendar-month">
                ka / pv
              </text>
            </>
          )}
        </svg>
      )}
      {props.topNote && top.length > 0 && (
        <ol className="calendar-notes" aria-label="Suurimmat päivät">
          {top.map((d) => (
            <li key={d.date}>
              <span className="badge-n">{rank.get(d.date)}</span>
              {props.topNote!(d)}
            </li>
          ))}
        </ol>
      )}
      {skip > 0 && <p className="calendar-cut">Kuvassa ovat {PHONE_WEEKS} viimeistä viikkoa. Kaikki päivät ovat taulukossa.</p>}
      {readout && <Tip x={readout.x} left={0} width={width} title={readout.title} rows={readout.rows} />}
      <LiveReadout text={readout ? readoutText(readout.title, readout.rows) : ""} />
    </div>
  );
}
