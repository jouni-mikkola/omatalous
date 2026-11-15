/**
 * What carrying a balance on a credit card cost: the interest the bank charged on the connected cards in the last 12
 * complete months (`cardCosts` in analysis/credit.ts, the owner of the figure). The gate is 120 €, the gate of one
 * charge, on the interest of the months counted. Nothing is scaled up to a year: with fewer complete months the title
 * names their number. A card paid in full every month is charged no interest and says nothing.
 *
 * The bank fees alert sums the bank charges among its period's rows (`isBankFee` holds a card's interest). When that
 * alert shows and over half of the interest rows here are in its period, the interest is told there and this stays
 * quiet, so no euro is told twice. An alert over other rows says nothing of this interest and silences nothing.
 *
 * No link: the transaction list is filtered by category, payee and dates (`InsightLink`), and each of them shows other
 * interest too, so the list would not add up to the figure. `rows` names the rows.
 */
import { cardCosts } from "../credit.ts";
import { formatEur } from "../format.ts";
import { insightOf, ITEM_GATE_MONTHLY_CENTS, REPORT } from "./shared.ts";
import { messageIn } from "../../messages.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

export function cardInterest({ ctx, end, current, alerts, lang }: InsightArgs): Insight[] {
  const { months, cards } = cardCosts(ctx, end);
  const charged = cards.filter((c) => c.interestCents > 0);
  const interest = charged.reduce((sum, c) => sum + c.interestCents, 0);
  if (interest < 12 * ITEM_GATE_MONTHLY_CENTS) return [];
  const rows = charged.flatMap((c) => c.interestRows);
  if (alerts.some((a) => a.kind === "fees")) {
    // `current` is the period's rows, the ones the alert summed
    const inPeriod = new Set(current.map((t) => t.id));
    if (rows.filter((id) => inPeriod.has(id)).length > rows.length / 2) return [];
  }
  const carried = new Set(charged.flatMap((c) => c.carriedMonths)).size;
  return [
    insightOf({
      lang,
      id: "card-interest",
      fact: { type: "card-interest", cards: charged.map((c) => c.name), cents: interest, months: months.length, carried },
      // a card paid in full every month is charged no interest
      comparison: { label: "paidInFull", value: q.cents(0) },
      action: { label: "seeCardInterest", target: { page: "reports", anchor: REPORT.loans } },
      yearlyCents: -interest,
      kind: "pattern",
      rows,
      calc: [
        ...charged.map((c) => ({ label: messageIn(lang, "calc.card_interest", { name: c.name }), value: formatEur(c.interestCents, false, lang) })),
        { label: messageIn(lang, "calc.interest_total"), value: formatEur(interest, false, lang) },
        { label: messageIn(lang, "calc.months"), value: String(months.length) },
      ],
    }),
  ];
}
