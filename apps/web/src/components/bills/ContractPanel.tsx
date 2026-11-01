import type { Contract } from "@banking/core";
import { date, money } from "../../format.ts";
import { t } from "../../text.ts";

/** What is known of a contract, label at the left and figure at the right; the lines that do not apply are not there. */
export function ContractPanel({ contract: c, endedByUser }: { contract: Contract; endedByUser?: boolean }) {
  const ended = c.ended || endedByUser;
  const line = (label: string, value: string) => (
    <div className="st-row" key={label}>
      <dt className="st-name">{label}</dt>
      <dd className="st-num">{value}</dd>
    </div>
  );
  return (
    <dl className="st-rows">
      {line(t("bills.contract.started"), date(c.startDate))}
      {c.firstPaymentCents !== null && line(t("bills.contract.first"), money(c.firstPaymentCents))}
      {line(t("bills.contract.monthly"), money(c.monthlyCents))}
      {line(t("bills.contract.last"), date(c.lastDate))}
      {ended && line(t("bills.contract.ended"), date(c.endedOn ?? c.lastDate))}
      {c.refund && line(t("bills.contract.refund"), money(c.refund.cents))}
      {line(t("bills.contract.total"), money(c.totalPaidCents))}
      {c.refund && line(t("bills.contract.after_refund"), money(c.costAfterRefundCents))}
    </dl>
  );
}
