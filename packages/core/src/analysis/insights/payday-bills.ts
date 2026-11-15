/**
 * Decision: whether the pay of the coming payday carries the bills that fall due on the payday itself. A forecast that
 * stops the day before the payday shows the money as enough while a rent or a loan instalment dated on the payday takes a
 * share of the pay the same day. The sum is `paydayCents` of the first page's window (`aheadBasis`), so the insight and
 * Yhteenveto name the same bills, set against the usual pay of the series and the payments before the payday. Told only
 * while a pay is waited for, with an estimate of it, and when the bills are worth a line (`gateMonthlyCents`). It has
 * no yearly effect: the bills are paid anyway, so acting on the finding gains or loses no money.
 */
import { messageIn } from "../../messages.ts";
import { formatEur } from "../format.ts";
import { insightOf } from "./shared.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

export function paydayBills({ running, ahead, gateMonthlyCents, lang }: InsightArgs): Insight[] {
  if (!running || !ahead || ahead.reason !== "payday" || !ahead.payday?.pay || ahead.paydayCents <= 0 || ahead.paydayCents < gateMonthlyCents) return [];
  const { pay } = ahead.payday;
  const date = ahead.payday.next ?? ahead.payday.date;
  const exact = (cents: number) => formatEur(cents, cents % 100 !== 0, lang);
  return [
    insightOf({
      lang,
      id: "payday-bills",
      fact: { type: "payday-bills", date, billsCents: ahead.paydayCents, beforeCents: ahead.totals.dueCents, payCents: pay.usualCents },
      comparison: { label: "payEstimate", value: q.cents(pay.usualCents) },
      action: { label: "seeBills", target: { page: "bills" } },
      yearlyCents: null,
      kind: "pattern",
      link: { from: date, to: date },
      calc: [
        { label: messageIn(lang, "calc.pay_usual"), value: exact(pay.usualCents) },
        { label: messageIn(lang, "calc.due_before_pay"), value: exact(ahead.totals.dueCents) },
        { label: messageIn(lang, "calc.due_on_pay"), value: exact(ahead.paydayCents) },
      ],
    }),
  ];
}
