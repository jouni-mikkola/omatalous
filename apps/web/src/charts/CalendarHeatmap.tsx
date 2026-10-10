import { useMemo, useState } from "react";
import { date, money, MONTHS_SHORT, WEEKDAYS_SHORT } from "../format.ts";
import { useWidth } from "../hooks.ts";
import { Tooltip } from "./Tooltip.tsx";
import "../styles/charts.css";

interface Day {
  date: string;
  cents: number;
  count: number;
}

const WEEKDAY_W = 22;
const TOP = 16;
/** Average width of a letter at the 11px chart font; month names are 3 to 6 letters. */
const CHAR_W = 5.5;
const LABEL_PAD = 4;

function weekday(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Cell size and gap for a grid of `weeks` columns in `room` pixels. */
function fit(room: number, weeks: number): { cell: number; gap: number } {
  // a whole year must fit a phone: cells shrink down to 3px instead of the grid being cut off
  const gap = room < weeks * 6 ? 1 : 2;
  return { cell: Math.max(3, Math.min(16, Math.floor(room / Math.max(weeks, 1)) - gap)), gap };
}

/**
 * Daily spending as a week × weekday grid, one blue ramp (more = darker).
 * One focusable layer covers the grid: hover, tap or the arrow keys pick a day.
 */
export function CalendarHeatmap({ days }: { days: Day[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const offset = days.length ? weekday(days[0]!.date) : 0;
  const weeks = Math.ceil((days.length + offset) / 7);
  // weekday names need two rows of room each (ma, ke, pe); on a phone the cells are too small
  const named = fit(width - WEEKDAY_W, weeks);
  const withNames = 2 * (named.cell + named.gap) >= 13;
  const left = withNames ? WEEKDAY_W : 0;
  const { cell, gap } = fit(width - left, weeks);
  const step = cell + gap;
  const radius = cell < 8 ? 1 : 3;
  const svgW = left + weeks * step;

  // quartiles of the days with spending give levels 1–4; no spending is level 0
  const thresholds = useMemo(() => {
    const vals = days
      .map((d) => d.cents)
      .filter((c) => c > 0)
      .sort((a, b) => a - b);
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] ?? 0;
    return [q(0.25), q(0.5), q(0.75)];
  }, [days]);
  const level = (c: number) => (c <= 0 ? 0 : c <= thresholds[0]! ? 1 : c <= thresholds[1]! ? 2 : c <= thresholds[2]! ? 3 : 4);

  const pos = (i: number) => ({ col: Math.floor((i + offset) / 7), row: (i + offset) % 7 });

  // a label above the first week of each month; when months are narrower than their names,
  // every second (or third…) month is labelled, and a label never starts inside the previous one
  const monthLabels = useMemo(() => {
    const starts: { col: number; month: number; key: number }[] = [];
    days.forEach((d, i) => {
      const col = Math.floor((i + offset) / 7);
      const row = (i + offset) % 7;
      if (!((row === 0 && Number(d.date.slice(8)) <= 7) || i === 0)) return;
      const month = Number(d.date.slice(5, 7)) - 1;
      const key = Number(d.date.slice(0, 4)) * 12 + month;
      if (starts[starts.length - 1]?.key !== key) starts.push({ col, month, key });
    });
    const textW = (month: number) => MONTHS_SHORT[month]!.length * CHAR_W;
    // a range starting late in a month: the next month's label wins over the partial one
    if (starts.length > 1 && (starts[1]!.col - starts[0]!.col) * step < textW(starts[0]!.month) + LABEL_PAD) starts.shift();
    const every = [1, 2, 3, 4, 6, 12].find((k) => 4.35 * k * step >= 6 * CHAR_W + LABEL_PAD) ?? 12;
    const out: { x: number; month: number; key: number }[] = [];
    for (const s of starts) {
      if (s.key % every !== 0 && s !== starts[0]) continue;
      // the last label stays inside the grid
      const x = Math.min(left + s.col * step, svgW - textW(s.month));
      const prev = out[out.length - 1];
      if (prev && x - prev.x < textW(prev.month) + LABEL_PAD) continue;
      out.push({ x, month: s.month, key: s.key });
    }
    return out;
  }, [days, offset, step, left, svgW]);

  const hovered = hover !== null ? days[hover] : null;
  const last = days.length - 1;

  const dayAt = (e: React.PointerEvent<SVGRectElement>): number | null => {
    const box = e.currentTarget.getBoundingClientRect();
    const col = Math.floor((e.clientX - box.left) / step);
    const row = Math.floor((e.clientY - box.top) / step);
    const i = col * 7 + row - offset;
    return row >= 0 && row < 7 && i >= 0 && i <= last ? i : null;
  };

  return (
    <div className="chart" ref={ref}>
      {width > 0 && days.length > 0 && (
        <svg width={svgW} height={TOP + 7 * step} role="img" aria-label="Kulutus päivittäin">
          {monthLabels.map((l) => (
            <text key={l.key} x={l.x} y={10}>
              {MONTHS_SHORT[l.month]}
            </text>
          ))}
          {withNames &&
            [0, 2, 4].map((r) => (
              <text key={r} x={0} y={TOP + r * step + cell / 2} dy="0.32em">
                {WEEKDAYS_SHORT[r]}
              </text>
            ))}
          {days.map((d, i) => {
            const { col, row } = pos(i);
            return <rect key={d.date} x={left + col * step} y={TOP + row * step} width={cell} height={cell} rx={radius} fill={`var(--heat-${level(d.cents)})`} />;
          })}
          {hover !== null && (
            <rect
              x={left + pos(hover).col * step - 1}
              y={TOP + pos(hover).row * step - 1}
              width={cell + 2}
              height={cell + 2}
              rx={radius + 1}
              fill="none"
              stroke="var(--text)"
              strokeWidth={1.5}
              pointerEvents="none"
            />
          )}
          <rect
            className="hit"
            x={left}
            y={TOP}
            width={weeks * step}
            height={7 * step}
            tabIndex={0}
            aria-label="Valitse päivä nuolinäppäimillä"
            onPointerMove={(e) => e.pointerType === "mouse" && setHover(dayAt(e))}
            onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse") return;
              // a tap shows the day and keeps it; a second tap on the same day hides it
              const i = dayAt(e);
              setHover((h) => (h === i ? null : i));
            }}
            // focus from a tap comes after the tap's own pick, which must win
            onFocus={() => setHover((h) => h ?? last)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              const move: Record<string, number> = { ArrowRight: 7, ArrowLeft: -7, ArrowDown: 1, ArrowUp: -1 };
              if (e.key in move) {
                e.preventDefault();
                setHover((h) => Math.max(0, Math.min(last, (h ?? last) + move[e.key]!)));
              } else if (e.key === "Home" || e.key === "End") {
                e.preventDefault();
                setHover(e.key === "Home" ? 0 : last);
              } else if (e.key === "Escape") {
                setHover(null);
              }
            }}
          />
        </svg>
      )}
      <div className="legend small" style={{ marginTop: 8, alignItems: "center" }} aria-hidden="true">
        <span>Vähemmän</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className="swatch" style={{ background: `var(--heat-${l})` }} />
        ))}
        <span>Enemmän</span>
      </div>
      {hovered && hover !== null && (
        <Tooltip x={left + pos(hover).col * step + cell} y={TOP + pos(hover).row * step - 8} containerWidth={width}>
          <div className="tooltip-title">
            {WEEKDAYS_SHORT[weekday(hovered.date)]} {date(hovered.date)}
          </div>
          <div className="tooltip-row">
            <span className="name">{hovered.count === 0 ? "Ei ostoksia" : hovered.count === 1 ? "1 ostos" : `${hovered.count} ostosta`}</span>
            <strong>{money(hovered.cents)}</strong>
          </div>
        </Tooltip>
      )}
    </div>
  );
}
