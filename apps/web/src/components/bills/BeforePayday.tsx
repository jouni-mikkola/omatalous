// Decision: which payments does the sum of Yhteenveto take off, on which days, and what pay ends the stretch
import { useState } from "react";
import { dayMonth, money } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import { type Active, NextDaysLine } from "../NextDaysLine.tsx";
import { isEstimate, isPayment } from "../next-days.ts";
import { paydayLine } from "../next-days-line.ts";
import "../../styles/ahead.css";
import "../../styles/bills.css";

/**
 * The rows `nyt.left.billsCents` is made of: the payments of the dashboard answer's `ahead.rows` before the payday
 * (the card bill too), then the payday itself as one income row. Over them the same payments as dots on the days to the
 * payday, as 1.0.0 drew them. It stands in the card of Tulevat maksut, under its heading. Nothing is added up here: the total is the answer's own figure. Not drawn when the answer
 * has no sum (`nyt.left.known` false).
 */
export function BeforePayday({ data }: { data: DashboardData }) {
  const [active, setActive] = useState<Active>(null);
  const left = data.nyt?.left;
  const ahead = data.ahead;
  if (!left?.known || !ahead?.payday) return null;
  const payday = ahead.payday;
  const rows = ahead.rows.filter(isPayment).filter((r) => r.source !== "income" && r.date < left.payday.date);
  const pay = payday.pay?.floorCents ?? null;
  const line = paydayLine(ahead, rows, left.payday.date);
  return (
    <section className="before-payday" id="ennen-palkkapaivaa" aria-labelledby="before-payday-h">
      <div className="bills-time-sum">
        <h3 id="before-payday-h">{t("home.payments_before_payday")}</h3>
        <Figure text={money(left.billsCents, false)} size="l" />
      </div>
      {line && <NextDaysLine line={line} active={active} onActive={setActive} labelledBy="before-payday-h" />}
      {line && (
        <p className="legend bills-time-legend">
          {rows.some((r) => !isEstimate(r)) && (
            <span>
              <i className="swatch nd-key nd-t3" aria-hidden="true" />
              {t("bills.legend_known")}
            </span>
          )}
          {rows.some(isEstimate) && (
            <span>
              <i className="swatch nd-key nd-t3 nd-est" aria-hidden="true" />
              {t("bills.legend_estimate")}
            </span>
          )}
          <span>
            <i className="swatch nd-key nd-key-pay" aria-hidden="true" />
            {t("bills.legend_payday")}
          </span>
        </p>
      )}
      <ul className="bp-rows">
        {rows.map((r, i) => (
          <li key={`${r.date}-${r.name}-${i}`} className="bp-row" data-kind="bill" data-active={active?.kind === "bill" && active.row === i ? "" : undefined} onPointerEnter={() => setActive({ kind: "bill", row: i })} onPointerLeave={() => setActive(null)}>
            <span className="bp-date">{dayMonth(r.date)}</span>
            <span className="bp-name">{r.name}</span>
            <span className="bp-sum num">{money(Math.abs(r.cents ?? 0))}</span>
          </li>
        ))}
        <li className="bp-row bp-total" data-kind="total">
          <span className="bp-date" />
          <span className="bp-name">{t("rpt.total")}</span>
          <span className="bp-sum num">{money(left.billsCents)}</span>
        </li>
        <li className="bp-row bp-income" data-kind="income">
          {/* the day the line ends on: the next pay, also when the last one is behind its day */}
          <span className="bp-date">{dayMonth(left.payday.date)}</span>
          <span className="bp-name">
            {t("rpt.bl_payday")}: {left.payday.name}
          </span>
          <span className="bp-sum num">{pay !== null ? money(pay) : ""}</span>
        </li>
      </ul>
    </section>
  );
}
