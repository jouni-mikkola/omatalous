/**
 * Credit cards the household pays and has not connected: the bills of a card whose account is not among the household's
 * are a monthly series of the category card_bill (a connected card's bills are transfers, which no series holds). Such a
 * card owes something nobody told, so each is asked once in Tarkistettavat (connect the card, or save it as a loan of
 * kind card with its balance and limit) and, until it is, listed beside the loans nobody saved with its monthly bill.
 *
 * Decision: whether a card's debt is still missing from what the household owes, and what to do about it.
 *
 * Its key is the series id without a product, which `Loan.seriesKey` takes when the household saves the card as a loan.
 * A card's bill differs from month to month, so the key holds no amount and names every series of the payee on the account.
 *
 * A card the household saved by hand (Lisää laina) has no key (only a loan made from a proposal gets one), so each saved
 * card loan with no key and no connected account takes one series, and a card of the issuer of a connected card account
 * is no question: its bills are that account's.
 *
 * The other cards whose purchases are missing from the twelve complete months (`cardGaps`) are asked beside them, so
 * every card of the figure of missing card purchases has its question.
 */
import { billCents } from "./account-use.ts";
import { billIssuer, issuerCards, missingCardBills } from "./analysis/card-bills.ts";
import { type AnalysisContext, type AnalysisTx, standingById } from "./analysis/context.ts";
import { accountCovers, coverage } from "./analysis/coverage.ts";
import { completeYear } from "./analysis/data-quality.ts";
import { cancelledSubjects, isCancelled } from "./commitments.ts";
import { cardUnknownAsked, unsavedDebtAnswered } from "./loan-terms-answer.ts";
import { type LoanProposal, notLoanKey, paysSeries, takenSeries } from "./loan-detect.ts";
import { loansOf, typedBill } from "./loans.ts";
import { parseSeriesId, seriesId } from "./series-id.ts";
import { isCut, type MonthlyProposal } from "./shared.ts";
import { namesCard } from "./transfers.ts";
import type { IsoDate, Loan, UserInputs } from "./types.ts";
import { withoutSwedishTwin } from "./wording-lenders.ts";

/** The part of a loan proposal a card shares with it: what the lists of unsaved loans read. */
type UnconnectedCard = MonthlyProposal<Pick<LoanProposal, "key" | "seriesId" | "payee" | "accountId" | "monthlyCents" | "paymentCents" | "months" | "firstDate" | "lastDate">>;

/** The card loans the household saved with no link to a series or an account: each may be a card whose bills are paid from another account. */
export const unlinkedCardLoans = (inputs: UserInputs): Loan[] => loansOf(inputs).filter((loan) => loan.kind === "card" && !loan.seriesKey && !loan.accountId);

/** The kinds a credit of unknown kind (`LoanProposal.kindUnknown`) may be. */
const CREDIT_KINDS: ReadonlySet<string> = new Set(["card", "credit_line", "consumer"]);

/** The card, credit line and consumer credit loans saved with no link to a series or an account: a credit of unknown kind may be one of them. */
export const unlinkedCreditLoans = (inputs: UserInputs): Loan[] => loansOf(inputs).filter((loan) => CREDIT_KINDS.has(loan.kind) && !loan.seriesKey && !loan.accountId);

/**
 * The cards to ask about today, the largest monthly bill first. One the household saved as a loan, marked "Ei ole velan maksu" or
 * cancelled is left out, and so is one of the issuer of a connected card account, at once and not after the bills have
 * become transfers.
 */
export function unconnectedCards(ctx: CardsContext, inputs: UserInputs): UnconnectedCard[] {
  return unconnectedCardsAndCredits(ctx, inputs).cards;
}

type CardsContext = Pick<AnalysisContext, "txs" | "recurring" | "standing" | "accounts" | "today">;

/**
 * `unconnectedCards`, and how many of the credits saved with no link and no typed payment (`unlinkedCreditLoans`) are
 * left once each card loan among them has taken a card: each of those is one of the credits of unknown kind
 * (`LoanProposal.kindUnknown`). A credit with a typed payment takes the series it fits in `loanProposals` instead.
 */
export function unconnectedCardsAndCredits(ctx: CardsContext, inputs: UserInputs): { cards: UnconnectedCard[]; creditsLeft: number } {
  const once = cardsOnce(ctx, inputs);
  // a card loan saved with no link is one of these cards, which one is not told: the largest bills are taken first
  const cardLoans = unlinkedCardLoans(inputs).length;
  const untyped = unlinkedCreditLoans(inputs).filter((loan) => typedBill(loan, ctx.today) === null);
  // the card loans with no typed payment are counted as the ones that took the cards, so fewer credits are left to hide
  const untypedCards = untyped.filter((loan) => loan.kind === "card").length;
  return { cards: once.slice(cardLoans), creditsLeft: untyped.length - Math.min(untypedCards, once.length) };
}

/** The series of card bills `unconnectedCards` asks of: a card paid each month. */
const billSeries = (ctx: Pick<AnalysisContext, "recurring">) => ctx.recurring.filter((s) => s.active && s.category === "card_bill" && s.cadence === "monthly");

/** Each card with a bill series nobody connected, saved, dismissed or cancelled, once, the largest monthly bill first. */
function cardsOnce(ctx: CardsContext, inputs: UserInputs): UnconnectedCard[] {
  const series = billSeries(ctx);
  if (!series.length) return [];
  const byId = standingById(ctx);
  const taken = takenSeries(inputs);
  const cancelled = cancelledSubjects(inputs);
  const connected = ctx.accounts.filter((a) => a.type === "credit_card");
  const cards = series
    .flatMap((s): UnconnectedCard[] => {
      const parts = parseSeriesId(s.id);
      const charges = s.transactionIds.map((id) => byId.get(id)).filter((t): t is AnalysisTx => !!t);
      if (!parts || parts.direction !== "out" || isCancelled(cancelled, s) || taken(s, charges)) return [];
      if (connected.some((card) => namesCard(s.merchant, card))) return [];
      // a joint account's rows hold the viewer's part: the bill is told as the bank charged it, as a loan's payment is
      const paymentCents = charges.some(isCut) ? -billCents(charges.reduce((last, t) => (t.day > last.day ? t : last))) : s.typicalAmountCents;
      return [{ key: seriesId({ ...parts, product: null }), seriesId: s.id, payee: withoutSwedishTwin(s.merchant), accountId: parts.accountId, monthlyCents: s.monthlyCents, paymentCents, months: s.monthsActive, firstDate: s.firstDate, lastDate: s.lastDate }];
    })
    .sort((a, b) => b.monthlyCents - a.monthlyCents || (a.key < b.key ? -1 : 1));
  // the key names every series of the payee on the account, so one card is one item
  return cards.filter((c, i) => cards.findIndex((o) => o.key === c.key) === i);
}

/** A card whose purchases the twelve complete months lack and that `unconnectedCards` does not ask about. */
interface CardGap {
  /**
   * The series key its answers name: for a card that is not connected the one of its latest bill, which a loan saved of
   * it is linked by; for a connected card one named by the card account alone, so a new name of the card keeps the answer.
   */
  key: string;
  /** The payee of its latest bill, or the connected card's name. */
  payee: string;
  /** The connected card, null for a card that is not connected. */
  cardId: string | null;
  /** Its bills of the twelve complete months whose purchases no row holds; null for a connected card whose rows begin in them and that has no such bill. */
  cents: number | null;
  /** The day of the latest of those bills, null for none. */
  lastDate: IsoDate | null;
  /** The day a connected card's rows begin when that is inside the twelve months, else null. */
  since: IsoDate | null;
}

/**
 * `takenSeries` of a bill that is in no series: whether a saved loan's key or an "Ei ole velan maksu" mark names the
 * series the bill pays (`paysSeries`).
 */
export function takenBill(inputs: UserInputs): (t: Pick<AnalysisTx, "accountId" | "merchant" | "amountCents">) => boolean {
  const loanKeys = loansOf(inputs).flatMap((loan) => loan.seriesKey ?? []);
  const keys = [...loanKeys, ...inputs.marks.flatMap((m) => (m.mark === "dismissed" ? (notLoanKey(m.subject) ?? []) : []))];
  return (t) => keys.some((key) => paysSeries(key, t, loanKeys));
}

/** The sum and the last day of a card's bills (`missingCardBills`, from loweredRows: what its statement left of each), null for none. */
function billsOf(bills: readonly AnalysisTx[]): Pick<CardGap, "cents" | "lastDate"> {
  if (!bills.length) return { cents: null, lastDate: null };
  return { cents: bills.reduce((sum, t) => sum + t.spend, 0), lastDate: bills.reduce((last, t) => (t.bookingDate > last ? t.bookingDate : last), bills[0]!.bookingDate) };
}

const largestFirst = (a: CardGap, b: CardGap): number => (b.cents ?? -1) - (a.cents ?? -1) || (a.key < b.key ? -1 : 1);

/**
 * The cards whose purchases the twelve complete months lack (`completeYear`, the window of the figure of missing card
 * purchases) and that `unconnectedCards` does not ask about, the largest bills first:
 * - a connected card whose bills of the window pay purchases its rows do not hold (`missingCardPurchases`'s
 *   `before_history` and `unmatched`), or whose rows begin inside the window (`cardRowsMissingIn`): its statement brings them;
 * - a card that is not connected whose bills form no monthly series (one bill, or bills that stopped): it is connected,
 *   saved as a loan of kind card, or its statement brought in.
 * Only card bills are read: a lender's payment with no word of a card stays a credit of unknown kind. A bill that a saved
 * loan or an "Ei ole velan maksu" mark names is left out, and so is a connected card linked to a loan of another kind. A
 * card loan saved with no link takes a card that is not connected, after the cards of `unconnectedCards` have taken theirs.
 */
export function cardGaps(ctx: AnalysisContext, inputs: UserInputs): CardGap[] {
  const taken = takenBill(inputs);
  const connected = ctx.accounts.filter((a) => a.type === "credit_card");
  const cardOf = issuerCards(ctx);
  // a card paid each month is unconnectedCards' to ask, or to leave out
  const monthly = new Set(billSeries(ctx).map(billIssuer));
  const window = completeYear(ctx.today);
  const byCard = new Map<string, AnalysisTx[]>();
  const byIssuer = new Map<string, AnalysisTx[]>();
  for (const t of missingCardBills(ctx, window)) {
    if (taken(t)) continue;
    const issuer = billIssuer(t);
    // a bill that names a connected card with no rows yet is that card's too: its debt is the account's
    const card = cardOf(issuer) ?? connected.find((c) => namesCard(t.merchant, c));
    if (card) byCard.set(card.id, [...(byCard.get(card.id) ?? []), t]);
    else if (!monthly.has(issuer)) byIssuer.set(issuer, [...(byIssuer.get(issuer) ?? []), t]);
  }
  const { began } = coverage(ctx);
  const otherKind = new Set(loansOf(inputs).flatMap((loan) => (loan.accountId && loan.kind !== "card" ? [loan.accountId] : [])));
  const cards = connected.flatMap((card): CardGap[] => {
    const bills = byCard.get(card.id) ?? [];
    const late = Number.isFinite(began(card.id)) && !accountCovers(ctx, [card.id], window.from);
    if (otherKind.has(card.id) || (!bills.length && !late)) return [];
    // the rows are sorted by day, so the first of the card is the day they begin
    const since = late ? (ctx.txs.find((t) => t.accountId === card.id)?.bookingDate ?? null) : null;
    return [{ key: seriesId({ direction: "out", accountId: card.id, merchant: card.id, product: null }), payee: card.name, cardId: card.id, ...billsOf(bills), since }];
  });
  const loose = [...byIssuer.values()]
    .map((bills): CardGap => {
      const last = bills.reduce((a, b) => (b.bookingDate > a.bookingDate ? b : a));
      return { key: seriesId({ direction: "out", accountId: last.accountId, merchant: last.merchant, product: null }), payee: withoutSwedishTwin(last.merchant), cardId: null, ...billsOf(bills), since: null };
    })
    .sort(largestFirst);
  // the card loans saved with no link that the cards paid each month left over take the largest of these
  const loansLeft = Math.max(0, unlinkedCardLoans(inputs).length - cardsOnce(ctx, inputs).length);
  return [...cards, ...loose.slice(loansLeft)].sort(largestFirst);
}

/**
 * The card rows Täydennä lainat holds today: `unconnectedCards` and `cardGaps` less each one the household set aside with
 * "En tiedä" (`cardUnknownAsked`), which holds until the bill, or the sum of the missing bills, rises. The list reads it
 * to ask, and the first page to tell whether a card row is open to answer.
 */
export function openCardRows(ctx: AnalysisContext, inputs: UserInputs): { cards: UnconnectedCard[]; gaps: CardGap[] } {
  return {
    cards: unconnectedCards(ctx, inputs).filter((c) => !unsavedDebtAnswered(inputs.marks, { card: c })),
    gaps: cardGaps(ctx, inputs).filter((g) => !cardUnknownAsked(inputs.marks, g.key, g.cents)),
  };
}
