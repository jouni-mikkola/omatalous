// Decision: where the month's money went, told once
import { useState } from "react";
import { query } from "../../api.ts";
import { PaceChart } from "../../charts/PaceChart.tsx";
import { navigate } from "../../hooks.ts";
import type { PeriodPreset } from "../../period.ts";
import type { DashboardData } from "../../types.ts";
import { type IncomeSpendingView, incomeSpendingView, monthName } from "./income-spending.ts";
import { BarRuler, rulerStyle } from "./BarRuler.tsx";
import { ThemesTable } from "./ThemesTable.tsx";
import { OPEN_AT_FIRST, toggled } from "./themes-table.ts";
import "../../styles/overview.css";
import "../../styles/statement.css";

/** The sections of Raportit the block links to, by their anchors: the page that mounts the block names them. */
interface ReportAnchors {
  income: string;
  months: string;
}

/**
 * The block "Tulot ja menot": what came in and went out in the chosen month and on what. The month switch is in its head,
 * because it changes this block and nothing above it. `data` is the answer for the chosen month, or null while it is on
 * its way: the head stays, so the switch does not flicker away.
 */
export function IncomeSpending({ data, period, presets, anchors }: { data: DashboardData | null; period: string; presets: readonly PeriodPreset[]; anchors: ReportAnchors }) {
  // the rows of the table of themes that are open stay so while the next month's answer is on its way
  const [open, setOpen] = useState(OPEN_AT_FIRST);
  return (
    <section className="card st-block" aria-labelledby="income-spending-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="income-spending-h">Tulot ja menot</h2>
        </div>
        <div className="card-tool">
          <div className="segmented" role="group" aria-label="Kuukausi">
            {presets.map((p) => (
              <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => navigate("overview", { period: p.id })}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {data ? <Month data={data} anchors={anchors} open={open} onToggle={(id) => setOpen((rows) => toggled(rows, id))} /> : <p className="muted st-wait" role="status">Ladataan…</p>}
    </section>
  );
}

/**
 * The month in two groups: at the left the two months' figures as a table, two rows under a rule and the chart of the
 * running month; at the right the categories as a table. The right group takes two of the block's three columns. When
 * core has the themes of the last complete months their table takes the place of the month's list of categories.
 */
function Month({ data, anchors, open, onToggle }: { data: DashboardData; anchors: ReportAnchors; open: ReadonlySet<string>; onToggle: (id: string) => void }) {
  const view = incomeSpendingView(data);
  const { from, to } = data.range;
  const link = { Tulot: `#/reports#${anchors.income}`, Menot: `#/transactions${query({ from, to })}` };
  const { pace } = data;
  // the rate is the month before's while a month runs: its label opens that month, and names it once it is the one shown
  const savingsHref = data.running ? `#/overview${query({ period: "last-month" })}` : null;
  return (
    <div className="st-cols st-cols-3">
      <div>
        <table className="st-table month-table ruled">
          <thead>
            <tr>
              <td />
              <th scope="col" className="st-num">
                {view.month}
              </th>
              {view.previous && (
                <th scope="col" className="st-num">
                  {view.previous.month}
                  {view.previous.by && (
                    <>
                      {" "}
                      <span className="month-by">{view.previous.by}</span>
                    </>
                  )}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {view.figures.map((f) => (
              <tr key={f.label}>
                <th scope="row">
                  <a href={link[f.label]}>{f.label}</a>
                </th>
                <td className="st-num st-strong">{f.text}</td>
                {view.previous && <td className="st-num">{f.previous}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {(view.savings || view.fixed) && (
          <dl className="st-rows month-more">
            {view.savings && (
              <div className="st-row">
                <dt className="st-name">{savingsHref ? <a href={savingsHref}>{view.savings.label}</a> : view.savings.label}</dt>
                <dd className="st-num">{view.savings.text}</dd>
              </div>
            )}
            {view.fixed && (
              <div className="st-row">
                <dt className="st-name">
                  <a href="#/bills">Kiinteät menot kuukaudessa</a>
                </dt>
                <dd className="st-num">{view.fixed}</dd>
              </div>
            )}
          </dl>
        )}
        {view.chart && (
          <>
            <h3 className="st-cap month-chart">Menojen kertymä</h3>
            <PaceChart current={pace.current} previous={pace.previous?.curve ?? null} names={{ current: monthName(pace.month), previous: pace.previous ? monthName(pace.previous.month) : "" }} />
          </>
        )}
      </div>
      <div className="st-wide">
        {data.themes ? <ThemesTable report={data.themes} open={open} onToggle={onToggle} /> : <MonthCategories view={view} from={from} to={to} />}
        {view.categories.length > 0 && (
          <p className="st-links">
            <a href={`#/transactions${query({ view: "merchants", from, to })}`}>Kauppiaat</a>
            <a href={`#/reports${query({ period: "12m" })}#${anchors.months}`}>Menot kuukausittain</a>
          </p>
        )}
      </div>
    </div>
  );
}

/** The month's list of categories, as the block drew it before core told the themes: the nine largest and the rest. */
function MonthCategories({ view, from, to }: { view: IncomeSpendingView; from: string; to: string }) {
  return (
    <>
      <h3 className="st-cap" id="categories-h">
        Menot kategorioittain
      </h3>
      <table className="st-table category-table" style={rulerStyle(view.ruler)} aria-labelledby="categories-h">
        <thead>
          <tr>
            <th scope="col">Kategoria</th>
            <BarRuler ruler={view.ruler} />
            <th scope="col" className="st-num">
              {view.month}
            </th>
            {view.previous && (
              <th scope="col" className="st-num">
                Muutos
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {view.categories.map((c) => (
            <tr key={c.key}>
              <th scope="row" className="st-cut" title={c.label}>
                {c.category ? <a href={`#/transactions${query({ category: c.category, from, to })}`}>{c.label}</a> : c.label}
              </th>
              <td className="category-bar">
                <span style={{ width: `${c.share}%` }} />
              </td>
              <td className="st-num">{c.text}</td>
              {view.previous && <td className="st-num">{c.change}</td>}
            </tr>
          ))}
          {view.empty && (
            <tr>
              <td colSpan={view.previous ? 4 : 3}>{view.empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
