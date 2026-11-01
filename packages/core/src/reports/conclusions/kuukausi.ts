// Decision: whether this month is running over what a month usually costs, and what to change before it ends
import { spendRows } from "../../analysis/context.ts";
import { expectedSpending } from "../../analysis/expected.ts";
import { formatEur, joinRange, roundForecast } from "../../analysis/format.ts";
import { toDayRange } from "../../analysis/period.ts";
import { getCategory } from "../../categories.ts";
import { categoryLabel } from "../../category-names.ts";
import { monthOf } from "../../dates.ts";
import { USUAL_MONTHS } from "../../thresholds.ts";
import type { BasisRow, Conclusion, ConclusionInput } from "../conclusion.ts";
import { messageIn } from "../../messages.ts";
import { compareFigure, conclusionOf, earlierNames, expectedNeeds, largestParts, noBudget, spendingComparisons } from "./shared.ts";

/** What this month has cost by the day the answer is read on, against the month's expected level (`expectedSpending`) and the months before. */
export function monthConclusion(input: ConclusionInput): Conclusion {
  const { ctx, balances, read, lang } = input;
  const { estimate } = read("thisMonth");
  // the running month whatever period the page is set to: the periods of Raportit end with the last whole month
  const end = ctx.today;
  const month = monthOf(end);
  const span = { from: `${month}-01`, to: end };
  const day = Number(end.slice(8, 10));
  const byCategory = new Map<string, number>();
  for (const t of spendRows(ctx, toDayRange(span))) {
    const cents = t.flows.consumption + t.flows.debt;
    if (cents) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + cents);
  }
  const spent = [...byCategory.values()].reduce((s, c) => s + c, 0);
  const parts: BasisRow[] = [...byCategory].map(([category, cents]) => ({ label: categoryLabel(getCategory(category), lang), cents }));
  const rows = largestParts(parts, spent, messageIn(lang, "rep.other"));
  const expected = expectedSpending(ctx, month, day);
  const compared = spendingComparisons(ctx, span, earlierNames(lang, true), lang, undefined, true);
  const compare = { ...compared.compare, expected: expected === null ? null : compareFigure("expected", messageIn(lang, "rep.expected"), expected, spent - expected, lang), budget: null };
  const gaps = { ...compared.gaps, budget: noBudget(lang), ...(expected === null ? { expected: expectedNeeds(lang) } : {}) };
  const top = rows[0];
  return conclusionOf("kuukausi", input, {
    question: messageIn(lang, "rep.month_question"),
    figure: { label: messageIn(lang, "rep.spending"), cents: spent },
    explanation: messageIn(lang, "rep.month_spent", { spent: formatEur(spent, false, lang), day }) + (top ? " " + messageIn(lang, "rep.month_top", { name: top.label, amount: formatEur(top.cents, false, lang) }) : "") + (estimate ? " " + messageIn(lang, "rep.month_estimate", { range: joinRange(formatEur(roundForecast(estimate.lowCents), false, lang), formatEur(roundForecast(estimate.highCents), false, lang)) }) : ""),
    compare,
    gaps,
    basis: {
      method: messageIn(lang, "rep.month_method", { months: USUAL_MONTHS }),
      rows,
      accounts: balances.map((a) => ({ id: a.id, name: a.name })),
    },
  }, span);
}
