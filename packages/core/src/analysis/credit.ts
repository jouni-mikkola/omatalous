/**
 * Decision: the household sees what carrying a balance on a credit card costs, so it can decide to pay the card down.
 *
 * What a connected credit card costs: the one owner of the figure (ADR 0004). The card interest insight and the card
 * interest finding of Säästövinkit both read it. A connected card is an account of type `credit_card`. A card the user
 * typed in is a `Loan` (loans.ts) and is not read here, and how full a card is belongs to `creditUse` there.
 *
 * - Cost: the bank's own charges on the card account in the complete months before a day, twelve at most. Which rows
 *   are charges is `isBankFee`'s to say (fees.ts), so a late fee and late interest stay the late fee alert's. A charge
 *   the bank words as interest (`isPurchaseInterestText`) is interest and every other one a fee: no row is both.
 * - A month carried a balance when the bank charged interest in it. Interest falls on what was left unpaid of the
 *   statement before. The statement's dates and its sum are not in the rows, so payments are not set against
 *   purchases to work it out.
 * - Nothing is scaled up. A card connected later than the other accounts has fewer rows in the months, so its cost is
 *   what the rows show and may be more.
 */
import { monthEnd, monthOf } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import { isPurchaseInterestText } from "../wording.ts";
import { type AnalysisContext, type AnalysisTx, inDays, netSpend } from "./context.ts";
import { isBankFee } from "./fees.ts";
import { toDayRange } from "./period.ts";
import { completeMonthsBefore } from "./usual.ts";

/** A card's cost is told over this many complete months at most. */
export const CARD_COST_MONTHS = 12;

/** What one connected card was charged in the months of `CardCosts`. */
export interface CardCost {
  accountId: string;
  name: string;
  /** Interest the bank charged on the card's balance, less interest it took back, never below zero. */
  interestCents: number;
  /** The card's other charges: a yearly fee, a withdrawal fee, a credit cost. */
  feeCents: number;
  /**
   * The interest of each month it was charged or taken back in, oldest first: the month's charges less what came back
   * in it, below zero when more came back. A reader that counts some of the months only sums these.
   */
  interestByMonth: { month: string; cents: number }[];
  /**
   * The months in which interest was charged and not taken back whole within the month, oldest first: each carried a
   * balance over from the statement before.
   */
  carriedMonths: string[];
  /** Ids of the interest rows, oldest first. */
  interestRows: string[];
  /** Ids of the fee rows, oldest first. */
  feeRows: string[];
}

export interface CardCosts {
  /** The complete months the costs are told over, oldest first: `CARD_COST_MONTHS` at most, none without a complete month. */
  months: string[];
  /** Every connected card in the order of the context's accounts, also one that was charged nothing. */
  cards: CardCost[];
}

/** The texts a bank puts its word for a charge in. */
const wordingOf = (t: AnalysisTx) => `${t.description ?? ""} ${t.merchant} ${t.counterparty ?? ""}`;

/** What each connected card was charged in the complete months before `end`'s month. */
export function cardCosts(ctx: AnalysisContext, end: IsoDate): CardCosts {
  const months = completeMonthsBefore(ctx, monthOf(end), CARD_COST_MONTHS);
  const cards = new Map<string, CardCost>();
  for (const a of ctx.accounts) {
    if (a.type === "credit_card") cards.set(a.id, { accountId: a.id, name: a.name, interestCents: 0, feeCents: 0, interestByMonth: [], carriedMonths: [], interestRows: [], feeRows: [] });
  }
  if (!months.length || !cards.size) return { months, cards: [...cards.values()] };
  // each card's interest by month, charges less what came back in that month; the rows come oldest first
  const byMonth = new Map<string, Map<string, number>>();
  const interestIn = (card: CardCost, month: string, cents: number) => {
    const ofCard = byMonth.get(card.accountId) ?? new Map<string, number>();
    byMonth.set(card.accountId, ofCard.set(month, (ofCard.get(month) ?? 0) + cents));
    card.interestCents += cents;
  };
  for (const t of inDays(ctx, toDayRange({ from: `${months[0]}-01`, to: monthEnd(months[months.length - 1]!) }))) {
    const card = cards.get(t.accountId);
    if (!card) continue;
    // Interest the bank takes back is money into the card under the charge's own word. `netSpend` cannot see it: a
    // return is paired with a purchase only, and interest is no purchase.
    if (t.amountCents > 0 && isPurchaseInterestText(wordingOf(t))) {
      interestIn(card, monthOf(t.bookingDate), -t.amountCents);
      continue;
    }
    if (!isBankFee(t)) continue;
    const cents = netSpend(t);
    if (cents <= 0) continue;
    if (isPurchaseInterestText(wordingOf(t))) {
      interestIn(card, monthOf(t.bookingDate), cents);
      card.interestRows.push(t.id);
    } else {
      card.feeCents += cents;
      card.feeRows.push(t.id);
    }
  }
  for (const card of cards.values()) {
    card.interestCents = Math.max(0, card.interestCents);
    card.interestByMonth = [...(byMonth.get(card.accountId) ?? [])].map(([month, cents]) => ({ month, cents }));
    card.carriedMonths = card.interestByMonth.filter((m) => m.cents > 0).map((m) => m.month);
  }
  return { months, cards: [...cards.values()] };
}
