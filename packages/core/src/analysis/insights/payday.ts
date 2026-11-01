/**
 * BA5: the days after pay take more than the days before (`paydayEffect`, D6 of the behaviour model). The gate and the
 * history rule are D6's: six closed, covered pay cycles or more, twice the pace of the week before pay (1,6 with any
 * one cycle left out), no permutation of the days beating it, 50 € a cycle. The detector judges on today, so a closed
 * past period stays quiet. Booking days are not purchase days: the figure is an estimate, told as info and never as a
 * warning, and it says nothing of the household's character.
 */
import { addDays, dayNumber, fromDayNumber } from "../../dates.ts";
import { paydayEffect, payDays } from "../../behaviour/payday.ts";
import { formatEur, formatFiDate } from "../format.ts";
import type { Language } from "../../locale.ts";
import { AFTER_PAY_DAYS, MAX_PAYDAY_ROWS } from "../../thresholds.ts";
import { insightOf, REPORT } from "./shared.ts";
import { messageIn } from "../../messages.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

/** "2,1" */
const times = (ratio: number, lang: Language) => ratio.toFixed(1).replace(".", lang === "en" ? "." : ",");

export function paydaySpending({ ctx, end, lang }: InsightArgs): Insight[] {
  if (end !== ctx.today) return [];
  const p = paydayEffect(ctx);
  if (!p.told || !p.ratio || !p.extraCents || !p.cycles.length) return [];
  // the effect is a cycle's: a year holds as many cycles as pays came in the last 365 days (12 for a monthly pay)
  const yearAgo = dayNumber(addDays(end, -365));
  const perYear = payDays(ctx).filter((d) => d > yearAgo && d <= dayNumber(end)).length;
  const extra = p.extraCents.value;
  const yearly = extra * perYear;
  if (yearly <= 0) return [];
  const n = p.cycles.length;
  const last = p.cycles[n - 1]!;
  const mean = (f: (c: (typeof p.cycles)[number]) => number) => Math.round(p.cycles.reduce((s, c) => s + f(c), 0) / n);
  const beforeCents = mean((c) => c.beforeCents);
  return [
    insightOf({
      lang,
      id: "payday",
      fact: { type: "payday", ratio: p.ratio.value, cycles: n, extraCents: extra },
      comparison: { label: "weekBeforePay", value: q.cents(beforeCents) },
      action: { label: "seePayday", target: { page: "reports", anchor: REPORT.income } },
      yearlyCents: -yearly,
      kind: "pattern",
      rows: p.cycles.flatMap((c) => c.rows).slice(-MAX_PAYDAY_ROWS),
      link: { from: last.pay, to: fromDayNumber(dayNumber(last.pay) + AFTER_PAY_DAYS - 1) },
      calc: [
        { label: messageIn(lang, "calc.pay_periods"), value: String(n) },
        { label: messageIn(lang, "calc.after_pay"), value: formatEur(mean((c) => c.afterCents), false, lang) },
        { label: messageIn(lang, "calc.before_pay"), value: formatEur(beforeCents, false, lang) },
        { label: messageIn(lang, "calc.ratio_weekdays"), value: times(p.ratio.value, lang) },
        { label: messageIn(lang, "calc.more_in_period"), value: formatEur(extra, false, lang) },
        { label: messageIn(lang, "calc.pays_per_year", { date: formatFiDate(fromDayNumber(yearAgo + 1), lang) }), value: String(perYear) },
      ],
    }),
  ];
}
