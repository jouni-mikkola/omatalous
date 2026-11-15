/**
 * The weekday that takes more than the rest of the week (was the answer line of the report Menot päivittäin). One of
 * seven means is always the highest, so the top weekday is picked after looking: each whole ended week gives that day
 * minus the mean of its other six, and the mean of those differences must stand MIN_T standard errors above zero (not
 * 2) and the day's mean `LEAD_SHARE` times the rest's. Under `LEAD_MIN_WEEKS` whole weeks nothing is judged. The
 * recurring bills and subscriptions are left out of the days (`daySpend`): their day is the payee's.
 */
import { addDays, weekdayOf } from "../../dates.ts";
import { sum } from "../../stats.ts";
import { DAYS_WEEKS, LEAD_MIN_WEEKS, LEAD_SHARE, WEEKS_PER_YEAR } from "../../thresholds.ts";
import { formatEur } from "../format.ts";
import { daySpend } from "../day-spend.ts";
import { MIN_T } from "../signal.ts";
import { insightOf } from "./shared.ts";
import { messageIn } from "../../messages.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

interface WeekdayLead {
  /** 0 = Monday. */
  weekday: number;
  /** Mean spending of that weekday over the weeks judged. */
  cents: number;
  /** Mean spending of the other six days of the same weeks. */
  restCents: number;
  weeks: number;
}

const average = (xs: readonly number[]) => (xs.length ? sum(xs) / xs.length : 0);

/** The weekday that stands out of the weeks of `days` (a run of days in order), or null. Only whole weeks that ended before `today` count. */
function weekdayLead(days: readonly { date: string; cents: number }[], today: string): WeekdayLead | null {
  const weeks: number[][] = [];
  for (let i = days.findIndex((d) => weekdayOf(d.date) === 0); i >= 0 && i + 7 <= days.length; i += 7) {
    const week = days.slice(i, i + 7);
    if (week[6]!.date >= today) break;
    weeks.push(week.map((d) => d.cents));
  }
  if (weeks.length < LEAD_MIN_WEEKS) return null;
  const means = [0, 1, 2, 3, 4, 5, 6].map((w) => average(weeks.map((wk) => wk[w]!)));
  const top = means.indexOf(Math.max(...means));
  const rest = (wk: readonly number[]) => (sum(wk) - wk[top]!) / 6;
  const diffs = weeks.map((wk) => wk[top]! - rest(wk));
  const d = average(diffs);
  const sd = Math.sqrt(sum(diffs.map((v) => (v - d) ** 2)) / (diffs.length - 1));
  const restCents = average(weeks.map(rest));
  const clear = sd > 0 ? d / (sd / Math.sqrt(diffs.length)) >= MIN_T : d > 0;
  if (!clear || means[top]! < LEAD_SHARE * restCents || means[top]! <= 0) return null;
  return { weekday: top, cents: Math.round(means[top]!), restCents: Math.round(restCents), weeks: weeks.length };
}

export function weekdays({ ctx, end, gateMonthlyCents, lang }: InsightArgs): Insight[] {
  const earliest = ctx.dataFrom ?? end;
  const back = addDays(end, -(DAYS_WEEKS * 7 - 1));
  const start = back > earliest ? back : earliest;
  if (start > end) return [];
  const { days, rowsOf } = daySpend(ctx, start, end);
  const lead = weekdayLead(days, ctx.today);
  if (!lead) return [];
  // what that weekday takes beyond the other days, over a year of weeks
  const yearly = Math.round((lead.cents - lead.restCents) * WEEKS_PER_YEAR);
  if (yearly < 12 * gateMonthlyCents) return [];
  const mine = days.filter((d) => weekdayOf(d.date) === lead.weekday && d.date < ctx.today);
  return [
    insightOf({
      lang,
      id: "weekday",
      fact: { type: "weekday", weekday: lead.weekday, cents: lead.cents, weeks: lead.weeks },
      comparison: { label: "otherDays", value: q.cents(lead.restCents) },
      action: { label: "seeWeekday", target: { page: "transactions", filter: { from: start, to: end } } },
      yearlyCents: -yearly,
      kind: "pattern",
      rows: mine.slice(-LEAD_MIN_WEEKS).flatMap((d) => rowsOf(d.date).map((t) => t.id)),
      calc: [
        { label: messageIn(lang, "calc.weeks"), value: String(lead.weeks) },
        { label: messageIn(lang, "calc.day_avg"), value: formatEur(lead.cents, false, lang) },
        { label: messageIn(lang, "calc.other_days_avg"), value: formatEur(lead.restCents, false, lang) },
        { label: messageIn(lang, "calc.diff_day"), value: formatEur(lead.cents - lead.restCents, false, lang) },
        { label: messageIn(lang, "calc.weeks_year"), value: String(WEEKS_PER_YEAR) },
      ],
    }),
  ];
}
