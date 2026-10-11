import { REST_CATEGORY } from "@banking/core";
import { type ReactNode, useState } from "react";
import { MonthColumns } from "../charts/MonthColumns.tsx";
import { categoryColor } from "../charts/palette.ts";
import { Sparkbars } from "../charts/Sparkbars.tsx";
import { money, monthLong, monthSpan } from "../format.ts";
import { navigate } from "../hooks.ts";
import { breakdownRows } from "./month-parts.ts";
import type { DashboardData } from "../types.ts";
import "../styles/charts.css";
import "../styles/month.css";
import "../styles/overview.css";

type Trend = DashboardData["trend"];
type Explanation = NonNullable<Trend["explanations"][number]>;

function signed(cents: number): string {
  if (Math.abs(cents) < 100) return "±0 €";
  return `${cents > 0 ? "+" : "−"}${money(Math.abs(cents), false)}`;
}

/** The change as a signed amount, coloured only when it is worth a look. */
function Change({ cents }: { cents: number }) {
  return <span className={Math.abs(cents) < 100 ? "" : cents > 0 ? "worse" : "better"}>{signed(cents)}</span>;
}

function headNote(e: Explanation | null, complete: boolean): ReactNode {
  if (!e) return complete ? "" : "vajaa kuukausi";
  return (
    <>
      {e.running && "kesken, "}
      <Change cents={e.changeCents} />
      {` tavallisesta${e.running ? " samoilta päiviltä" : ""} (${money(e.usualCents, false)}, ${monthSpan(e.basis)})`}
    </>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * "Menot kuukausittain": the total per month as plain columns, and below
 * it what made the active month differ from a usual one: the categories
 * that moved most, with the cause where the data shows one.
 */
export function MonthlySpending({ trend, colorOrder, range }: { trend: Trend; colorOrder: string[]; range: { from: string; to: string } }) {
  const last = trend.months.length - 1;
  // a month, not an index: the 12-month window moves when the period changes
  const [pinnedMonth, setPinnedMonth] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const pinned = pinnedMonth === null ? -1 : trend.months.indexOf(pinnedMonth);
  // a running month is broken down in the categories card already: the breakdown starts from the latest whole
  // month, a click shows any other
  const latestWhole = !trend.complete[last] && trend.complete[last - 1] ? last - 1 : last;
  const active = hover ?? (pinned >= 0 ? pinned : latestWhole);
  const month = trend.months[active]!;
  const inPeriod = (m: string) => m >= range.from.slice(0, 7) && m <= range.to.slice(0, 7);
  // the dashed line is the usual level of the month the breakdown starts from or the one that was clicked, so it does
  // not move (and rescale the chart) while the pointer passes over the columns
  const usualAt = pinned >= 0 ? pinned : latestWhole;
  const usual = trend.usual[usualAt] ?? null;
  // the forecast card names another month's usual level, so the legend names the months this one stands on
  const usualBasis = trend.explanations[usualAt]?.basis ?? [];
  const explanation = trend.explanations[active] ?? null;
  const total = trend.expenses[active] ?? 0;
  const complete = trend.complete[active] ?? false;
  const rows = breakdownRows(trend, active);
  // the same month a year earlier, once the history reaches back that far
  const hasLastYear = trend.lastYear.expenses.some((v) => v !== 0);
  const lastYearTotal = trend.lastYear.expenses[active] ?? 0;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Menot kuukausittain</h2>
        </div>
        <button className="btn btn-small" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? "Kaavio" : "Taulukko"}
        </button>
      </div>

      {showTable ? (
        <TrendTable trend={trend} />
      ) : (
        <>
          <div className="legend" aria-hidden="true">
            <span>
              <i className="swatch swatch-in" />
              Valittu jakso
            </span>
            <span>
              <i className="swatch swatch-out" />
              Muut kuukaudet
            </span>
            {trend.complete.some((c, i) => !c && (trend.expenses[i] ?? 0) > 0) && (
              <span>
                <i className="swatch swatch-hatch" />
                Vajaa kuukausi
              </span>
            )}
            {usual !== null && (
              <span>
                <i className="avg-key" />
                Tavallisesti {money(usual, false)}
                {usualBasis.length > 0 && ` (${monthSpan(usualBasis)})`}
              </span>
            )}
          </div>
          <MonthColumns
            months={trend.months}
            values={trend.expenses}
            average={usual}
            inPeriod={inPeriod}
            complete={trend.complete}
            active={active}
            pinned={pinned}
            onHover={setHover}
            onPick={(i) => {
              // a tap leaves focus, and so hover, on the column; without this, unpinning would show no change
              setHover(null);
              setPinnedMonth((m) => (m === trend.months[i] ? null : trend.months[i]!));
            }}
          />

          <div className="breakdown">
            <div className="breakdown-head" aria-live="polite">
              <strong>{capitalize(monthLong(month))}</strong>
              <span>{money(total, false)}</span>
              <span className="muted small">{headNote(explanation, complete)}</span>
            </div>
            {!explanation && (
              <p className="muted small explain-empty">
                Selitys näyttää, mikä erotti kuukauden tavallisesta. Se näkyy, kun ennen kuukautta on kolme valmista kuukautta.
              </p>
            )}
            <div className="table-wrap">
              <table className="breakdown-table explain-table">
                <thead>
                  <tr>
                    <th>Kategoria</th>
                    <th className="spark-col">12 kuukautta</th>
                    <th className="num">{capitalize(monthLong(month).split(" ")[0]!)}</th>
                    {explanation && <th className="num">Tavallisesti</th>}
                    {explanation && <th className="num">Ero</th>}
                    {hasLastYear && <th className="num hide-phone">Viime vuonna</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const color = categoryColor(row.category ?? REST_CATEGORY, colorOrder);
                    const series = row.category ? trend.series.find((x) => x.category === row.category) : undefined;
                    const lastYear = row.category ? trend.lastYear.series[row.category] : undefined;
                    return (
                      <tr key={row.key}>
                        <td>
                          <span className="breakdown-label">
                            <i className="swatch" style={{ background: color }} />
                            {row.category ? (
                              <a
                                href="#/transactions"
                                onClick={(e) => {
                                  e.preventDefault();
                                  navigate("transactions", { category: row.category!, from: `${month}-01`, to: lastDay(month) });
                                }}
                              >
                                {row.label}
                              </a>
                            ) : (
                              row.label
                            )}
                          </span>
                          {row.cause && <span className="explain-cause muted small">{row.cause}</span>}
                        </td>
                        <td className="spark-col">{series && <Sparkbars values={series.values} active={active} color={color} label={`${row.label}, 12 kuukautta`} />}</td>
                        <td className="num">{money(row.now, false)}</td>
                        {explanation && <td className="num muted">{row.usual === null ? "–" : money(row.usual, false)}</td>}
                        {explanation && <td className="num">{row.change === null ? "–" : <Change cents={row.change} />}</td>}
                        {/* a month that is not over is no match for a whole month a year ago */}
                        {hasLastYear && <td className="num muted hide-phone">{lastYearTotal && complete && lastYear ? money(lastYear[active] ?? 0, false) : "–"}</td>}
                      </tr>
                    );
                  })}
                </tbody>
                {explanation && (
                  <tfoot>
                    <tr>
                      <td>Yhteensä</td>
                      <td className="spark-col" />
                      <td className="num">{money(explanation.nowCents, false)}</td>
                      <td className="num muted">{money(explanation.usualCents, false)}</td>
                      <td className="num">
                        <Change cents={explanation.changeCents} />
                      </td>
                      {hasLastYear && <td className="hide-phone" />}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TrendTable({ trend }: { trend: Trend }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Kuukausi</th>
            {trend.series.map((s) => (
              <th key={s.category} className="num">
                {s.label}
              </th>
            ))}
            <th className="num">Menot</th>
            <th className="num">Tulot</th>
          </tr>
        </thead>
        <tbody>
          {trend.months.map((m, i) => (
            <tr key={m}>
              <td>
                {monthLong(m)}
                {!trend.complete[i] && <span className="muted"> (vajaa)</span>}
              </td>
              {trend.series.map((s) => (
                <td key={s.category} className="num">
                  {money(s.values[i] ?? 0, false)}
                </td>
              ))}
              <td className="num">
                <strong>{money(trend.expenses[i] ?? 0, false)}</strong>
              </td>
              <td className="num">{money(trend.income[i] ?? 0, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
