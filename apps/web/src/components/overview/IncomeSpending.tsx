// Decision: where the month's money went, told once
import { useState } from "react";
import { query } from "../../api.ts";
import { money } from "../../format.ts";
import { navigate } from "../../hooks.ts";
import type { PeriodPreset } from "../../period.ts";
import type { DashboardData, Scope } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { type IncomeSpendingView, incomeSpendingView } from "./income-spending.ts";
import { Settlement, Waterfall } from "./Waterfall.tsx";
import { type OpenRow, openKey, toggledRow } from "./waterfall.ts";
import "../../styles/overview.css";
import "../../styles/statement.css";

/** The sections of Raportit the block links to, by their anchors: the page that mounts the block names them. */
interface ReportAnchors {
  settlement: string;
}

/**
 * The block "Tulot ja menot": what came in and went out in the chosen month and on what. The month switch is in its head,
 * because it changes this block and nothing above it. `data` is the answer for the chosen month, or null while it is on
 * its way: the head stays, so the switch does not flicker away.
 */
export function IncomeSpending({ data, scope, period, presets, anchors, categories }: { data: DashboardData | null; scope: Scope; period: string; presets: readonly PeriodPreset[]; anchors: ReportAnchors; categories: ReadonlyMap<string, string> }) {
  // the one open row of the waterfall; a month switch closes it
  const [row, setRow] = useState<OpenRow>(null);
  return (
    <section className="card st-block" aria-labelledby="income-spending-h">
      <div className="card-head tb">
        <div className="card-name">
          <h2 id="income-spending-h">Tulot ja menot</h2>
        </div>
        {data?.waterfall && (
          <div className="card-datum">
            <span className="datum-label">Yli jäi</span>
            <Figure text={money(data.waterfall.leftCents)} size="s" />
          </div>
        )}
        <div className="card-tool">
          <div className="segmented" role="group" aria-label="Kuukausi">
            {presets.map((p) => (
              <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => {
                  setRow(null);
                  navigate("overview", { period: p.id });
                }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {data ? <Month data={data} scope={scope} anchors={anchors} categories={categories} row={row} onRow={(month, key) => setRow((was) => toggledRow(was, month, key))} /> : <p className="muted st-wait" role="status">Ladataan…</p>}
    </section>
  );
}

/**
 * The month: the waterfall with the savings rate and the fixed costs under Yli jäi and the joint pools' sentence; under
 * them the month's large purchases. The running month's pace is the panel at the top of the page (`Pace`).
 */
function Month({ data, scope, anchors, categories, row, onRow }: { data: DashboardData; scope: Scope; anchors: ReportAnchors; categories: ReadonlyMap<string, string>; row: OpenRow; onRow: (month: string, key: string) => void }) {
  const view = incomeSpendingView(data);
  const { from, to } = data.range;
  // the rate is the month before's while a month runs: its label opens that month, and names it once it is the one shown
  const savingsHref = data.running ? `#/overview${query({ period: "last-month" })}` : null;
  const hrefs = { category: (category: string) => `#/transactions${query({ category, from, to })}`, payee: (merchant: string) => `#/transactions${query({ merchant, from, to })}`, income: `#/transactions${query({ kind: "income", from, to })}` };
  const month = data.waterfall?.month ?? "";
  return (
    <>
      <div className="st-part">
        <Waterfall waterfall={data.waterfall} categories={categories} range={{ from, to }} scope={scope} hrefs={hrefs} before={view.before} open={openKey(row, month)} onToggle={(key) => onRow(month, key)} />
        {view.note && <p className="st-note">{view.note}</p>}
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
                  <a href="#/bills">Kiinteät menot kuussa</a>
                </dt>
                <dd className="st-num">{view.fixed}</dd>
              </div>
            )}
          </dl>
        )}
        {data.waterfall !== null && <Settlement pools={data.settlement} anchor={anchors.settlement} />}
      </div>
      {view.large && (
        <div className="st-part">
          <LargePurchases large={view.large} />
        </div>
      )}
    </>
  );
}

/** The large purchases under the chart: a row that opens to each purchase, with its day, its payee and its sum. */
function LargePurchases({ large }: { large: NonNullable<IncomeSpendingView["large"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="themes-large">
      <div className="st-row">
        <div className="st-name">
          <button type="button" className="themes-toggle" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
            <span className="themes-label">{large.label}</span>
          </button>
        </div>
        <span className="st-num">{large.sum}</span>
      </div>
      {open && (
        <ul className="st-rows themes-large-rows">
          {large.rows.map((r) => (
            <li className="st-row" key={r.key}>
              <span className="st-num themes-date">{r.date}</span>
              <span className="st-name" title={r.payee}>
                {r.payee}
              </span>
              <span className="st-num">{r.sum}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
