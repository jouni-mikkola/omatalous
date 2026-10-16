/**
 * Decision: do I have enough on the account until the pay comes, and when to move money to it.
 *
 * The accounts whose balance the payday window counts, and the two kinds of money that leave them without being
 * spending: the bill of a connected card and a regular transfer to an account the window does not count. Both are
 * read from the transfer rows of the view and are a flow nowhere else.
 */
import { billCents } from "../account-use.ts";
import { expectedCharges } from "../commitments.ts";
import { addMonths, dateIn, daysBetween, monthOf } from "../dates.ts";
import { creditAccountLoan, creditUse } from "../loans.ts";
import { detectRecurring } from "../recurring.ts";
import type { SeriesInput } from "../recurring-occurrence.ts";
import { median } from "../stats.ts";
import { normalizeIban, PAIR_WINDOW_DAYS } from "../transfers.ts";
import type { BalanceInput, IsoDate } from "../types.ts";
import { balanceWalk } from "./balance-walk.ts";
import type { AnalysisContext, AnalysisTx } from "./context.ts";
import { USUAL_MONTHS, usualCents } from "./usual.ts";

/** Fewer bills than this say nothing of a card's bill day or its usual bill: nothing is guessed. */
const MIN_PAYMENTS = 3;
/** A bill day nearer than this to the last bill is that bill itself, paid early or late. */
const MIN_BILL_GAP_DAYS = 15;
/** A bill this many days late is still expected, on the first day of the window. A later one did not come. */
const LATE_DAYS = 5;
/** No bill for this long after the last one: two bill days went by, so the card is not in use or is paid from elsewhere. */
const STALE_DAYS = 62;

/** The accounts whose balance the window counts. */
export interface Counted {
  /**
   * "all": every checking account in view. "own": the checking accounts the viewer uses alone, while a joint one in
   * view is left out. "part": no checking account is the viewer's alone, so the joint ones, which the view holds at
   * the viewer's part.
   */
  counts: "own" | "part" | "all";
  accounts: readonly BalanceInput[];
  ids: ReadonlySet<string>;
}

/**
 * Which accounts the window follows. A member's own view names the viewer's part of each account, already applied to
 * its balance and its rows; the household view names none, and every account is whole there. Null without a checking
 * account in view: then there is no balance to follow and the window lists what the whole view expects.
 */
export function countedAccounts(balances: readonly BalanceInput[]): Counted | null {
  const checking = balances.filter((b) => b.type === "checking" && (!b.part || b.part.to > b.part.from));
  if (!checking.length) return null;
  const alone = checking.filter((b) => !b.part || (b.part.from === 0 && b.part.to === b.part.of));
  const accounts = alone.length ? alone : checking;
  return { counts: !alone.length ? "part" : alone.length < checking.length ? "own" : "all", accounts, ids: new Set(accounts.map((b) => b.id)) };
}

/** Money that is expected to leave the counted accounts for another account of the household. */
interface Move {
  date: IsoDate;
  /** The card, or the account the money goes to. */
  name: string;
  /** Positive. */
  amountCents: number;
  source: "card" | "transfer";
  /** Of a card's bill: "balance" is what the card owes today, "usual" the median of its paid bills. */
  basis?: "balance" | "usual";
}

/** A card's bill as it was paid: the leg that left a counted account, and the day it reached the card. */
interface PaidBill {
  out: AnalysisTx;
  cardDay: number;
}

/**
 * The card bills and the regular own transfers expected from `from` to `until`.
 *
 * Every booked transfer out of a counted account is followed to the account it went to: the own account it names by
 * IBAN, else the account its other leg is on (the bank's sum, at most five days apart). Money to another counted
 * account changes nothing. Money to a connected card is that card's bill. The rest, to savings, to a joint account or
 * to an account the other leg does not show, is a regular transfer when `detectRecurring` finds a monthly series of
 * three payments or more in it; it is expected as `expectedCharges` expects any series, so a late one is no row.
 *
 * A card's bill comes on the median day of the month of its last three bills. Its sum is what the card owes today
 * (`creditUse`) when the last bill was paid: it is not late, and it covered what the card owed after the bill before
 * it, so the card is paid in full and what it owes now is the next bill. Otherwise, and for a second bill inside the
 * days, it is the usual bill: the median of the last six. A savings plan to an account that is not connected is no
 * transfer row at all, so `expectedCharges` gives it once and this gives it never.
 */
export function expectedMoves(ctx: AnalysisContext, counted: ReadonlySet<string>, balances: readonly BalanceInput[], from: IsoDate, until: IsoDate): Move[] {
  const accountOf = new Map(ctx.accounts.map((a) => [a.id, a]));
  const byIban = new Map(ctx.accounts.flatMap((a) => (normalizeIban(a.iban) ? [[normalizeIban(a.iban)!, a.id] as const] : [])));
  const moved = ctx.txs.filter((t) => t.isTransfer && t.status === "booked");
  // the legs that came in, by the bank's sum: a leg on a joint account is cut to the viewer's part in a member's own view
  const cameIn = new Map<number, AnalysisTx[]>();
  for (const t of moved) {
    if (t.amountCents <= 0) continue;
    const legs = cameIn.get(billCents(t));
    if (legs) legs.push(t);
    else cameIn.set(billCents(t), [t]);
  }
  const used = new Set<string>();
  /** The leg that came in for a leg that left: on `to` when the leg names its account, the nearest day first. */
  const legOf = (out: AnalysisTx, to: string | null): AnalysisTx | undefined => {
    let best: AnalysisTx | undefined;
    for (const t of cameIn.get(-billCents(out)) ?? []) {
      const gap = Math.abs(t.day - out.day);
      if (t.accountId === out.accountId || used.has(t.id) || gap > PAIR_WINDOW_DAYS || (to !== null && t.accountId !== to)) continue;
      if (!best || gap < Math.abs(best.day - out.day)) best = t;
    }
    if (best) used.add(best.id);
    return best;
  };

  const left = moved.filter((t) => t.amountCents < 0 && counted.has(t.accountId)).map((out) => ({ out, named: byIban.get(normalizeIban(out.counterpartyIban) ?? "") ?? null }));
  const bills = new Map<string, PaidBill[]>();
  const others: SeriesInput[] = [];
  // a leg that names its account takes its other leg first, so a card's bill of the same sum on the same days keeps its own
  for (const { out, named } of [...left.filter((l) => l.named !== null), ...left.filter((l) => l.named === null)]) {
    const leg = legOf(out, named);
    const to = named ?? leg?.accountId ?? null;
    if (to !== null && counted.has(to)) continue;
    if (to !== null && accountOf.get(to)?.type === "credit_card") bills.set(to, [...(bills.get(to) ?? []), { out, cardDay: leg?.day ?? out.day }]);
    // one series for each receiving account; a leg whose other end is not known keeps its own text
    else others.push({ ...out, merchant: to ?? out.merchant, category: "other", isTransfer: false });
  }

  const moves: Move[] = [];
  // a monthly series takes three payments to be one (`fitCadence`): under three nothing is guessed
  const regular = detectRecurring(others, ctx.today).filter((s) => s.cadence === "monthly");
  for (const c of expectedCharges(regular, from, until)) moves.push({ date: c.date, name: accountOf.get(c.merchant)?.name ?? c.merchant, amountCents: c.amountCents, source: "transfer" });

  for (const [cardId, unsorted] of bills) {
    if (unsorted.length < MIN_PAYMENTS) continue;
    const paid = [...unsorted].sort((a, b) => a.out.day - b.out.day);
    const last = paid.at(-1)!;
    const lastCents = -last.out.amountCents;
    const day = Math.round(median(paid.slice(-MIN_PAYMENTS).map((b) => Number(b.out.bookingDate.slice(8, 10)))));
    const usual = usualCents(paid.slice(-USUAL_MONTHS).map((b) => -b.out.amountCents))!;
    const card = balances.find((b) => b.id === cardId);
    const debt = card ? creditAccountLoan(card, ctx.today) : null;
    const owed = debt ? creditUse(debt, ctx.today).usedCents : null;
    // what the card held at the end of the day the bill before the last reached it: under zero is owed
    const heldThen = card ? (balanceWalk(ctx, card)?.at(paid.at(-2)!.cardDay) ?? null) : null;
    const paidWhole = heldThen !== null && -heldThen <= lastCents;
    let first = true;
    for (let month = monthOf(last.out.bookingDate); ; month = addMonths(month, 1)) {
      const date = dateIn(month, day);
      const sinceLast = daysBetween(last.out.bookingDate, date);
      if (date > until || sinceLast > STALE_DAYS) break;
      if (sinceLast < MIN_BILL_GAP_DAYS || daysBetween(date, from) > LATE_DAYS) continue;
      const basis = first && owed !== null && paidWhole && date >= from ? "balance" : "usual";
      first = false;
      const amountCents = basis === "balance" ? owed! : usual;
      if (amountCents > 0) moves.push({ date: date < from ? from : date, name: accountOf.get(cardId)!.name, amountCents, source: "card", basis });
    }
  }
  return moves;
}
