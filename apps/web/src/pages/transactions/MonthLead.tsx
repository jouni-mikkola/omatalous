/**
 * The lead above the list of Tapahtumat: the biggest day of the running month, the payees that took most and the ones
 * that are new. Decision: is there a day or a payee this month that the household did not expect. Every figure is the
 * `monthLead` report of core, always about the month of today; the page adds up nothing. A payee opens the list
 * limited to it.
 */
import type { ReportsData } from "@banking/core";
import { query } from "../../api.ts";
import { answerMoney, dayHeading } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { t, tn } from "../../text.ts";
import type { Scope } from "../../types.ts";
import { usePhone } from "../TransactionRows.tsx";

type Payees = ReportsData["monthLead"]["top"];

function PayeeList({ title, payees }: { title: string; payees: Payees }) {
  if (payees.length === 0) return null;
  return (
    <div className="tx-lead-part">
      <h2 className="tx-lead-h">{title}</h2>
      <ul className="tx-lead-list">
        {payees.map((p) => (
          <li key={p.merchant}>
            <a href={`#/transactions${query({ merchant: p.merchant })}`}>{p.merchant}</a>{" "}
            <span className="tx-lead-sum">{answerMoney(p.outCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MonthLead({ scope, today }: { scope: Scope; today: string }) {
  const phone = usePhone();
  const { data } = useApi<Pick<ReportsData, "monthLead">>(`/api/reports${query({ scope, reports: "monthLead" })}`);
  const lead = data?.monthLead;
  if (!lead || (!lead.biggestDay && lead.top.length === 0)) return null;
  const day = lead.biggestDay;
  const sentence = day && t("tx.lead_day", { day: dayHeading(day.date, today), sum: answerMoney(day.outCents), events: tn(day.count, "tx.event_one", "tx.event_many") });
  const parts = (
    <div className="tx-lead-parts">
      <PayeeList title={t("tx.lead_top")} payees={lead.top} />
      <PayeeList title={t("tx.lead_new")} payees={lead.fresh} />
    </div>
  );
  // a phone keeps the first row near the top: the payees wait behind the day's sentence until they are asked for
  return (
    <section className="card tx-lead" aria-label={t("tx.lead_label")}>
      {sentence && phone ? (
        <details className="tx-lead-fold">
          <summary className="tx-lead-day">{sentence}</summary>
          {parts}
        </details>
      ) : (
        <>
          {sentence && <p className="tx-lead-day">{sentence}</p>}
          {parts}
        </>
      )}
    </section>
  );
}
