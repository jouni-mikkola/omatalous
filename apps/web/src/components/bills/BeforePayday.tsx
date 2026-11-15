// Decision: do the payments before the next pay fit what the account holds, and on which days do they fall
import { useState } from "react";
import { dayMonth, money } from "../../format.ts";
import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";
import { Figure } from "../Figure.tsx";
import type { Active } from "../NextDaysLine.tsx";
import { isEstimate, isPayment } from "../next-days.ts";
import { paydayLine } from "../next-days-line.ts";
import { elsewhereLabel, payingAccount } from "./outside.ts";
import { PaymentBars } from "./PaymentBars.tsx";
import "../../styles/bills.css";
import "../../styles/charts.css";

/**
 * The block `nyt.left` answers: the payments before the payday, what the counted accounts hold and what is left of it,
 * all three as the answer's own figures. Under them the same payments as bars on the days to the payday, and the rows
 * `nyt.left.billsCents` is made of, grouped by day (a day's name stands on its first row): the payments of the dashboard
 * answer's `ahead.rows` before the payday (the card bill too), then the payday itself as one income row. Nothing is
 * added up here. Not drawn when the answer has no sum (`nyt.left.known` false).
 */
export function BeforePayday({ data }: { data: DashboardData }) {
  const [active, setActive] = useState<Active>(null);
  const left = data.nyt?.left;
  const ahead = data.ahead;
  if (!left?.known || !ahead?.payday) return null;
  const payday = ahead.payday;
  const rows = ahead.rows.filter(isPayment).filter((r) => r.source !== "income" && r.date < left.payday.date);
  // due before the payday from an account the balance leaves out: listed with that account's name, in no sum here; the answer's own `elsewhereCents` is a second figure under the first
  const outside = ahead.outside.filter((r) => r.cents !== null && r.cents < 0 && r.date < left.payday.date);
  const pay = payday.pay?.floorCents ?? null;
  const line = paydayLine(ahead, rows, left.payday.date);
  return (
    <section className="before-payday" id="ennen-palkkapaivaa" aria-labelledby="before-payday-h">
      <div className="bp-stats">
        <div className="bp-stat">
          <h3 id="before-payday-h" className="bp-label">
            {t("home.payments_before_payday")}
          </h3>
          <Figure text={money(left.billsCents, false)} size="l" />
        </div>
        <div className="bp-stat">
          <span className="bp-label">{t("ahead.balance")}</span>
          <Figure text={money(left.balanceCents, false)} size="l" />
        </div>
        <div className="bp-stat" data-short={left.leftCents < 0 ? "" : undefined}>
          <span className="bp-label">{t("home.tile_left")}</span>
          <Figure text={money(left.leftCents, false)} size="l" />
        </div>
      </div>
      {left.elsewhereCents > 0 && (
        <p className="bp-side bp-elsewhere">
          <span>{elsewhereLabel(outside)}</span>
          <Figure text={money(left.elsewhereCents)} size="m" />
        </p>
      )}
      {line && <PaymentBars line={line} active={active} onActive={setActive} />}
      {line && (
        <p className="legend bp-legend">
          {rows.some((r) => !isEstimate(r)) && (
            <span>
              <i className="pb-key" aria-hidden="true" />
              {t("bills.legend_known")}
            </span>
          )}
          {rows.some(isEstimate) && (
            <span>
              <i className="pb-key" data-estimate="" aria-hidden="true" />
              {t("bills.legend_estimate")}
            </span>
          )}
          <span>
            <i className="pb-key pb-key-pay" aria-hidden="true" />
            {t("bills.legend_payday")}
          </span>
        </p>
      )}
      <ul className="bp-rows">
        {rows.map((r, i) => {
          const first = i === 0 || rows[i - 1]!.date !== r.date;
          return (
            <li key={`${r.date}-${r.name}-${i}`} className="bp-row" data-kind="bill" data-first={first ? "" : undefined} data-active={active?.kind === "bill" && active.row === i ? "" : undefined} onPointerEnter={() => setActive({ kind: "bill", row: i })} onPointerLeave={() => setActive(null)}>
              <span className={first ? "bp-date" : "bp-date sr-only"}>{dayMonth(r.date)}</span>
              <span className="bp-name">
                {r.name}
                {isEstimate(r) && <span className="mb-tag">{t("bills.legend_estimate")}</span>}
              </span>
              <span className="bp-sum num">{money(Math.abs(r.cents ?? 0))}</span>
            </li>
          );
        })}
        {(rows.length > 0 || left.billsCents !== 0) && (
          <li className="bp-row bp-total" data-kind="total">
            <span className="bp-date" />
            <span className="bp-name">{t("rpt.total")}</span>
            <span className="bp-sum num">{money(left.billsCents)}</span>
          </li>
        )}
        {outside.map((r, i) => (
          <li key={`out-${r.date}-${r.name}-${i}`} className="bp-row bp-outside" data-kind="outside" data-first="">
            <span className="bp-date">{dayMonth(r.date)}</span>
            <span className="bp-name">
              {r.name} <small>{payingAccount(r) ?? t("bills.outside_account")}</small>
            </span>
            <span className="bp-sum num">{money(Math.abs(r.cents ?? 0))}</span>
          </li>
        ))}
        <li className="bp-row bp-income" data-kind="income" data-first="">
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
