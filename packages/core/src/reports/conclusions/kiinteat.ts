// Decision: which fixed cost or subscription to cancel or renegotiate, from what is locked in each month
import { comparableWith } from "../../analysis/coverage.ts";
import { formatEur } from "../../analysis/format.ts";
import { fixedSeriesAt, fixedShareOn } from "../../analysis/fixed-share.ts";
import { cancelledSubjects, fixedMonthlyCents } from "../../commitments.ts";
import { messageIn } from "../../messages.ts";
import type { Conclusion, ConclusionInput } from "../conclusion.ts";
import { compareFigure, conclusionOf, earlierNames, earlierSpans, largestParts, noBudget, noComparisons, noEarlier, spanOf } from "./shared.ts";

/** The fixed costs a month on the last day of the period: the subscriptions, bills and loan instalments the series tell, each as a row. */
export function fixedConclusion(input: ConclusionInput): Conclusion {
  const { ctx, range, balances, inputs, lang } = input;
  const span = spanOf(ctx, range);
  const share = fixedShareOn(ctx, span.to, inputs);
  const cancelled = cancelledSubjects(inputs, span.to < ctx.today ? span.to : ctx.today);
  const rows = largestParts(
    fixedSeriesAt(ctx, span.to).map((s) => ({ label: s.merchant, cents: fixedMonthlyCents([s], cancelled) })),
    share.fixedMonthlyCents,
    messageIn(lang, "rep.other"),
  );
  const out = noComparisons(lang);
  const earlier = earlierSpans(span);
  for (const kind of ["previous", "yearAgo"] as const) {
    if (!comparableWith(ctx, earlier[kind], span)) {
      out.gaps[kind] = noEarlier(kind, lang);
      continue;
    }
    const then = fixedShareOn(ctx, earlier[kind].to, inputs).fixedMonthlyCents;
    out.compare[kind] = compareFigure(kind, earlierNames(lang)[kind], then, share.fixedMonthlyCents - then, lang);
  }
  out.gaps.expected = messageIn(lang, "rep.fixed_no_expected");
  return conclusionOf("kiinteat", input, {
    question: messageIn(lang, "rep.fixed_question"),
    figure: { label: messageIn(lang, "rep.fixed_figure"), cents: share.fixedMonthlyCents },
    explanation: messageIn(lang, "rep.fixed_explain", { amount: formatEur(share.fixedMonthlyCents, false, lang) }) + (share.fixedShare === null ? "" : ` ${messageIn(lang, "rep.fixed_share", { percent: Math.round(share.fixedShare * 100) })}`),
    compare: out.compare,
    gaps: { ...out.gaps, budget: noBudget(lang) },
    basis: {
      method: messageIn(lang, "rep.fixed_method"),
      rows,
      accounts: balances.map((a) => ({ id: a.id, name: a.name })),
    },
  });
}
