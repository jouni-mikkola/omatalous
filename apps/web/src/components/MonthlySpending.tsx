import { REST_CATEGORY } from "@banking/core";
import { useState } from "react";
import { MonthColumns } from "../charts/MonthColumns.tsx";
import { categoryColor } from "../charts/palette.ts";
import { Sparkbars } from "../charts/Sparkbars.tsx";
import { money, monthLong } from "../format.ts";
import { navigate } from "../hooks.ts";
import type { DashboardData } from "../types.ts";

type Trend = DashboardData["trend"];

/** Mean over complete months only, or null when there are none yet. */
function averageOf(values: readonly number[], complete: readonly boolean[]): number | null {
  const full = values.filter((_, i) => complete[i]);
  return full.length ? Math.round(full.reduce((s, v) => s + v, 0) / full.length) : null;
}

function signed(cents: number): string {
  if (Math.abs(cents) < 100) return "±0 €";
  return `${cents > 0 ? "+" : "−"}${money(Math.abs(cents), false)}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * "Menot kuukausittain": the total per month as plain columns, and below
 * it what the active month was made of, category by category, next to
 * that category's own twelve months and its average.
 */
export function MonthlySpending({ trend, colorOrder, range }: { trend: Trend; colorOrder: string[]; range: { from: string; to: string } }) {
  const last = trend.months.length - 1;
  // a month, not an index: the 12-month window moves when the period changes
  const [pinnedMonth, setPinnedMonth] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const pinned = pinnedMonth === null ? -1 : trend.months.indexOf(pinnedMonth);
  // a running month is broken down in the categories card already, and its averages would compare a part with
  // whole months: the breakdown starts from the latest whole month, a click shows any other
  const latestWhole = !trend.complete[last] && trend.complete[last - 1] ? last - 1 : last;
  const active = hover ?? (pinned >= 0 ? pinned : latestWhole);
  const month = trend.months[active]!;
  const inPeriod = (m: string) => m >= range.from.slice(0, 7) && m <= range.to.slice(0, 7);
  const average = averageOf(trend.expenses, trend.complete);
  const total = trend.expenses[active] ?? 0;
  const complete = trend.complete[active] ?? false;
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
            {average !== null && (
              <span>
                <i className="avg-key" />
                Keskiarvo {money(average, false)}
              </span>
            )}
          </div>
          <MonthColumns
            months={trend.months}
            values={trend.expenses}
            average={average}
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
              <span className="muted small">
                {!complete ? "vajaa kuukausi" : average !== null ? `${signed(total - average)} keskiarvosta` : ""}
              </span>
            </div>
            <div className="table-wrap">
            <table className="breakdown-table">
              <thead>
                <tr>
                  <th>Kategoria</th>
                  <th className="spark-col">12 kk</th>
                  <th className="num">{capitalize(monthLong(month).split(" ")[0]!)}</th>
                  <th className="num">Keskiarvo</th>
                  <th className="num">Ero</th>
                  {hasLastYear && <th className="num hide-phone">Viime vuonna</th>}
                </tr>
              </thead>
              <tbody>
                {trend.series.map((s) => {
                  const v = s.values[active] ?? 0;
                  const avg = averageOf(s.values, trend.complete);
                  const diff = complete && avg !== null ? v - avg : null;
                  const color = categoryColor(s.category, colorOrder);
                  const link = s.category !== REST_CATEGORY;
                  return (
                    <tr key={s.category}>
                      <td>
                        <span className="breakdown-label">
                          <i className="swatch" style={{ background: color }} />
                          {link ? (
                            <a
                              href="#/transactions"
                              onClick={(e) => {
                                e.preventDefault();
                                navigate("transactions", { category: s.category, from: `${month}-01`, to: lastDay(month) });
                              }}
                            >
                              {s.label}
                            </a>
                          ) : (
                            s.label
                          )}
                        </span>
                      </td>
                      <td className="spark-col">
                        <Sparkbars values={s.values} active={active} color={color} label={`${s.label}, 12 kuukautta`} />
                      </td>
                      <td className="num">{money(v, false)}</td>
                      <td className="num muted">{avg === null ? "–" : money(avg, false)}</td>
                      <td className={`num ${diff === null || Math.abs(diff) < 100 ? "muted" : diff > 0 ? "worse" : "better"}`}>{diff === null ? "–" : signed(diff)}</td>
                      {/* a month that is not over is no match for a whole month a year ago */}
                      {hasLastYear && <td className="num muted hide-phone">{lastYearTotal && complete ? money(trend.lastYear.series[s.category]?.[active] ?? 0, false) : "–"}</td>}
                    </tr>
                  );
                })}
              </tbody>
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
