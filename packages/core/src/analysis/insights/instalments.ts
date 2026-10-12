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
import { finnishList, formatEur } from "../format.ts";
import { toDayRange } from "../period.ts";
import { capitalise, countWord, isLender } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";

const ADESSIVE = ["", "yhdellä", "kahdella", "kolmella", "neljällä", "viidellä", "kuudella", "seitsemällä", "kahdeksalla", "yhdeksällä"];
const PLAN_MONTHS = 3;
const SAME_AMOUNT_CENTS = 100;
const LAST_PAYMENT_DAYS = 45;
/** H-insights 16: 20 € a month. */
const MIN_MONTHLY = 2000;

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

export function instalments({ ctx, end, gateMonthlyCents }: InsightArgs): Insight[] {
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
  if (!plans.length || monthly < Math.max(MIN_MONTHLY, gateMonthlyCents)) return [];
  const services = [...new Set(plans.map((p) => p.merchant))].sort();
  const yearAgo = addDays(end, -365);
  const cardInterest = new Set(cardCosts(ctx, end).cards.flatMap((c) => c.interestRows));
  const interest = inDays(ctx, toDayRange({ from: yearAgo, to: end })).filter((t) => t.category === "interest" && !cardInterest.has(t.id)).reduce((sum, t) => sum + t.spend, 0);
  const months = Math.min(12, monthIndex(end) - monthIndex(ctx.dataFrom ?? end) + 1);
  const interestMonthly = months > 0 ? Math.round(interest / months) : 0;
  const one = services.length === 1;
  const s = services[0]!;
  return [
    {
      id: "instalments",
      tone: "warning",
      title: one ? `${s}: osamaksuja ${formatEur(monthly, false)} kuussa` : `Osamaksuja ${ADESSIVE[services.length] ?? services.length} palvelulla, ${formatEur(monthly, false)} kuussa`,
      detail:
        `${plans.length === 1 ? "Sama erä" : `${capitalise(countWord(plans.length))} samaa erää`} vähintään kolmena kuukautena peräkkäin` +
        (one ? "" : `: ${finnishList(services)}`) +
        (interestMonthly >= 100 ? `; korkoja ja luottokuluja ${formatEur(interestMonthly, false)} kuussa.` : "."),
      yearlyCents: monthly * 12,
      rows: plans.flatMap((p) => p.rows.map((t) => t.id)),
      ...(one ? { link: { merchant: s }, merchant: s } : {}),
    },
  ];
}
