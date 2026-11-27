/**
 * The payees of the running month beside the histogram of Tapahtumat: the ones that took most and the ones that are
 * new. Decision: is there a payee this month that the household did not expect. Every figure is the `monthLead` report
 * of core, always about the month of today; the page adds up nothing. A payee opens the list limited to it and to the
 * days the lead adds up, the first of the month to today. The month's biggest day is the histogram's own peak.
 */
import type { ReportsData } from "@banking/core";
import { query } from "../../api.ts";
import { answerMoney } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { t } from "../../text.ts";
import type { Scope } from "../../types.ts";

type Payees = ReportsData["monthLead"]["top"];

function PayeeList({ title, payees, from, to }: { title: string; payees: Payees; from: string; to: string }) {
  if (payees.length === 0) return null;
  return (
    <div className="tx-lead-part">
      <h2 className="tx-lead-h">{title}</h2>
      <ul className="tx-lead-list">
        {payees.map((p) => (
          <li key={p.merchant}>
            <a href={`#/transactions${query({ merchant: p.merchant, from, to })}`}>{p.merchant}</a>{" "}
            <span className="tx-lead-sum">{answerMoney(p.outCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MonthLead({ scope, today }: { scope: Scope; today: string }) {
  const { data } = useApi<Pick<ReportsData, "monthLead">>(`/api/reports${query({ scope, reports: "monthLead" })}`);
  const lead = data?.monthLead;
  if (!lead || (lead.top.length === 0 && lead.fresh.length === 0)) return null;
  const from = `${lead.month}-01`;
  return (
    <section className="tx-lead" aria-label={t("tx.lead_label")}>
      <PayeeList title={t("tx.lead_top")} payees={lead.top} from={from} to={today} />
      <PayeeList title={t("tx.lead_new")} payees={lead.fresh} from={from} to={today} />
    </section>
  );
}
