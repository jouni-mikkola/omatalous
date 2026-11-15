/**
 * Decision: how much to set aside each month for the bills that come once or twice a year, and which month the next one
 * falls in. A bill that comes every second month or less often (insurance, a vehicle tax, a quarterly charge) is the
 * one a household forgets and finds in "Muut", so the insight lists them month by month and names the monthly reserve
 * that carries a year of them. The set and its sums are `analysis/rare-bills.ts`, the same as Laskut lists, so the two
 * never name different bills. Told while the period runs, since the calendar starts from today; a bill worth less than
 * `ITEM_GATE_MONTHLY_CENTS` a month is not worth a line.
 */
import { formatEur, monthNameIn } from "../format.ts";
import { messageIn } from "../../messages.ts";
import { rareOccurrences, rareSeries, rareYear } from "../rare-bills.ts";
import { insightOf, ITEM_GATE_MONTHLY_CENTS } from "./shared.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

export function rareBills({ ctx, running, inputs, lang }: InsightArgs): Insight[] {
  if (!running) return [];
  const { occurrences } = rareOccurrences(ctx, inputs);
  const { months, yearlyCents, reserveMonthlyCents } = rareYear(occurrences, ctx.today);
  const next = occurrences.filter((o) => o.ahead).sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents || a.merchant.localeCompare(b.merchant))[0];
  if (!next || yearlyCents < 12 * ITEM_GATE_MONTHLY_CENTS) return [];
  const bills = new Set(occurrences.filter((o) => o.inYear).map((o) => o.merchant)).size;
  return [
    insightOf({
      lang,
      id: "rare-bills",
      fact: { type: "rare-bills", yearlyCents, reserveMonthlyCents, bills, next: { merchant: next.merchant, date: next.date, cents: next.amountCents } },
      comparison: { label: "reserve", value: q.cents(reserveMonthlyCents) },
      action: { label: "seeBills", target: { page: "bills" } },
      yearlyCents: -yearlyCents,
      kind: "pattern",
      rows: rareSeries(ctx).map((s) => s.transactionIds[s.transactionIds.length - 1]!),
      calc: [
        ...months.filter((m) => m.cents > 0).map((m) => ({ label: `${monthNameIn(m.month, lang)} ${m.month.slice(0, 4)}: ${m.names.join(", ")}`, value: formatEur(m.cents, true, lang) })),
        { label: messageIn(lang, "calc.reserve_month"), value: formatEur(reserveMonthlyCents, true, lang) },
      ],
    }),
  ];
}
