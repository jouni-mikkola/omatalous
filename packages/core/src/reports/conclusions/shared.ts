// Decision: none of its own, the parts every question page's conclusion is made of
import type { AnalysisContext } from "../../analysis/context.ts";
import { spendRows } from "../../analysis/context.ts";
import { comparableWith } from "../../analysis/coverage.ts";
import { coverageNotices, type NoticeKind } from "../../analysis/notices.ts";
import { formatEur } from "../../analysis/format.ts";
import type { Insight, InsightFact } from "../../analysis/insights/index.ts";
import { type DateRange, previousRange, toDayRange } from "../../analysis/period.ts";
import { addMonthsToDate } from "../../dates.ts";
import type { Language } from "../../locale.ts";
import { messageIn } from "../../messages.ts";
import { CONCLUSION_ROWS, MIN_COMPARE_MONTHS } from "../../thresholds.ts";
import type { BasisRow, Conclusion, ConclusionFigure, ConclusionInput, FigureComparison } from "../conclusion.ts";
import { COMPARE_KINDS, type CompareKind, type QuestionId } from "./kinds.ts";

export const sumRows = (rows: readonly BasisRow[]): number => rows.reduce((s, r) => s + r.cents, 0);

/** The difference of a figure and what it is set beside, in words. */
function differenceText(kind: CompareKind, name: string, deltaCents: number, lang: Language): string {
  const other = name.toLowerCase();
  if (deltaCents === 0) return kind === "expected" ? messageIn(lang, "rep.same_expected") : messageIn(lang, "rep.same_as", { name: other });
  const amount = formatEur(Math.abs(deltaCents), false, lang);
  const direction = messageIn(lang, deltaCents > 0 ? "rep.more" : "rep.less");
  return kind === "expected" ? messageIn(lang, "rep.diff_expected", { amount, direction }) : messageIn(lang, "rep.diff_other", { amount, direction, name: other });
}

/** The figure beside another of `kind`; `otherCents` is the other figure and `deltaCents` what the figure is more than it. */
export function compareFigure(kind: CompareKind, name: string, otherCents: number, deltaCents: number, lang: Language): FigureComparison {
  return { kind, name, cents: otherCents, deltaCents, text: differenceText(kind, name, deltaCents, lang) };
}

/** Why there is no expected level: it is read from complete months before. */
export const expectedNeeds = (lang: Language): string => messageIn(lang, "rep.expected_needs", { months: MIN_COMPARE_MONTHS });

/** A budget is not kept yet: the switch says so until it is. */
export const noBudget = (lang: Language): string => messageIn(lang, "rep.no_budget");

/** The comparisons of a page that has none yet: every kind is null and the budget says why. */
export const noComparisons = (lang: Language): Pick<Conclusion, "compare" | "gaps"> => ({
  compare: { expected: null, previous: null, yearAgo: null, budget: null },
  gaps: { budget: noBudget(lang) },
});

/** Why a period before or a year ago has no figure on the same accounts. */
export const noEarlier = (kind: "previous" | "yearAgo", lang: Language): string => messageIn(lang, kind === "previous" ? "rep.gap_previous" : "rep.gap_year_ago");

/** The names of the two earlier periods a switch offers: of a free period, or of a calendar month. */
export const earlierNames = (lang: Language, month = false): { previous: string; yearAgo: string } =>
  month ? { previous: messageIn(lang, "rep.prev_month"), yearAgo: messageIn(lang, "rep.year_month") } : { previous: messageIn(lang, "rep.prev_period"), yearAgo: messageIn(lang, "rep.year_period") };

/** The parts of a figure: the `top` largest by size and the rest in one row, so the parts add up to `totalCents` whatever the rest is. */
export function largestParts(parts: readonly BasisRow[], totalCents: number, restLabel: string, top = CONCLUSION_ROWS): BasisRow[] {
  const sorted = parts.filter((p) => p.cents !== 0).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  const shown = sorted.slice(0, top);
  const rest = totalCents - sumRows(shown);
  return rest === 0 ? shown : [...shown, { label: restLabel, cents: rest }];
}

/** The first comparison that has a figure: the verdict's. */
const firstComparison = (compare: Conclusion["compare"]): FigureComparison | null => COMPARE_KINDS.map((k) => compare[k]).find((c): c is FigureComparison => c !== null) ?? null;

/** The last day a period has rows for: a period that reaches into the future ends today. */
export const spanOf = (ctx: Pick<AnalysisContext, "today">, range: DateRange): DateRange => ({ from: range.from, to: range.to < ctx.today ? range.to : ctx.today });

/** The two periods a figure is set beside: the one right before (`previousRange`) and the same days a year earlier. */
export function earlierSpans(span: DateRange, calendarMonth = false): Record<"previous" | "yearAgo", DateRange> {
  // a running month is set beside the same days of the month before, also in January (`previousRange` reads 1.–9.1. as the year so far)
  const [from, to] = calendarMonth ? [addMonthsToDate(span.from, -1), addMonthsToDate(span.to, -1)] : previousRange(span.from, span.to);
  return { previous: { from, to }, yearAgo: { from: addMonthsToDate(span.from, -12), to: addMonthsToDate(span.to, -12) } };
}

/** Spending (consumption and debt service, as the month table counts it) of the rows of `span` on the accounts `only` names, all of them without it. */
function spendingOn(ctx: AnalysisContext, span: DateRange, only?: ReadonlySet<string>): number {
  return spendRows(ctx, toDayRange(span))
    .filter((t) => !only || only.has(t.accountId))
    .reduce((s, t) => s + t.flows.consumption + t.flows.debt, 0);
}

/** What `spendingComparisons` found: the comparisons it could make and why it could not make the others. */
type Found = Pick<Conclusion, "compare" | "gaps">;

/**
 * The spending of `span` set beside the period before and a year ago, on the accounts both periods have the whole of
 * (`comparableWith`) and, with `only`, on those of them it names. `names` are the words the switch and the sentence use.
 */
export function spendingComparisons(ctx: AnalysisContext, span: DateRange, names: { previous: string; yearAgo: string }, lang: Language, only?: ReadonlySet<string>, calendarMonth = false): Found {
  const out = noComparisons(lang);
  const earlier = earlierSpans(span, calendarMonth);
  for (const kind of ["previous", "yearAgo"] as const) {
    const shared = comparableWith(ctx, earlier[kind], span)?.shared;
    const ids = shared && (only ? new Set([...shared].filter((id) => only.has(id))) : shared);
    if (!ids || ids.size === 0) {
      out.gaps[kind] = noEarlier(kind, lang);
      continue;
    }
    const then = spendingOn(ctx, earlier[kind], ids);
    out.compare[kind] = compareFigure(kind, names[kind], then, spendingOn(ctx, span, ids) - then, lang);
  }
  return out;
}

/** The kinds of fact each page recommends from: the insights of its subject (`InsightFact["type"]`). */
const SUBJECT: Record<QuestionId, readonly InsightFact["type"][]> = {
  kuukausi: ["season", "payday", "weekday", "small-purchases"],
  menot: ["spending-growth", "groceries"],
  tulot: ["income"],
  kiinteat: ["price-rise", "price-rises", "stopped", "new-subscription", "subscriptions-added", "renewal", "renewals", "commitments-share"],
  velat: ["debt-share", "credit-drawn", "card-interest", "instalments"],
  saldot: [],
  yhteiset: [],
};

/**
 * The notices each page tells: those about the rows its figure is made of. Card purchases are in the spending and the
 * fixed costs; rows in another currency and days before the history touch every figure made of the period's rows. The
 * balances are the bank's own figure, which already holds its rows in another currency, so they tell neither.
 */
const NOTICES: Record<QuestionId, readonly NoticeKind[]> = {
  kuukausi: ["cards", "currency", "history"],
  menot: ["cards", "currency", "history"],
  tulot: ["currency", "history"],
  kiinteat: ["cards", "currency", "history"],
  velat: ["currency", "history"],
  saldot: [],
  yhteiset: ["currency", "history"],
};

/** The first insight of the period that is about the page's subject: the largest yearly effect first, as the list is ranked. */
function recommendationOf(input: ConclusionInput, page: QuestionId): Insight | null {
  const types = SUBJECT[page];
  return types.length ? (input.insights.find((i) => types.includes(i.fact.type)) ?? null) : null;
}

/** A conclusion with its verdict made from `compare`, the comparison the verdict names being the first that has a figure. */
export function conclusionOf(page: QuestionId, input: ConclusionInput, c: Omit<Conclusion, "verdict" | "recommendation" | "notices"> & { figure: ConclusionFigure }, span: DateRange = input.range, accountIds?: ReadonlySet<string>): Conclusion {
  const { figure, ...rest } = c;
  const notices = coverageNotices(input.ctx, span, input.balances, accountIds, input.lang).filter((n) => NOTICES[page].includes(n.kind));
  return { ...rest, notices, verdict: { figure, comparison: firstComparison(c.compare) }, recommendation: recommendationOf(input, page) };
}

