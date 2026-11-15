/**
 * Decision: which categories the month so far is spending clearly more on than the household usually does, so it can
 * ease off a category before the month ends. The figures are the spending change report's usual view (`spendingChange`,
 * the same days of the month against the mean of the usual months before, ADR 0013), so the insight and the report
 * never disagree and the report's noise test decides what stands out. A category is told when its rise stands out and
 * is worth the report's gate; the `RECENT_CATEGORIES` that rose most are told. Spending below the usual is not told: a
 * bill that has not come yet or a bank that has not synced looks the same, and there is nothing to ease off. A card
 * bill is left out: it falls on the issuer's day, not the household's. It has no yearly effect: one month's rise times
 * twelve is a projection, and the month may still end level.
 */
import { daysInMonth, monthOf } from "../../dates.ts";
import { getCategory } from "../../categories.ts";
import { categoryLabel } from "../../category-names.ts";
import { messageIn } from "../../messages.ts";
import { RECENT_CATEGORIES } from "../../thresholds.ts";
import { spendingChange } from "../change.ts";
import { formatEur } from "../format.ts";
import { insightOf } from "./shared.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

export function categoryPace(args: InsightArgs): Insight[] {
  const { ctx, end, running, lang } = args;
  if (!running) return [];
  const month = monthOf(end);
  const change = spendingChange(ctx, "expected", month);
  if (!change?.running) return [];
  const day = Number(change.target.to.slice(8));
  const through = change.target.to;
  return change.categories
    .filter((c) => c.kind === "category" && c.category !== null && c.category !== "card_bill" && c.standsOut && c.changeCents > 0 && c.changeCents >= change.gateCents && c.baseCents > 0)
    .slice(0, RECENT_CATEGORIES)
    .map((c) => {
      const category = c.category!;
      const label = categoryLabel(getCategory(category), lang);
      const percent = Math.round((c.changeCents / c.baseCents) * 100);
      const monthDiff = Math.round((c.changeCents * daysInMonth(month)) / day);
      const months = change.base.months.length;
      return insightOf({
        lang,
        id: `category-pace:${category}`,
        fact: { type: "category-pace", label, nowCents: c.nowCents, usualCents: c.baseCents, percent, day, months },
        comparison: { label: "recentUsual", value: q.cents(c.baseCents) },
        action: { label: "seePace", target: { page: "transactions", filter: { category, from: `${month}-01`, to: through } } },
        yearlyCents: null,
        kind: "pattern",
        link: { category, from: `${month}-01`, to: through },
        calc: [
          { label: messageIn(lang, "calc.month_so_far", { day }), value: formatEur(c.nowCents, false, lang) },
          { label: messageIn(lang, "calc.same_days_before", { n: months }), value: formatEur(c.baseCents, false, lang) },
          { label: messageIn(lang, "calc.pace_change"), value: `+${percent} %` },
          { label: messageIn(lang, "calc.month_diff"), value: `+${formatEur(monthDiff, false, lang)}` },
        ],
      });
    });
}
