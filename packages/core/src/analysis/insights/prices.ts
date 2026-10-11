/**
 * H-insights 9: fixed-amount charges that got dearer in the 12 months up to the end of the period, with what the rises
 * add to a year. A rise counts from 1 € and 5 % (smaller ones are rounding and currency moves), and the rises together
 * must pass the gate. Bills of varying amount
 * (spot electricity) are left out: their price swings with the season, not with a decision.
 */
import { addDays } from "../../dates.ts";
import { getCategory } from "../../categories.ts";
import { priceChangeYearlyCents, type RecurringSeries } from "../../recurring.ts";
import { recurringAt } from "../context.ts";
import { finnishList, formatEur, formatFiDate } from "../format.ts";
import { capitalise, countWord, isLender, ITEM_GATE_MONTHLY_CENTS } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";

const MIN_RISE_CENTS = 100;
const MIN_RISE_SHARE = 0.05;

const isSpending = (s: RecurringSeries) => {
  const kind = getCategory(s.category).kind;
  // a lender's new sum is a new instalment plan, not a price
  return (kind === "expense" || kind === "debt") && !isLender(s.merchant);
};

export function priceRises({ ctx, end }: InsightArgs): Insight[] {
  const since = addDays(end, -365);
  const rises = recurringAt(ctx, end)
    .filter((s) => s.active && s.kind === "subscription" && isSpending(s) && s.priceChange && s.priceChange.date > since && s.priceChange.date <= end)
    .filter((s) => {
      const { fromCents, toCents } = s.priceChange!;
      return toCents - fromCents >= MIN_RISE_CENTS && toCents - fromCents >= MIN_RISE_SHARE * fromCents;
    })
    .map((s) => ({ s, yearly: priceChangeYearlyCents(s)! }))
    .sort((a, b) => b.yearly - a.yearly || a.s.merchant.localeCompare(b.s.merchant));
  if (!rises.length || rises.reduce((sum, r) => sum + r.yearly, 0) < 12 * ITEM_GATE_MONTHLY_CENTS) return [];
  const rows = rises.flatMap(({ s }) => s.transactionIds.slice(-2));
  if (rises.length === 1) {
    const { s, yearly } = rises[0]!;
    const { fromCents, toCents, date } = s.priceChange!;
    const debt = getCategory(s.category).kind === "debt";
    return [
      {
        id: `price:${s.id}`,
        tone: "warning",
        title: `${s.merchant}: ${debt ? "erä kasvoi" : "hinta nousi"} ${formatEur(yearly, false)} vuodessa`,
        detail: `${formatEur(fromCents)} → ${formatEur(toCents)} ${formatFiDate(date)} alkaen.`,
        yearlyCents: yearly,
        rows,
        link: { merchant: s.merchant },
        merchant: s.merchant,
      },
    ];
  }
  const total = rises.reduce((sum, r) => sum + r.yearly, 0);
  return [
    {
      id: "price-rises",
      tone: "warning",
      title: `${capitalise(countWord(rises.length))} toistuvaa maksua kallistui, yhteensä ${formatEur(total, false)} vuodessa`,
      detail: `${finnishList(rises.map((r) => r.s.merchant))}, 12 kuukauden ajalta ${formatFiDate(addDays(since, 1))} alkaen.`,
      yearlyCents: total,
      rows,
    },
  ];
}
