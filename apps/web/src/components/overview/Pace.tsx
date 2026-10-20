// Decision: is the month's spending on its usual course, or should the household slow down before payday
import { DataTable } from "../table/DataTable.tsx";
import { MIN_COMPARE_MONTHS } from "@banking/core";
import { useState } from "react";
import { completeMonths, money } from "../../format.ts";
import { estimateRange, PaceChart, paceDay } from "../../charts/PaceChart.tsx";
import type { DashboardData, Scope } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { TableToggle } from "../TableToggle.tsx";
import { Why } from "../Why.tsx";
import { monthName } from "./income-spending.ts";
import "../../styles/overview.css";

/** "Lokakuu": a month's name as a label starts it. */
const label = (month: string) => {
  const name = monthName(month);
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** The answer under the panel's name: the month so far against the usual month to the same day, else against the month before. */
export function paceAnswer(pace: DashboardData["pace"]): string {
  const spent = `Menoja on ${money(pace.currentTotal, false)}`;
  const { usual, previous } = pace;
  if (usual) {
    // under a euro either way is the usual pace
    if (Math.abs(usual.diffCents) < 100) return `${spent}, saman verran kuin tavallisesti tähän päivään mennessä.`;
    return `${spent}, ${money(Math.abs(usual.diffCents), false)} ${usual.diffCents > 0 ? "enemmän" : "vähemmän"} kuin tavallisesti tähän päivään mennessä.`;
  }
  if (previous) return `${spent}. Edellinen kuu samaan päivään ${money(previous.toToday, false)}.`;
  return `${spent}.`;
}

/** The days the pace's figure covers: the month's first day to the last day it has a value for (today in a running month). */
export function paceRange(pace: DashboardData["pace"]): { from: string; to: string } {
  const day = pace.current.reduce<number>((n, v, i) => (v === null ? n : i + 1), 0);
  return { from: `${pace.month}-01`, to: `${pace.month}-${String(Math.max(1, day)).padStart(2, "0")}` };
}

/**
 * Menot tässä kuussa, the first panel under the key figures: the month to date against the household's usual month
 * (`PaceChart`), its answer in one sentence, the figure in the head opening its rows. Under three complete months the
 * chart says when the usual appears. The table view lists the days.
 */
export function Pace({ data, scope }: { data: DashboardData; scope: Scope }) {
  const [table, setTable] = useState(false);
  const { pace, ahead } = data;
  const month = pace.month;
  const range = paceRange(pace);
  const payday = ahead?.payday && ahead.payday.date.startsWith(month) ? Number(ahead.payday.date.slice(8, 10)) : null;
  const names = { current: label(month), previous: pace.previous ? label(pace.previous.month) : "" };
  return (
    <section className="card pace" aria-labelledby="pace-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="pace-h">Menot tässä kuussa</h2>
          <p className="card-sub pace-answer">{paceAnswer(pace)}</p>
        </div>
        <div className="card-datum">
          <Why figure="spend.month" title="Menot tässä kuussa" range={range} scope={scope} text={money(pace.currentTotal)}>
            <Figure text={money(pace.currentTotal)} size="s" />
          </Why>
        </div>
        <div className="card-tool">
          <TableToggle table={table} onChange={setTable} />
        </div>
      </div>
      {table ? <PaceTable pace={data.pace} names={names} /> : <PaceChart pace={pace} payday={payday} names={names} />}
      {!pace.usual && <p className="pace-gate">Vertailu tavalliseen näkyy, kun takana on {completeMonths(MIN_COMPARE_MONTHS)}.</p>}
    </section>
  );
}

/** The chart's days as a table: what each line says on each day, the estimate from today on. */
function PaceTable({ pace, names }: { pace: DashboardData["pace"]; names: { current: string; previous: string } }) {
  const days = Array.from({ length: pace.daysInMonth }, (_, i) => paceDay(pace, i + 1));
  return (
    <div className="pace-table">
      <DataTable
        id="pace"
        caption={`${names.current} päivittäin`}
        rows={days}
        rowKey={(d) => String(d.day)}
        phone="cards"
        columns={[
          { key: "day", label: "Päivä", kind: "text", rowHead: true, cell: (d) => `${d.day}.` },
          { key: "current", label: names.current, kind: "money", precision: "cents", main: true, cents: (d) => d.current },
          ...(pace.usual ? [{ key: "usual", label: "Tavallisesti", kind: "money" as const, precision: "cents" as const, cents: (d: (typeof days)[number]) => d.usual }] : []),
          ...(pace.previous ? [{ key: "previous", label: names.previous, kind: "money" as const, precision: "cents" as const, cents: (d: (typeof days)[number]) => d.previous }] : []),
          ...(pace.projection
            ? [
                {
                  key: "estimate",
                  label: "Arvio",
                  kind: "money" as const,
                  className: () => "fig-est",
                  cell: (d: (typeof days)[number]) => (d.projection && d.current === null ? estimateRange(d.projection[0], d.projection[1]) : ""),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
