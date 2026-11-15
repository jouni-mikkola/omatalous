/**
 * Decision: how much of the household's own income it saves, when part of what came in was money from people (a friend
 * paying back a dinner, a share of the rent). That money is in the income of the bridge, so it makes the savings rate
 * (`savingsRateOf`) look lower than what the household's own income saves. The insight tells the rate on income without
 * those payments, saved over income less them, from the same complete months and the same rows, and only when the
 * payments are `MIN_PERSON_SHARE` of the income or more: under that the two rates differ by a point or two.
 */
import { monthEnd } from "../../dates.ts";
import { MIN_COMPARE_MONTHS, MIN_PERSON_SHARE, SAVINGS_MONTHS } from "../../thresholds.ts";
import { messageIn } from "../../messages.ts";
import { savingsRateOf } from "../bridge.ts";
import { spendRows } from "../context.ts";
import { totalsOf } from "../flows.ts";
import { formatEur } from "../format.ts";
import { incomeTypeOf, isIncomeRow } from "../income.ts";
import { toDayRange } from "../period.ts";
import { insightOf, lastCompleteMonths, REPORT } from "./shared.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

export function savingsRateWithoutPersons({ ctx, end, lang }: InsightArgs): Insight[] {
  const { rate, months } = savingsRateOf(ctx, lastCompleteMonths(ctx, end, SAVINGS_MONTHS), lang);
  if (rate === null || months.length < MIN_COMPARE_MONTHS) return [];
  const rows = months.flatMap((m) => spendRows(ctx, toDayRange({ from: `${m}-01`, to: monthEnd(m) })));
  const totals = totalsOf(rows.map((t) => t.flows));
  const persons = rows.filter((t) => isIncomeRow(t) && incomeTypeOf(t) === "persons");
  const personCents = persons.reduce((sum, t) => sum + t.flows.income, 0);
  const ownCents = totals.incomeCents - personCents;
  // nothing saved over the months has no rate to tell: the percentage would be zero or below
  if (totals.savedCents <= 0 || personCents <= 0 || ownCents <= 0 || personCents < MIN_PERSON_SHARE * totals.incomeCents) return [];
  const percent = Math.round((totals.savedCents / ownCents) * 100);
  return [
    insightOf({
      lang,
      id: "savings-rate",
      fact: { type: "savings-rate", percent, allPercent: Math.round(rate * 100), personCents, months: months.length },
      comparison: { label: "savingsRateAll", value: q.percent(Math.round(rate * 100)) },
      action: { label: "seeSavingsRate", target: { page: "reports", anchor: REPORT.income } },
      // the money from people in a year, which the rate counts as income
      yearlyCents: Math.round((personCents * SAVINGS_MONTHS) / months.length),
      kind: "pattern",
      rows: persons.map((t) => t.id),
      calc: [
        { label: messageIn(lang, "calc.months"), value: String(months.length) },
        { label: messageIn(lang, "calc.income_all"), value: formatEur(totals.incomeCents, false, lang) },
        { label: messageIn(lang, "calc.income_persons"), value: formatEur(personCents, false, lang) },
        { label: messageIn(lang, "calc.income_own"), value: formatEur(ownCents, false, lang) },
        { label: messageIn(lang, "calc.saved_months"), value: formatEur(totals.savedCents, false, lang) },
        { label: messageIn(lang, "calc.rate_own"), value: `${percent} %` },
      ],
    }),
  ];
}
