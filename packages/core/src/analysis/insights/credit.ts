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
import { CARD_COST_MONTHS, cardCosts } from "../credit.ts";
import { finnishList, formatEur, monthName } from "../format.ts";
import { ITEM_GATE_MONTHLY_CENTS, monthSpan } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";

const ESSIVE = ["", "yhtenä", "kahtena", "kolmena", "neljänä", "viitenä", "kuutena", "seitsemänä", "kahdeksana", "yhdeksänä", "kymmenenä"];

export function cardInterest({ ctx, end, current, alerts }: InsightArgs): Insight[] {
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
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const carried = new Set(charged.flatMap((c) => c.carriedMonths)).size;
  const over = months.length === CARD_COST_MONTHS ? "vuodessa" : `${months.length} kuukaudessa`;
  return [
    {
      id: "card-interest",
      tone: "warning",
      title: `${charged.length === 1 ? "Luottokortin" : "Luottokorttien"} korot maksoivat ${formatEur(interest, false)} ${over}`,
      detail: `${finnishList(charged.map((c) => c.name))}: korkoa veloitettiin ${ESSIVE[carried] ?? carried} kuukautena, ${first === last ? `${monthName(first)} ${first.slice(0, 4)}` : monthSpan(first, last)}.`,
      yearlyCents: interest,
      rows,
    },
  ];
}
