/**
 * H-insights 14: yearly and half-yearly subscriptions that renew in the next 45 days, while there is time to cancel.
 * Only the subscription set (`isSubscription`): insurance and memberships are contracts, and the annual costs report
 * lists other yearly bills. A yearly series needs two charges before it has a next date (recurring.ts).
 */
import { isSubscription } from "../../commitments.ts";
import { addDays } from "../../dates.ts";
import { cancelledMerchants } from "../forecast.ts";
import { finnishList, formatEur, formatFiDate } from "../format.ts";
import { capitalise, countWord, ITEM_GATE_MONTHLY_CENTS } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";

const RENEW_DAYS = 45;
const NOUN = { yearly: ["vuositilaus", "vuositilausta"], semiannual: ["puolivuotistilaus", "puolivuotistilausta"] } as const;

export function renewals({ ctx, running, inputs }: InsightArgs): Insight[] {
  if (!running) return [];
  const cancelled = cancelledMerchants(inputs);
  const until = addDays(ctx.today, RENEW_DAYS);
  const due = ctx.recurring
    .filter((s) => isSubscription(s) && (s.cadence === "yearly" || s.cadence === "semiannual") && s.nextDate && s.nextDate >= ctx.today && s.nextDate <= until)
    .filter((s) => !cancelled.has(s.merchant))
    .sort((a, b) => a.nextDate!.localeCompare(b.nextDate!) || a.merchant.localeCompare(b.merchant));
  const total = due.reduce((sum, s) => sum + s.typicalAmountCents, 0);
  const yearly = due.reduce((sum, s) => sum + s.monthlyCents * 12, 0);
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
