/**
 * Decision: how much of the household's own income it saves, when part of what came in was money from people (a friend
 * paying back a dinner, a share of the rent). That money is in the income of the bridge, so it makes the savings rate
 * (`savingsRateOf`, `rate`) look lower than what the household's own income saves (`ownRate`, the same function from
 * the same totals). The insight tells `ownRate` beside `rate`, and only when the two, as shown, differ by
 * `MIN_RATE_GAP_POINTS` or more. It has no yearly effect: the money from people is not money the household gains or
 * loses by acting.
 */
import { MIN_COMPARE_MONTHS, MIN_RATE_GAP_POINTS, SAVINGS_MONTHS } from "../../thresholds.ts";
import { messageIn } from "../../messages.ts";
import { savingsRateOf } from "../bridge.ts";
import { formatEur } from "../format.ts";
import { insightOf, lastCompleteMonths, REPORT } from "./shared.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

export function savingsRateWithoutPersons({ ctx, end, lang }: InsightArgs): Insight[] {
  const { rate, ownRate, totals, persons, months } = savingsRateOf(ctx, lastCompleteMonths(ctx, end, SAVINGS_MONTHS), lang);
  if (rate === null || ownRate === null || months.length < MIN_COMPARE_MONTHS) return [];
  // nothing saved over the months has no rate to tell: the percentage would be zero or below
  if (totals.savedCents <= 0 || persons.cents <= 0) return [];
  const percent = Math.round(ownRate * 100);
  const allPercent = Math.round(rate * 100);
  if (percent - allPercent < MIN_RATE_GAP_POINTS) return [];
  return [
    insightOf({
      lang,
      id: "savings-rate",
      fact: { type: "savings-rate", percent, allPercent, personCents: persons.cents, months: months.length },
      comparison: { label: "savingsRateAll", value: q.percent(allPercent) },
      action: { label: "seeSavingsRate", target: { page: "reports", anchor: REPORT.income } },
      yearlyCents: null,
      kind: "pattern",
      rows: persons.rowIds,
      calc: [
        { label: messageIn(lang, "calc.months"), value: String(months.length) },
        { label: messageIn(lang, "calc.income_all"), value: formatEur(totals.incomeCents, false, lang) },
        { label: messageIn(lang, "calc.income_persons"), value: formatEur(persons.cents, false, lang) },
        { label: messageIn(lang, "calc.income_own"), value: formatEur(totals.incomeCents - persons.cents, false, lang) },
        { label: messageIn(lang, "calc.saved_months"), value: formatEur(totals.savedCents, false, lang) },
        { label: messageIn(lang, "calc.rate_own"), value: `${percent} %` },
      ],
    }),
  ];
}
