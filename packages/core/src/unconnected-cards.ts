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
 * A card the household saved in Asetukset > Lainat has no key (only a loan made from a proposal gets one), so each saved
 * card loan with no key and no connected account takes one series, and a card of the issuer of a connected card account
 * is no question: its bills are that account's.
 */
import { billCents } from "./account-use.ts";
import { type AnalysisContext, type AnalysisTx, standingById } from "./analysis/context.ts";
import { cancelledSubjects, isCancelled } from "./commitments.ts";
import { type LoanProposal, takenSeries } from "./loan-detect.ts";
import { loansOf } from "./loans.ts";
import { parseSeriesId, seriesId } from "./series-id.ts";
import { isCut, type MonthlyProposal } from "./shared.ts";
import { namesCard } from "./transfers.ts";
import type { Loan, UserInputs } from "./types.ts";
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
 * The cards to ask about today, the largest monthly bill first. One the household saved as a loan, marked "Ei ole laina" or
 * cancelled is left out, and so is one of the issuer of a connected card account, at once and not after the bills have
 * become transfers.
 */
export function unconnectedCards(ctx: Pick<AnalysisContext, "txs" | "recurring" | "standing" | "accounts">, inputs: UserInputs): UnconnectedCard[] {
  const series = ctx.recurring.filter((s) => s.active && s.category === "card_bill" && s.cadence === "monthly");
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
  const once = cards.filter((c, i) => cards.findIndex((o) => o.key === c.key) === i);
  // a card loan saved with no link is one of these cards, which one is not told: the largest bills are taken first
  return once.slice(unlinkedCardLoans(inputs).length);
}
