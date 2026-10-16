// Decision: the month's money as a waterfall, read at a glance, and the joint pools' sentence under it
import type { CSSProperties } from "react";
import { money } from "../../format.ts";
import type { Scope, WaterfallAnswer, SettlementAnswer } from "../../types.ts";
import { Why } from "../Why.tsx";
import {
  EMPTY_MONTH,
  settlementSentences,
  summaryOf,
  waterfallRows,
  type WaterfallRow,
} from "./waterfall.ts";
import "../../styles/waterfall.css";

type Range = { from: string; to: string };

/** The drawn bar. */
const BAR = <span className="wf-bar" />;

/** The bar of a row: a button that opens the rows of income, one category or Yli jäi; the other bars have no figure to open and are drawn only. */
function trackOf(row: WaterfallRow, range: Range, scope: Scope) {
  if (row.key === "income")
    return (
      <Why
        figure="income.month"
        title={row.label}
        range={range}
        scope={scope}
        className="wf-track wf-hit"
      >
        {BAR}
      </Why>
    );
  if (row.key === "left")
    return (
      <Why
        figure="yli_jai.month"
        title={row.label}
        range={range}
        scope={scope}
        className="wf-track wf-hit"
      >
        {BAR}
      </Why>
    );
  if (row.key.startsWith("category:"))
    return (
      <Why
        figure="spend.category"
        title={row.label}
        range={range}
        scope={scope}
        category={row.key.slice("category:".length)}
        className="wf-track wf-hit"
      >
        {BAR}
      </Why>
    );
  return (
    <span className="wf-track" aria-hidden="true">
      {BAR}
    </span>
  );
}

/**
 * One bar for each item, in the order the server gives: income up, spending down, Yli jäi last. The bar of a figure Miksi? can open is a button that opens its rows. Up is a solid bar and down
 * a hatched one, and every figure has its sign, so colour is not the only cue. The bars are for the eye; a table of the
 * same figures with the running total and one sentence are for a reader who does not see them.
 */
export function Waterfall({
  waterfall,
  categories,
  range,
  scope,
}: {
  waterfall: WaterfallAnswer | null;
  categories: ReadonlyMap<string, string>;
  range: Range;
  scope: Scope;
}) {
  if (!waterfall) return <p className="wf-empty">{EMPTY_MONTH}</p>;
  const rows = waterfallRows(waterfall, categories);
  return (
    <div className="wf">
      <p className="sr-only">{summaryOf(waterfall)}</p>
      <ol className="st-rows wf-rows">
        {rows.map((r) => (
          <li
            key={r.key}
            className={`st-row wf-row wf-${r.kind}`}
            style={
              {
                "--at": `${r.at}%`,
                "--span": `${r.span}%`,
                "--zero": `${r.zero}%`,
              } as CSSProperties
            }
          >
            <span className="wf-name">
              <span className="wf-label" title={r.label}>
                {r.label}
              </span>
            </span>
            {trackOf(r, range, scope)}
            <span className="st-num wf-fig">{r.text}</span>
          </li>
        ))}
      </ol>
      <div className="sr-only">
        <table>
          <caption>Tulot ja menot taulukkona</caption>
          <thead>
            <tr>
              <th scope="col">Erä</th>
              <th scope="col">Summa</th>
              <th scope="col">Kertymä</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td>{r.text}</td>
                <td>{money(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** What the joint pools' members paid above their share, with the way to the whole report. */
export function Settlement({
  pools,
  anchor,
}: {
  pools: readonly SettlementAnswer[];
  anchor: string;
}) {
  const lines = settlementSentences(pools);
  if (!lines.length) return null;
  return (
    <div className="wf-settle">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p className="st-links">
        <a href={`#/reports#${anchor}`}>Yhteiset menot</a>
      </p>
    </div>
  );
}
