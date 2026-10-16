import type { Contract } from "@banking/core";
import { date, money } from "../../format.ts";

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
      {line("Alkoi", date(c.startDate))}
      {c.firstPaymentCents !== null && line("Ensimmäinen maksu", money(c.firstPaymentCents))}
      {line("Kuukausikulu", money(c.monthlyCents))}
      {line("Viimeinen maksu", date(c.lastDate))}
      {ended && line("Päättyi", date(c.endedOn ?? c.lastDate))}
      {c.refund && line("Hyvitys sopimuksen päättyessä", money(c.refund.cents))}
      {line("Yhteensä maksettu", money(c.totalPaidCents))}
      {c.refund && line("Kulu yhteensä hyvityksen jälkeen", money(c.costAfterRefundCents))}
    </dl>
  );
}
