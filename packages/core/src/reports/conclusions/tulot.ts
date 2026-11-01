// Decision: whether the income covers the spending and the saving, or the accounts are being drawn on
import { inDays } from "../../analysis/context.ts";
import { totalsOf } from "../../analysis/flows.ts";
import { sameAccounts } from "../../analysis/coverage.ts";
import { toDayRange } from "../../analysis/period.ts";
import { messageIn } from "../../messages.ts";
import type { Conclusion, ConclusionInput } from "../conclusion.ts";
import { compareFigure, conclusionOf, earlierNames, earlierSpans, noBudget, noComparisons, noEarlier, spanOf } from "./shared.ts";

/** The period's Tulos (ADR 0014): the money in less what was spent, repaid and saved, with the parts as the rows. */
export function incomeConclusion(input: ConclusionInput): Conclusion {
  const { ctx, range, balances, read, lang } = input;
  const { totals, running } = read("cashflow");
  const span = spanOf(ctx, range);
  const earlier = earlierSpans(span);
  const out = noComparisons(lang);
  for (const kind of ["previous", "yearAgo"] as const) {
    if (!sameAccounts(ctx, earlier[kind], span)) {
      out.gaps[kind] = noEarlier(kind, lang);
      continue;
    }
    const then = totalsOf(inDays(ctx, toDayRange(earlier[kind])).map((t) => t.flows)).leftCents;
    out.compare[kind] = compareFigure(kind, earlierNames(lang)[kind], then, totals.leftCents - then, lang);
  }
  out.gaps.expected = messageIn(lang, "rep.income_no_expected");
  const left = totals.leftCents;
  const rows = [
    { label: messageIn(lang, "rep.income"), cents: totals.incomeCents },
    { label: messageIn(lang, "rep.borrowed"), cents: totals.borrowedCents },
    { label: messageIn(lang, "rep.consumption"), cents: -totals.consumptionCents },
    { label: messageIn(lang, "rep.debt_service"), cents: -totals.debtCents },
    { label: messageIn(lang, "rep.to_savings"), cents: -totals.savedCents },
  ].filter((r) => r.cents !== 0);
  return conclusionOf("tulot", input, {
    question: messageIn(lang, "rep.income_question"),
    figure: { label: messageIn(lang, "rep.result"), cents: left },
    // the sections below tell where Tulos comes from (Tulojen käyttö); a sentence here would say it a second time
    explanation: running ? messageIn(lang, "rep.income_running") : "",
    compare: out.compare,
    gaps: { ...out.gaps, budget: noBudget(lang) },
    basis: {
      method: messageIn(lang, "rep.income_method"),
      rows,
      accounts: balances.map((a) => ({ id: a.id, name: a.name })),
    },
  });
}
