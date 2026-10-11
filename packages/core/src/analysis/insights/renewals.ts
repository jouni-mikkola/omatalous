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
import { finnishList, formatEur, formatFiDate } from "../format.ts";
import { answeredSubscriptions, capitalise, countWord, ITEM_GATE_MONTHLY_CENTS, settledBy } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";

const RENEW_DAYS = 45;
const NOUN = { yearly: ["vuositilaus", "vuositilausta"], semiannual: ["puolivuotistilaus", "puolivuotistilausta"] } as const;

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
    .filter((s) => !settledBy(answered.get(s.merchant)))
    .sort((a, b) => a.nextDate!.localeCompare(b.nextDate!) || a.merchant.localeCompare(b.merchant));
}

export function renewals({ ctx, running, inputs }: InsightArgs): Insight[] {
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
      {
        id,
        tone: "info",
        title: `${s.merchant} uusiutuu ${formatFiDate(s.nextDate!)}, ${formatEur(s.typicalAmountCents)}`,
        detail: `${capitalise(NOUN[s.cadence as "yearly" | "semiannual"][0])}, viimeksi veloitettu ${formatFiDate(s.lastDate)}.`,
        yearlyCents: yearly,
        rows,
        link: { merchant: s.merchant },
        merchant: s.merchant,
      },
    ];
  }
  const noun = due.every((s) => s.cadence === "yearly") ? NOUN.yearly[1] : "tilausta";
  return [
    {
      id,
      tone: "info",
      title: `${capitalise(countWord(due.length))} ${noun} uusiutuu ${RENEW_DAYS} päivässä, ${formatEur(total, false)}`,
      detail: `${finnishList(due.map((s) => `${s.merchant} ${formatFiDate(s.nextDate!)}`))}.`,
      yearlyCents: yearly,
      rows,
    },
  ];
}
