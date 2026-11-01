// Decision: which category of spending to cut or watch, from where the money went in the period
import { formatEur } from "../../analysis/format.ts";
import { expectedSpending } from "../../analysis/expected.ts";
import { monthOf } from "../../dates.ts";
import type { Language } from "../../locale.ts";
import { messageIn } from "../../messages.ts";
import type { Conclusion, ConclusionInput } from "../conclusion.ts";
import { compareFigure, conclusionOf, earlierNames, expectedNeeds, largestParts, noBudget, spanOf, spendingComparisons } from "./shared.ts";

/** The goal categories' spending against their goals in words. */
const goalsText = (deltaCents: number, complete: boolean, lang: Language): string => {
  const amount = formatEur(Math.abs(deltaCents), false, lang);
  if (deltaCents > 0) return messageIn(lang, "rep.goals_over", { amount });
  if (deltaCents === 0) return messageIn(lang, "rep.goals_exact");
  // a running month has spent only part of its goal: the gap is what is left, not a saving
  return complete ? messageIn(lang, "rep.goals_under", { amount }) : messageIn(lang, "rep.goals_left", { amount });
};

/** Where the period's money went: the spending of the categories report, its categories as the parts, set beside the period before and a year ago. */
export function spendingConclusion(input: ConclusionInput): Conclusion {
  const { ctx, range, balances, read, lang } = input;
  const report = read("categories");
  const table = read("spendingTable");
  const span = spanOf(ctx, range);
  const total = report.totalCents;
  const rows = largestParts(table.rows.map((r) => ({ label: r.label, cents: r.totalCents })), total, messageIn(lang, "rep.other"));
  const compared = spendingComparisons(ctx, span, earlierNames(lang), lang);
  // the expected level is one month's: a period inside one month is set beside it, a longer one has none
  const month = monthOf(span.from);
  const oneMonth = monthOf(span.to) === month;
  const expected = oneMonth ? expectedSpending(ctx, month, Number(span.to.slice(8, 10))) : null;
  // the goals are for categories: `cents` and `deltaCents` are over the goal categories alone, not the figure of the page, and the text says so
  const goals = read("categoryGoals");
  const budget = goals.total && { ...compareFigure("budget", messageIn(lang, "rep.goals"), goals.total.goalCents, goals.total.deltaCents, lang), text: goalsText(goals.total.deltaCents, goals.complete, lang) };
  const compare = { ...compared.compare, expected: expected === null ? null : compareFigure("expected", messageIn(lang, "rep.expected"), expected, total - expected, lang), budget };
  const gaps = {
    ...compared.gaps,
    ...(budget ? {} : { budget: goals.month === null ? messageIn(lang, "rep.goals_month") : noBudget(lang) }),
    ...(expected === null ? { expected: oneMonth ? expectedNeeds(lang) : messageIn(lang, "rep.expected_one_month") } : {}),
  };
  const top = rows[0];
  return conclusionOf("menot", input, {
    question: messageIn(lang, "rep.spending_question"),
    figure: { label: messageIn(lang, "rep.spending"), cents: total },
    explanation: top ? messageIn(lang, "rep.spending_explain", { total: formatEur(total, false, lang), fixed: formatEur(table.fixedCents, false, lang), name: top.label, amount: formatEur(top.cents, false, lang) }) : messageIn(lang, "rep.spending_none"),
    compare,
    gaps,
    basis: {
      method: messageIn(lang, "rep.spending_method"),
      rows,
      accounts: balances.map((a) => ({ id: a.id, name: a.name })),
    },
  });
}
