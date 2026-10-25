// Decision: the month's money as a waterfall, read at a glance, and the joint pools' sentence under it
import type { CSSProperties } from "react";
import { signedMoney } from "../../format.ts";
import type { Scope, WaterfallAnswer, SettlementAnswer } from "../../types.ts";
import { DeltaChip } from "../table/Cells.tsx";
import { CategoryParts } from "../CategoryParts.tsx";
import { Why } from "../Why.tsx";
import {
  CARD_GAP,
  EMPTY_MONTH,
  settlementSentences,
  summaryOf,
  waterfallRows,
  type Before,
  type Hrefs,
  type WaterfallRow,
} from "./waterfall.ts";
import "../../styles/themes-table.css";
import "../../styles/waterfall.css";

type Range = { from: string; to: string };

/** The drawn bar, with a 2 px tick where the usual month's bar would end. */
const barOf = (row: WaterfallRow) => (
  <>
    <span className="wf-bar" />
    {row.usualAt !== null && <span className="wf-usual" style={{ left: `${row.usualAt}%` }} />}
  </>
);

/** The bar of a row: a button that opens the rows of income, one category or Tulos; the other bars have no figure to open and are drawn only. */
function trackOf(row: WaterfallRow, range: Range, scope: Scope) {
  const BAR = barOf(row);
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
 * One bar for each item, in the order the server gives: income up, spending down, Tulos last. The name of every row but Tulos is a button that opens what the bar is made of, one row at a time (`open` is the key of the open row, the caller's, so it can close with the month); the bar of a figure Miksi? can open is a button that opens its rows. Up is a solid bar and down
 * a hatched one, and every figure has its sign, so colour is not the only cue. With a usual month each bar carries a tick
 * where the usual bar would end and a chip of the difference (more spent is bad, more income good; the transfers have none). The bars are for the eye; the rows say the same in words, and one sentence tells a reader who does not see the bars.
 */
export function Waterfall({
  waterfall,
  categories,
  range,
  scope,
  hrefs,
  before,
  open,
  onToggle,
}: {
  waterfall: WaterfallAnswer | null;
  categories: ReadonlyMap<string, string>;
  range: Range;
  scope: Scope;
  hrefs: Hrefs;
  before: Before | null;
  open: string | null;
  onToggle: (key: string) => void;
}) {
  if (!waterfall) return <p className="wf-empty">{EMPTY_MONTH}</p>;
  const rows = waterfallRows(waterfall, categories, hrefs, before);
  const vs = rows.some((r) => r.vsUsual);
  return (
    <div className={vs ? "wf wf-vs" : "wf"}>
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
              {r.lines.length ? (
                <button type="button" className="themes-toggle wf-toggle" aria-expanded={open === r.key} onClick={() => onToggle(r.key)}>
                  <span className="wf-label" title={r.label}>
                    {r.label}
                  </span>
                </button>
              ) : (
                <span className="wf-label" title={r.label}>
                  {r.label}
                </span>
              )}
            </span>
            {trackOf(r, range, scope)}
            <span className="st-num wf-fig">{r.text}</span>
            {vs && (
              <span className="wf-chip">
                {r.vsUsual && (
                  <>
                    <DeltaChip delta={r.vsUsual.delta} text={signedMoney(r.vsUsual.delta)} meaning={r.vsUsual.meaning} flat={99} />
                    <span className="sr-only"> tavallisesta</span>
                  </>
                )}
              </span>
            )}
            {open === r.key && r.lines.length > 0 && (
              <div className="wf-detail">
                <CategoryParts parts={r.split} label={`${r.label} tuoteryhmittäin`} />
                <ul className="st-rows">
                  {r.lines.map((l) => (
                    <li className="st-row" key={l.key}>
                      <span className="st-name" title={l.label}>
                        {l.href ? <a href={l.href}>{l.label}</a> : l.label}
                      </span>
                      <span className="st-num">{l.text}</span>
                    </li>
                  ))}
                </ul>
                {r.before && <p className="wf-before">{r.before}</p>}
                {r.all && (
                  <p className="st-links">
                    <a href={r.all}>Näytä kaikki tapahtumat</a>
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {waterfall.cardGap && <p className="wf-gate">{CARD_GAP}</p>}
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
