/**
 * Decision: which categories the month so far is spending clearly more or less on than the household usually does, so
 * it can ease off a category before the month ends or move the money it did not need. Each category's first days of the
 * running month (the same days of the month, so a rent paid on the 1st stands on both sides) are set against the mean of
 * the same days of the `RECENT_MONTHS` complete months before. A category is told when it differs `RECENT_SHIFT_SHARE`
 * of that mean or more, lies on the same side of each of those months, and the difference is worth `gateMonthlyCents`;
 * the `RECENT_CATEGORIES` that differ most are told. Not before day `RECENT_MIN_DAY`, when a few rows move a category
 * past any share. A card bill is left out: it falls on the issuer's day, not the household's. The yearly effect is the
 * difference scaled to the whole month, a year of months like it.
 */
import { dateIn, daysInMonth, monthOf } from "../../dates.ts";
import { getCategory } from "../../categories.ts";
import { categoryLabel } from "../../category-names.ts";
import { messageIn } from "../../messages.ts";
import { RECENT_CATEGORIES, RECENT_MIN_DAY, RECENT_MONTHS, RECENT_SHIFT_SHARE } from "../../thresholds.ts";
import { spendRows } from "../context.ts";
import { formatEur } from "../format.ts";
import { toDayRange } from "../period.ts";
import { sum } from "../../stats.ts";
import { insightOf, lastCompleteMonths } from "./shared.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

/** What each category spent in the first `day` days of `month`, the card bills and categories with no spending left out. */
function spentBy(args: InsightArgs, month: string, day: number): Map<string, number> {
  const sums = new Map<string, number>();
  for (const t of spendRows(args.ctx, toDayRange({ from: `${month}-01`, to: dateIn(month, day) }))) {
    if (t.spend !== 0 && t.category !== "card_bill") sums.set(t.category, (sums.get(t.category) ?? 0) + t.spend);
  }
  return sums;
}

export function categoryPace(args: InsightArgs): Insight[] {
  const { ctx, end, running, gateMonthlyCents, lang } = args;
  const day = Number(end.slice(8));
  if (!running || day < RECENT_MIN_DAY) return [];
  const months = lastCompleteMonths(ctx, end, RECENT_MONTHS);
  if (months.length < RECENT_MONTHS) return [];
  const month = monthOf(end);
  const now = spentBy(args, month, day);
  const then = months.map((m) => spentBy(args, m, day));
  const found = [...new Set([...now.keys(), ...then.flatMap((m) => [...m.keys()])])].flatMap((category) => {
    const spent = now.get(category) ?? 0;
    const each = then.map((m) => m.get(category) ?? 0);
    const usual = Math.round(sum(each) / each.length);
    const diff = spent - usual;
    const sameSide = diff > 0 ? each.every((c) => spent > c) : each.every((c) => spent < c);
    if (usual <= 0 || Math.abs(diff) < RECENT_SHIFT_SHARE * usual || Math.abs(diff) < gateMonthlyCents || !sameSide) return [];
    return [{ category, spent, usual, diff }];
  });
  return found
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.category.localeCompare(b.category))
    .slice(0, RECENT_CATEGORIES)
    .map(({ category, spent, usual, diff }) => {
      const label = categoryLabel(getCategory(category), lang);
      const percent = Math.round((diff / usual) * 100);
      const monthDiff = Math.round((diff * daysInMonth(month)) / day);
      return insightOf({
        lang,
        id: `category-pace:${category}`,
        fact: { type: "category-pace", label, nowCents: spent, usualCents: usual, percent, day, months: months.length },
        comparison: { label: "recentUsual", value: q.cents(usual) },
        action: { label: "seePace", target: { page: "transactions", filter: { category, from: `${month}-01`, to: end } } },
        yearlyCents: -monthDiff * 12,
        kind: "pattern",
        link: { category, from: `${month}-01`, to: end },
        calc: [
          { label: messageIn(lang, "calc.month_so_far", { day }), value: formatEur(spent, false, lang) },
          { label: messageIn(lang, "calc.same_days_before", { n: months.length }), value: formatEur(usual, false, lang) },
          { label: messageIn(lang, "calc.pace_change"), value: `${percent > 0 ? "+" : "−"}${Math.abs(percent)} %` },
          { label: messageIn(lang, "calc.month_diff"), value: `${monthDiff > 0 ? "+" : "−"}${formatEur(Math.abs(monthDiff), false, lang)}` },
        ],
      });
    });
}
