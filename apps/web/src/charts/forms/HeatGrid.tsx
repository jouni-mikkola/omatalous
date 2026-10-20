// Decision: find the month a category jumped, and whether it jumped once or stayed up
import type { PivotReport } from "@banking/core";
import { useState } from "react";
import { useWidth } from "../../hooks.ts";
import { money, monthLabel, monthLong } from "../../format.ts";
import { HeatKey } from "../CalendarHeat.tsx";
import { LiveReadout } from "../kit/Readout.tsx";
import { cellHref } from "./heat-link.ts";

const ROW_H = 22;
const GAP = 2;
/** A phone shows this many months at a time, the newest first, and steps to the older ones sideways (critic 9.1). */
const PHONE_MONTHS = 6;

/**
 * Categories by months as cells shaded by core's `heat` (the month against the row's own average), so a jump reads as a
 * dark cell in a light row whatever the row's size and a steady bill stays plain. A phone shows six months at a time. A month with nothing is a hairline square; the cell the answer names is ringed.
 * The row's total stands at the right. A cell reads out on hover, tap or focus.
 */
export function HeatGrid({ r, months: all }: { r: PivotReport; months: number[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<{ row: number; col: number } | null>(null);
  const [chosen, setPage] = useState<number | null>(null);
  const rows = [...r.rows].filter((x) => x.totalCents > 0).sort((a, b) => (a.totalCents > b.totalCents ? -1 : a.totalCents < b.totalCents ? 1 : 0));
  const narrow = width < 560;
  const pages = narrow ? Math.ceil(all.length / PHONE_MONTHS) : 1;
  // a phone opens on the months that hold the answer (core's jump), the newest six without one
  const answered = r.jump ? all.indexOf(r.jump.month) : -1;
  const opening = answered < 0 ? 0 : Math.floor((all.length - 1 - answered) / PHONE_MONTHS);
  const shownPage = Math.min(chosen ?? opening, pages - 1);
  const months = narrow ? all.slice(Math.max(0, all.length - PHONE_MONTHS * (shownPage + 1)), all.length - PHONE_MONTHS * shownPage) : all;
  const labelW = narrow ? 104 : 200;
  const totalW = narrow ? 0 : 96;
  const cell = Math.max(8, Math.min(72, (width - labelW - totalW) / Math.max(months.length, 1)));
  const gridW = cell * months.length;
  const height = 20 + rows.length * ROW_H;
  const read = at && `${rows[at.row]!.label}, ${monthLong(r.months[months[at.col]!]!)}: ${money(rows[at.row]!.values[months[at.col]!]!, false)}`;
  const name = (s: string) => (narrow && s.length > 14 ? `${s.slice(0, 13)}…` : s);
  return (
    <div className="chart heat-grid" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Menot kategorioittain ja kuukausittain, kunkin rivin oman keskiarvon mukaan sävytettynä">
          {months.map((m, c) => (
            <text key={m} x={labelW + c * cell + cell / 2} y={12} textAnchor="middle">
              {monthLabel(r.months[m]!)}
            </text>
          ))}
          {rows.map((row, ri) => {
            // the one ring is the answer's cell (critic round 3: a ring on every row's peak hid it)
            const ringAt = r.jump && r.jump.category === row.category && r.jump.label === row.label ? r.jump.month : -1;
            const y = 20 + ri * ROW_H;
            return (
              <g key={row.category}>
                <text x={0} y={y + ROW_H / 2} dy="0.32em" className={at?.row === ri ? "heat-name heat-on" : "heat-name"}>
                  {name(row.label)}
                </text>
                {months.map((m, c) => {
                  // a month with nothing is a hairline square; a steady row's months are plain (core's 0)
                  const bin = (row.values[m] ?? 0) <= 0 ? "none" : (row.heat[m] ?? 0);
                  return (
                    <rect
                      key={m}
                      className={`heat-cell heat-b${bin}${m === ringAt ? " heat-peak" : ""}${at?.row === ri && at.col === c ? " heat-active" : ""}`}
                      x={labelW + c * cell + GAP / 2}
                      y={y + GAP / 2}
                      width={cell - GAP}
                      height={ROW_H - GAP}
                      rx={2}
                      tabIndex={c === 0 && ri === 0 ? 0 : -1}
                      style={(row.values[m] ?? 0) > 0 ? { cursor: "pointer" } : undefined}
                      onClick={() => {
                        if ((row.values[m] ?? 0) > 0) window.location.hash = cellHref(row.category, r.months[m]!);
                      }}
                      onPointerEnter={() => setAt({ row: ri, col: c })}
                      onPointerDown={() => setAt({ row: ri, col: c })}
                      onFocus={() => setAt({ row: ri, col: c })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (row.values[m] ?? 0) > 0) {
                          window.location.hash = cellHref(row.category, r.months[m]!);
                          return;
                        }
                        const next = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
                        if (!next) return;
                        e.preventDefault();
                        const nr = Math.max(0, Math.min(rows.length - 1, ri + next[0]!));
                        const nc = Math.max(0, Math.min(months.length - 1, c + next[1]!));
                        const target = e.currentTarget.ownerSVGElement?.querySelectorAll<SVGRectElement>("rect.heat-cell")[nr * months.length + nc];
                        target?.focus();
                      }}
                    />
                  );
                })}
                {totalW > 0 && (
                  <text x={labelW + gridW + totalW} y={y + ROW_H / 2} dy="0.32em" textAnchor="end" className="heat-total">
                    {money(row.printedCents, false)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <p className="heat-read" aria-hidden="true">
        {read ?? " "}
      </p>
      <LiveReadout text={read ?? ""} />
      {pages > 1 && (
        <div className="segmented heat-pages" role="group" aria-label="Kuukaudet">
          <button type="button" disabled={shownPage >= pages - 1} onClick={() => setPage(shownPage + 1)}>
            ← Aiemmat
          </button>
          <button type="button" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>
            Uudemmat →
          </button>
        </div>
      )}
      <HeatKey plain="Tasainen rivi on harmaa." />
    </div>
  );
}
