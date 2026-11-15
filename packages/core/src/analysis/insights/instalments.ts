/**
 * H-insights 16: instalment plans with payment services (Klarna and the like). A plan is the same amount, give or take a
 * euro, paid to one service in three months in a row, the last within 45 days of the end; a single payment or a
 * 30-day invoice of varying amount is never a plan. Interest of the last 12 months goes into the detail, the bank fees
 * alert tells the rest of the credit costs. The rows `cardCosts` counts as a connected card's interest are left out:
 * the card interest insight tells them (insights/credit.ts), and no euro is told twice.
 */
import { addDays, monthIndex } from "../../dates.ts";
import { type AnalysisTx, inDays } from "../context.ts";
import { cardCosts } from "../credit.ts";
import { formatEur } from "../format.ts";
import { messageIn } from "../../messages.ts";
import { toDayRange } from "../period.ts";
import { LAST_PAYMENT_DAYS, MIN_INSTALMENT_MONTHLY_CENTS, PLAN_MONTHS, SAME_AMOUNT_CENTS } from "../../thresholds.ts";
import { insightOf, isLender, shareOfExpectedSpending } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";


interface Plan {
  merchant: string;
  cents: number;
  rows: AnalysisTx[];
}

/** Plans in one service's payments, oldest first: each amount that repeats in PLAN_MONTHS consecutive months. */
function plansOf(merchant: string, txs: readonly AnalysisTx[], end: string): Plan[] {
  const plans: Plan[] = [];
  const used = new Set<string>();
  for (const t of txs) {
    if (used.has(t.id)) continue;
    const same = txs.filter((o) => !used.has(o.id) && Math.abs(o.amountCents - t.amountCents) <= SAME_AMOUNT_CENTS);
    // one payment per month, the months in a row
    const byMonth = new Map<number, AnalysisTx>();
    for (const o of same) if (!byMonth.has(o.month)) byMonth.set(o.month, o);
    const months = [...byMonth.keys()].sort((a, b) => a - b);
    let run: AnalysisTx[] = [];
    for (const m of months) {
      run = run.length && run[run.length - 1]!.month === m - 1 ? [...run, byMonth.get(m)!] : [byMonth.get(m)!];
    }
    if (run.length >= PLAN_MONTHS && run[run.length - 1]!.bookingDate >= addDays(end, -LAST_PAYMENT_DAYS)) {
      for (const o of run) used.add(o.id);
      plans.push({ merchant, cents: -run[run.length - 1]!.amountCents, rows: run });
    }
  }
  return plans;
}

export function instalments({ ctx, end, gateMonthlyCents, lang }: InsightArgs): Insight[] {
  const from = addDays(end, -183);
  const recent = inDays(ctx, toDayRange({ from, to: end }));
  const byLender = new Map<string, AnalysisTx[]>();
  for (const t of recent) {
    if (t.amountCents >= 0 || t.isTransfer || !isLender(t.merchant)) continue;
    const list = byLender.get(t.merchant);
    if (list) list.push(t);
    else byLender.set(t.merchant, [t]);
  }
  const plans = [...byLender].flatMap(([merchant, txs]) => plansOf(merchant, txs, end));
  const monthly = plans.reduce((sum, p) => sum + p.cents, 0);
  if (!plans.length || monthly < Math.max(MIN_INSTALMENT_MONTHLY_CENTS, gateMonthlyCents)) return [];
  const services = [...new Set(plans.map((p) => p.merchant))].sort();
  const yearAgo = addDays(end, -365);
  const cardInterest = new Set(cardCosts(ctx, end).cards.flatMap((c) => c.interestRows));
  const interest = inDays(ctx, toDayRange({ from: yearAgo, to: end })).filter((t) => t.category === "interest" && !cardInterest.has(t.id)).reduce((sum, t) => sum + t.spend, 0);
  const months = Math.min(12, monthIndex(end) - monthIndex(ctx.dataFrom ?? end) + 1);
  const interestMonthly = months > 0 ? Math.round(interest / months) : 0;
  const against = shareOfExpectedSpending(ctx, end, monthly);
  if (!against) return [];
  const one = services.length === 1;
  const s = services[0]!;
  return [
    insightOf({
      lang,
      id: "instalments",
      fact: { type: "instalments", services, plans: plans.length, monthlyCents: monthly, interestMonthlyCents: interestMonthly >= 100 ? interestMonthly : 0 },
      comparison: against,
      action: { label: "seeInstalments", target: { page: "transactions", filter: one ? { merchant: s } : {} } },
      yearlyCents: -monthly * 12,
      kind: "pattern",
      rows: plans.flatMap((p) => p.rows.map((t) => t.id)),
      ...(one ? { link: { merchant: s }, merchant: s } : {}),
      calc: [
        ...plans.map((p) => ({ label: messageIn(lang, "calc.plan_instalment", { merchant: p.merchant }), value: formatEur(p.cents, false, lang) })),
        { label: messageIn(lang, "calc.services"), value: String(services.length) },
        { label: messageIn(lang, "calc.total_month"), value: formatEur(monthly, false, lang) },
        ...(interestMonthly >= 100 ? [{ label: messageIn(lang, "calc.interest_credit_month"), value: formatEur(interestMonthly, false, lang) }] : []),
      ],
    }),
  ];
}
