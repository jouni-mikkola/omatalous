// Decision: what the money goes to over the last complete months, told once
import { Fragment } from "react";
import type { DashboardData } from "../../types.ts";
import { BarRuler, rulerStyle } from "./BarRuler.tsx";
import { themesTableView } from "./themes-table.ts";
import "../../styles/statement.css";
import "../../styles/overview.css";
import "../../styles/themes-table.css";

/** The row `id` opens or closes: the set of open rows is the caller's, so the month switch does not close them. */
interface Folding {
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

/** The label that opens and closes the rows under it: a button, its whole text in `title` when it is cut. */
function Toggle({ id, label, open, onToggle }: Folding & { id: string; label: string }) {
  return (
    <button type="button" className="themes-toggle" aria-expanded={open.has(id)} onClick={() => onToggle(id)}>
      <span className="themes-label">{label}</span>
    </button>
  );
}

/** The ends of the bracket: its caps on the first and the last theme; an opened theme's lines are parts of that theme, so they stand in a gap. */
const bracket = (adds: boolean, first: boolean, last: boolean) => (adds ? `${first ? " part-first" : ""}${last ? " part-last" : ""}` : "");

/**
 * "Menot kategorioittain" over the last complete months: the themes with the month's and the year's sum and the change,
 * each opening to its lines; the large purchases of the window under the table as a row of their own, because their sum
 * is the window's and not a month's. `report` is the answer of core and is drawn as it comes.
 */
export function ThemesTable({ report, open, onToggle }: { report: NonNullable<DashboardData["themes"]> } & Folding) {
  const view = themesTableView(report);
  return (
    <>
      <div className="themes-head">
        <h3 className="st-cap" id="themes-h">
          Menot kategorioittain
        </h3>
        <span className="st-num">{view.period}</span>
      </div>
      <table className="st-table themes-table ruled" style={rulerStyle(view.ruler)} aria-labelledby="themes-h">
        <thead>
          <tr>
            <td />
            <BarRuler ruler={view.ruler} className="themes-bar" />
            <th scope="col" className="st-num themes-month">
              Kuukaudessa
            </th>
            {view.year && (
              <th scope="col" className="st-num themes-year">
                Vuodessa
              </th>
            )}
            {view.change && (
              <th scope="col" className="st-num themes-change">
                Muutos
              </th>
            )}
          </tr>
        </thead>
        <tbody className={view.adds ? "adds-up" : undefined}>
          {view.rows.map((row, i) => (
            <Fragment key={row.key}>
              <tr className={`themes-row${bracket(view.adds, i === 0, i === view.rows.length - 1)}`}>
                <th scope="row" className="st-cut" title={row.label}>
                  {row.toggle ? <Toggle id={row.key} label={row.label} open={open} onToggle={onToggle} /> : <span className="themes-plain">{row.href ? <a href={row.href}>{row.label}</a> : row.label}</span>}
                </th>
                <td className="category-bar themes-bar">{row.share > 0 && <span style={{ width: `${row.share}%` }} />}</td>
                <td className="st-num themes-month sum">{row.key === "food" ? <a href="#/reports#ruoka">{row.monthly}</a> : row.monthly}</td>
                {view.year && <td className="st-num themes-year">{row.year}</td>}
                {view.change && <td className="st-num themes-change">{row.change}</td>}
              </tr>
              {open.has(row.key) &&
                row.lines.map((line) => (
                  <tr className="themes-line" key={line.key}>
                    <th scope="row" className="st-cut" title={line.label}>
                      {line.href ? <a href={line.href}>{line.label}</a> : line.label}
                    </th>
                    <td className="category-bar themes-bar" />
                    <td className={`st-num themes-month${view.adds ? " sum-pad" : ""}`}>{line.monthly}</td>
                    {view.year && <td className="st-num themes-year">{line.year}</td>}
                    {view.change && <td className="st-num themes-change">{line.change}</td>}
                  </tr>
                ))}
            </Fragment>
          ))}
          <tr className="themes-total">
            <th scope="row">Yhteensä</th>
            <td className="category-bar themes-bar" />
            <td className="st-num themes-month">{view.total.monthly}</td>
            {view.year && <td className="st-num themes-year">{view.total.year}</td>}
            {view.change && <td className="st-num themes-change" />}
          </tr>
        </tbody>
      </table>
      {view.large && (
        <div className="themes-large">
          <div className="st-row">
            <div className="st-name">
              <Toggle id="large" label={view.large.label} open={open} onToggle={onToggle} />
            </div>
            <span className="st-num">{view.large.sum}</span>
          </div>
          {open.has("large") && (
            <ul className="st-rows themes-large-rows">
              {view.large.rows.map((r) => (
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
      )}
    </>
  );
}
