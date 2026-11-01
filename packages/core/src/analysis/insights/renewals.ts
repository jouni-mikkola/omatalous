/**
 * H-insights 14: yearly and half-yearly subscriptions that renew in the next 45 days, while there is time to cancel.
 * Only the subscription set (`isSubscription`): insurance and memberships are contracts, and the annual costs report
 * lists other yearly bills. A yearly series needs two charges before it has a next date (recurring.ts).
 */
import { isSubscription } from "../../commitments.ts";
import { addDays } from "../../dates.ts";
import type { RecurringSeries } from "../../recurring.ts";
import type { UserInputs } from "../../types.ts";
import type { AnalysisContext } from "../context.ts";
import { formatEur, formatFiDate } from "../format.ts";
import { RENEW_DAYS } from "../../thresholds.ts";
import { answeredSubscriptions, answerOf, insightOf, ITEM_GATE_MONTHLY_CENTS, settledBy } from "./shared.ts";
import { messageIn } from "../../messages.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";


/** A yearly or half-yearly subscription: the insight's set. Optimoi passes its own filter for other contracts. */
export const isLongSubscription = (s: RecurringSeries) => isSubscription(s) && (s.cadence === "yearly" || s.cadence === "semiannual");

/**
 * Series with a next charge from today to `days` ahead, soonest first, merchants the household answered (Lopetettu,
 * or Käytössä within a year) left out. No gate:
 * the insight below adds its own and Optimoi its own.
 */
export function renewalItems(
  ctx: AnalysisContext,
  inputs: UserInputs,
  days: number,
  filter: (s: RecurringSeries) => boolean = isLongSubscription,
): RecurringSeries[] {
  const answered = answeredSubscriptions(inputs, ctx.today);
  const until = addDays(ctx.today, days);
  return ctx.recurring
    .filter((s) => filter(s) && s.nextDate && s.nextDate >= ctx.today && s.nextDate <= until)
    .filter((s) => !settledBy(answerOf(answered, s)))
    .sort((a, b) => a.nextDate!.localeCompare(b.nextDate!) || a.merchant.localeCompare(b.merchant));
}

export function renewals({ ctx, running, inputs, lang }: InsightArgs): Insight[] {
  if (!running) return [];
  const due = renewalItems(ctx, inputs, RENEW_DAYS);
  const total = due.reduce((sum, s) => sum + s.typicalAmountCents, 0);
  const yearly = due.reduce((sum, s) => sum + s.yearlyCents, 0);
  if (!due.length || yearly < 12 * ITEM_GATE_MONTHLY_CENTS) return [];
  const rows = due.map((s) => s.transactionIds[s.transactionIds.length - 1]!);
  const id = `renewals:${due[0]!.nextDate!.slice(0, 7)}`;
  if (due.length === 1) {
    const s = due[0]!;
    return [
      insightOf({
        lang,
        id,
        fact: { type: "renewal", merchant: s.merchant, date: s.nextDate!, cents: s.typicalAmountCents, cadence: s.cadence as "yearly" | "semiannual", lastDate: s.lastDate },
        comparison: { label: "lastCharge", value: q.cents(s.lastAmountCents) },
        action: { label: "decideRenewal", target: { page: "transactions", filter: { merchant: s.merchant } } },
        yearlyCents: -yearly,
        kind: "single",
        rows,
        link: { merchant: s.merchant },
        merchant: s.merchant,
        calc: [
          { label: messageIn(lang, "calc.renews"), value: formatFiDate(s.nextDate!, lang) },
          { label: messageIn(lang, "calc.last_charge"), value: formatEur(s.lastAmountCents, true, lang) },
          { label: messageIn(lang, "calc.last_charged"), value: formatFiDate(s.lastDate, lang) },
        ],
      }),
    ];
  }
  const first = due[0]!;
  return [
    insightOf({
      lang,
      id,
      fact: { type: "renewals", items: due.map((s) => ({ merchant: s.merchant, date: s.nextDate! })), cents: total, days: RENEW_DAYS, yearly: due.every((s) => s.cadence === "yearly") },
      comparison: { label: "lastCharge", value: q.cents(due.reduce((sum, s) => sum + s.lastAmountCents, 0)) },
      action: { label: "decideRenewal", target: { page: "transactions", filter: { merchant: first.merchant } } },
      yearlyCents: -yearly,
      kind: "single",
      rows,
      calc: [
        ...due.map((s) => ({ label: `${s.merchant} ${formatFiDate(s.nextDate!, lang)}`, value: formatEur(s.typicalAmountCents, true, lang) })),
        { label: messageIn(lang, "calc.total"), value: formatEur(total, false, lang) },
        { label: messageIn(lang, "calc.looked_ahead"), value: messageIn(lang, "calc.days", { n: RENEW_DAYS }) },
      ],
    }),
  ];
}
