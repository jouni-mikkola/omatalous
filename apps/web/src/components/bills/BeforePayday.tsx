// Decision: which payments does the sum of Nyt take off, and what pay ends the stretch
import { dayMonth, money } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import "../../styles/bills.css";

/**
 * The rows `nyt.left.billsCents` is made of: the payments of the dashboard answer's `ahead.rows` before the payday
 * (the card bill too), then the payday itself as one income row. Nothing is added up here but the shown total, which is
 * the answer's own figure. Not drawn when the answer has no sum (`nyt.left.known` false).
 */
export function BeforePayday({ data }: { data: DashboardData }) {
  const left = data.nyt?.left;
  const ahead = data.ahead;
  if (!left?.known || !ahead?.payday) return null;
  const payday = ahead.payday;
  const rows = ahead.rows.filter((r) => r.source !== "income" && (r.cents ?? 0) < 0 && r.date < left.payday.date);
  const pay = payday.pay?.floorCents ?? null;
  return (
    <section className="card span-12 before-payday" id="ennen-palkkapaivaa" aria-labelledby="before-payday-h">
      <h2 id="before-payday-h">{t("home.payments_before_payday")}</h2>
      <ul className="bp-rows">
        {rows.map((r, i) => (
          <li key={`${r.date}-${r.name}-${i}`} className="bp-row" data-kind="bill">
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
          <span className="bp-date">{dayMonth(payday.date)}</span>
          <span className="bp-name">
            {t("rpt.bl_payday")}: {payday.name}
          </span>
          <span className="bp-sum num">{pay !== null ? money(pay) : ""}</span>
        </li>
      </ul>
    </section>
  );
}
