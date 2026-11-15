/**
 * H-insights 10: calendar months that cost clearly more than usual in each of the last two years, and the monthly sum
 * that covers them. A month is compared with its usual level (the median of the six complete months before it) with
 * its one-offs taken out by the level rule (one-offs.ts). One year alone cannot tell a season from chance, so a month
 * counts only when both of the last two years were 20 % or more above usual and stood out from the household's
 * month-to-month noise, each year by MIN_T / √2 standard errors, so the two together stand MIN_T apart and neither
 * carries it alone (ADR 0011).
 */
import { addMonths, monthEnd } from "../../dates.ts";
import { monthSpan, sameAccounts } from "../coverage.ts";
import { formatEur, monthNameIn } from "../format.ts";
import { messageIn } from "../../messages.ts";
import { expectedSpending } from "../expected.ts";
import { completeMonthsBefore, isCompleteMonth } from "../usual.ts";
import { MIN_COMPARE_MONTHS, MIN_SEASON_SHARE, NOISE_MONTHS, SEASON_YEARS } from "../../thresholds.ts";
import { capitalise, insightOf, lastCompleteMonths, monthRows, oneOffCents } from "./shared.ts";
import { MIN_T, monthlyNoise, monthT } from "../signal.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

const YEARS = SEASON_YEARS;
/** Each year's share of the test: two independent years at MIN_T / √2 each stand MIN_T apart together. */
const YEAR_T = MIN_T / Math.sqrt(YEARS);

/** A month's spending with its one-offs struck by the level rule (`oneOffs`, LEVEL). */
function struckSpend(ctx: InsightArgs["ctx"], month: string): number {
  const spend = monthRows(ctx, month).spend;
  return spend - oneOffCents(ctx, month);
}

/** The month-to-month noise of the complete months before `month`, on the series the excess is measured on. */
function noise(ctx: InsightArgs["ctx"], month: string): number {
  return monthlyNoise(completeMonthsBefore(ctx, month, NOISE_MONTHS).map((m) => struckSpend(ctx, m)));
}

interface Season {
  /** The month of the last year, `2025-12`; the year before is the same month 12 earlier. */
  month: string;
  /** The mean excess over the years, cents. */
  extra: number;
  /** Each year's excess over its usual level, one-off out, the latest first. */
  extras: number[];
  /** Each year's usual level of the month, the latest first. */
  usuals: number[];
}

/**
 * The months of the last 12 complete ones that can be judged: the same month a year earlier is complete and held the
 * same accounts' rows (`accountsCoverage`), and so did the months of the usual level of both years. Empty while the
 * history is too short; the Optimoi check and the insight both read it, so they give one answer.
 */
function seasonMonths(ctx: InsightArgs["ctx"], end: string): string[] {
  const recent = lastCompleteMonths(ctx, end, 12);
  if (recent.length < 12) return [];
  const same = (earlier: string, month: string) => sameAccounts(ctx, monthSpan(earlier), monthSpan(month));
  /** The usual level of `month` is read from at least three months that held the same accounts as it. */
  const usualHeld = (month: string) => {
    const window = completeMonthsBefore(ctx, month);
    return window.length >= MIN_COMPARE_MONTHS && window.every((w) => same(w, month));
  };
  return recent.filter((m) => isCompleteMonth(ctx, addMonths(m, -12)) && same(addMonths(m, -12), m) && usualHeld(m) && usualHeld(addMonths(m, -12)));
}

/**
 * Calendar months of the last 12 complete months that were 20 % over usual, clear of the noise, in each of the last
 * two years. The insight sums them; Optimoi takes each month for itself.
 */
function expensiveMonthItems({ ctx, end, gateMonthlyCents }: Pick<InsightArgs, "ctx" | "end" | "gateMonthlyCents">): Season[] {
  const seasons: Season[] = [];
  for (const month of seasonMonths(ctx, end)) {
    const years = Array.from({ length: YEARS }, (_, k) => addMonths(month, -12 * k));
    const extras: number[] = [];
    const usuals: number[] = [];
    for (const m of years) {
      const usual = isCompleteMonth(ctx, m) ? expectedSpending(ctx, m) : null;
      if (usual === null || usual <= 0) break;
      const excess = struckSpend(ctx, m) - usual;
      if (excess < Math.max(MIN_SEASON_SHARE * usual, 5 * gateMonthlyCents) || monthT(excess, noise(ctx, m), completeMonthsBefore(ctx, m).length) < YEAR_T) break;
      extras.push(excess);
      usuals.push(usual);
    }
    if (extras.length === YEARS) seasons.push({ month, extra: Math.round(extras.reduce((s, v) => s + v, 0) / YEARS), extras, usuals });
  }
  return seasons;
}

export function expensiveMonths(args: InsightArgs): Insight[] {
  const { gateMonthlyCents, lang } = args;
  const seasons = expensiveMonthItems(args);
  const yearly = seasons.reduce((s, x) => s + x.extra, 0);
  if (!seasons.length || yearly < 12 * gateMonthlyCents) return [];
  const top = [...seasons].sort((a, b) => b.extra - a.extra)[0]!;
  return [
    insightOf({
      lang,
      id: `seasons:${seasons.map((s) => s.month.slice(5)).join("-")}`,
      fact: { type: "season", month: top.month, months: seasons.map((s) => s.month), extraCents: top.extra, years: YEARS },
      comparison: { label: "expectedMonth", value: q.cents(top.usuals[0]!) },
      action: { label: "setAside", target: { page: "transactions", filter: { from: `${top.month}-01`, to: monthEnd(top.month) } } },
      yearlyCents: -yearly,
      kind: "pattern",
      link: { from: `${top.month}-01`, to: monthEnd(top.month) },
      calc: [
        ...top.extras.flatMap((e, k) => {
          const m = addMonths(top.month, -12 * k);
          const name = `${capitalise(monthNameIn(m, lang))} ${m.slice(0, 4)}`;
          return [
            { label: messageIn(lang, "calc.season_expected", { name }), value: formatEur(top.usuals[k]!, false, lang) },
            { label: messageIn(lang, "calc.season_over", { name }), value: formatEur(e, false, lang) },
          ];
        }),
        { label: messageIn(lang, "calc.season_avg_over", { name: capitalise(monthNameIn(top.month, lang)) }), value: formatEur(top.extra, false, lang) },
        ...seasons.filter((s) => s !== top).map((s) => ({ label: messageIn(lang, "calc.season_avg_over", { name: capitalise(monthNameIn(s.month, lang)) }), value: formatEur(s.extra, false, lang) })),
        { label: messageIn(lang, "calc.extra_month"), value: formatEur(Math.round(yearly / 12), false, lang) },
      ],
    }),
  ];
}
