/**
 * Decision: do I have enough on the account until the pay comes, and when to move money to it.
 *
 * The accounts whose balance the payday window counts, and the two kinds of money that leave them without being
 * spending: the bill of a connected card and a regular transfer to an account the window does not count. Both are
 * read from the transfer rows of the view and are a flow nowhere else.
 */
import { billCents } from "../account-use.ts";
import { payeeKey } from "../card-channel.ts";
import { expectedCharges } from "../commitments.ts";
import { addMonths, dateIn, daysBetween, monthOf } from "../dates.ts";
import { creditAccountLoan, creditUse } from "../loans.ts";
import { cardName } from "../merchant.ts";
import { detectRecurring } from "../recurring.ts";
import type { SeriesInput } from "../recurring-occurrence.ts";
import { median } from "../stats.ts";
import { incomingLegFinder, PAIR_WINDOW_DAYS } from "../pairing.ts";
import { normalizeIban } from "../transfers.ts";
import type { BalanceInput, IsoDate } from "../types.ts";
import { balanceWalk } from "./balance-walk.ts";
import type { AnalysisContext, AnalysisTx } from "./context.ts";
import { USUAL_MONTHS } from "../thresholds.ts";

/** Fewer bills than this say nothing of a card's bill day or its usual bill: nothing is guessed. */
const MIN_PAYMENTS = 3;
/** A bill day nearer than this to the last bill is that bill itself, paid early or late. */
const MIN_BILL_GAP_DAYS = 15;
/** A bill this many days late is still expected, on the first day of the window. A later one did not come. */
const LATE_DAYS = 5;
/** No bill for this long after the last one: two bill days went by, so the card is not in use or is paid from elsewhere. */
const STALE_DAYS = 62;
/** The days between two monthly bills, a bill paid early or late included. Payments closer than this pay the card as it goes. */
const STATEMENT_GAP_DAYS = { min: 21, max: 41 } as const;

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
  /** Of a card's bill: the card's account. */
  cardId?: string;
}

/** A card's bill as it was paid: the leg that left a counted account, and the day it reached the card. */
interface PaidBill {
  out: AnalysisTx;
  cardDay: number;
  /** The id of the leg on the card, when it was found. */
  legId: string | null;
}

/** The next bill of a card that is paid in full: it will hold the card's purchases of the days up to its day too. */
export interface Settling {
  cardId: string;
  /** The day the bill is paid, never before the window's first day. */
  date: IsoDate;
}

/** The moves, the connected cards the counted accounts pay as they go (no bill of theirs is expected) and the next bills of the cards paid in full. */
interface Moves {
  moves: Move[];
  asItGoes: ReadonlySet<string>;
  settling: Settling[];
}

/**
 * Whether the payments to a card follow a statement: the household typed in a statement for one of the last bills, or
 * the last three came a month apart. The bank tells a card's balance and limit and no due day or minimum, so a bill
 * day is read from the payments alone. A card paid many times a month has no bill day.
 */
function hasStatement(ctx: AnalysisContext, paid: readonly PaidBill[]): boolean {
  const last = paid.slice(-MIN_PAYMENTS);
  if (last.some((b) => ctx.statements.has(b.out.id) || (b.legId !== null && ctx.statements.has(b.legId)))) return true;
  return last.slice(1).every((b, i) => {
    const gap = b.out.day - last[i]!.out.day;
    return gap >= STATEMENT_GAP_DAYS.min && gap <= STATEMENT_GAP_DAYS.max;
  });
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
 * A card's bill is expected only when its payments follow a statement (`hasStatement`); a card the household pays
 * as it goes has no bill to wait for, and its purchases are everyday spending (`asItGoes`). A bill comes on the median
 * day of the month of its last three bills. Its sum is what the card owes today (`creditUse`) when the last bill was
 * paid: it is not late, and it covered what the card owed after the bill before it, so the card is paid in full and
 * what it owes now is the next bill. Otherwise, and for a second bill inside the days, it is the usual bill: the median
 * of the last six, never more than the card owes. A savings plan to an account that is not connected is no
 * transfer row at all, so `expectedCharges` gives it once and this gives it never.
 *
 * `settling` names the bills whose sum is what the card owes today: the card is paid in full, so that bill takes the
 * purchases made from today to its day as well, and the sum of the move does not hold them. A bill of the usual
 * sum is a month's payment and holds them already. A card paid in full with nothing owed has a settling bill and no move.
 */
export function expectedMoves(ctx: AnalysisContext, counted: ReadonlySet<string>, balances: readonly BalanceInput[], from: IsoDate, until: IsoDate): Moves {
  const accountOf = new Map(ctx.accounts.map((a) => [a.id, a]));
  // the bank's own text may carry the type of a card in brackets: a payee is printed without it
  const accountName = (id: string): string => cardName(accountOf.get(id)?.name ?? id);
  const followed = followLeft(ctx, counted, accountOf);
  const unapplied = claimUnknown(ctx, followed);

  const moves: Move[] = [];
  // a monthly series takes three payments to be one (`fitCadence`): under three nothing is guessed
  const regular = detectRecurring(followed.others, ctx.today).filter((s) => s.cadence === "monthly");
  for (const c of expectedCharges(regular, from, until)) moves.push({ date: c.date, name: accountName(c.merchant), amountCents: c.amountCents, source: "transfer" });

  const asItGoes = new Set<string>();
  const settling: Settling[] = [];
  for (const [cardId, unsorted] of followed.bills) {
    if (unsorted.length < MIN_PAYMENTS) continue;
    const paid = [...unsorted].sort((a, b) => a.out.day - b.out.day);
    if (!hasStatement(ctx, paid)) {
      asItGoes.add(cardId);
      continue;
    }
    const card = { id: cardId, name: accountName(cardId), balance: balances.find((b) => b.id === cardId), unappliedCents: unapplied.get(cardId) ?? 0 };
    cardBills(ctx, card, paid, from, until, { moves, settling });
  }
  return { moves, asItGoes, settling };
}

/** The transfers that left the counted accounts, by where they went. */
interface Followed {
  /** Per connected card, the payments that reached it. */
  bills: Map<string, PaidBill[]>;
  /** The payments to an account the window does not count, one series for each. */
  others: SeriesInput[];
  /** The payments whose other end is not known. */
  unknown: AnalysisTx[];
}

/** Follows every booked transfer out of a counted account to the account it went to. */
function followLeft(ctx: AnalysisContext, counted: ReadonlySet<string>, accountOf: ReadonlyMap<string, AnalysisContext["accounts"][number]>): Followed {
  const byIban = new Map(ctx.accounts.flatMap((a) => (normalizeIban(a.iban) ? [[normalizeIban(a.iban)!, a.id] as const] : [])));
  const moved = ctx.txs.filter((t) => t.isTransfer && t.status === "booked");
  // the leg that came in for a leg that left, by the bank's sum (pairing.ts)
  const legOf = incomingLegFinder(moved, billCents);

  const left = moved.filter((t) => t.amountCents < 0 && counted.has(t.accountId)).map((out) => ({ out, named: byIban.get(normalizeIban(out.counterpartyIban) ?? "") ?? null }));
  const bills = new Map<string, PaidBill[]>();
  const others: SeriesInput[] = [];
  const unknown: AnalysisTx[] = [];
  // a leg that names its account takes its other leg first, so a card's bill of the same sum on the same days keeps its own
  for (const { out, named } of [...left.filter((l) => l.named !== null), ...left.filter((l) => l.named === null)]) {
    const leg = legOf(out, named);
    const to = named ?? leg?.accountId ?? null;
    if (to !== null && counted.has(to)) continue;
    if (to !== null && accountOf.get(to)?.type === "credit_card") bills.set(to, [...(bills.get(to) ?? []), { out, cardDay: leg?.day ?? out.day, legId: leg?.id ?? null }]);
    else if (to === null) unknown.push(out);
    // one series for each receiving account
    else others.push({ ...out, merchant: to, category: "other", isTransfer: false });
  }
  return { bills, others, unknown };
}

/**
 * Gives every payment whose other end is not known to the card it paid, or to `others` under its own text. Returns,
 * per card, what its balance may not hold yet.
 */
function claimUnknown(ctx: AnalysisContext, { bills, others, unknown }: Followed): Map<string, number> {
  // A payment whose other leg the card does not show yet, or shows pending, went to the payee a card's paired bills
  // went to (`payeeKey`): it is that card's bill, already paid, so it is not expected again.
  const channel = new Map<string, string>();
  for (const [cardId, paid] of bills) for (const b of paid) if (b.legId !== null) channel.set(payeeKey(b.out) ?? "", cardId);
  channel.delete("");
  /** Per card, what left the counted accounts in the last days with no leg on the card: the card's balance may not hold it yet. */
  const unapplied = new Map<string, number>();
  for (const out of unknown) {
    const cardId = channel.get(payeeKey(out) ?? "");
    // a leg whose other end is not known keeps its own text
    if (cardId === undefined) {
      others.push({ ...out, merchant: out.merchant, category: "other", isTransfer: false });
      continue;
    }
    bills.get(cardId)!.push({ out, cardDay: out.day, legId: null });
    if (ctx.todayDay - out.day <= PAIR_WINDOW_DAYS) unapplied.set(cardId, (unapplied.get(cardId) ?? 0) - out.amountCents);
  }
  return unapplied;
}

/** A card whose payments follow a statement: its balance when it is in view, and what was paid to it that the balance may not hold yet. */
interface BilledCard {
  id: string;
  name: string;
  balance: BalanceInput | undefined;
  unappliedCents: number;
}

/** Adds the bills of one card expected from `from` to `until`, its payments in the order of their days, to `into`. */
function cardBills(ctx: AnalysisContext, card: BilledCard, paid: readonly PaidBill[], from: IsoDate, until: IsoDate, into: Pick<Moves, "moves" | "settling">): void {
  const last = paid.at(-1)!;
  const lastCents = -last.out.amountCents;
  const day = Math.round(median(paid.slice(-MIN_PAYMENTS).map((b) => Number(b.out.bookingDate.slice(8, 10)))));
  // the card's own bills, not a month's spending: the middle bill is the usual one, a dear month does not move it
  const usual = Math.round(median(paid.slice(-USUAL_MONTHS).map((b) => -b.out.amountCents)));
  const debt = card.balance ? creditAccountLoan(card.balance, ctx.today) : null;
  const used = debt ? creditUse(debt, ctx.today).usedCents : null;
  // never more than the card owes: a payment its balance may not hold yet is taken off
  const owed = used === null ? null : Math.max(0, used - card.unappliedCents);
  // what the card held at the end of the day the bill before the last reached it: under zero is owed
  const heldThen = card.balance ? (balanceWalk(ctx, card.balance)?.at(paid.at(-2)!.cardDay) ?? null) : null;
  const paidWhole = heldThen !== null && -heldThen <= lastCents;
  let first = true;
  for (let month = monthOf(last.out.bookingDate); ; month = addMonths(month, 1)) {
    const date = dateIn(month, day);
    const sinceLast = daysBetween(last.out.bookingDate, date);
    if (date > until || sinceLast > STALE_DAYS) break;
    if (sinceLast < MIN_BILL_GAP_DAYS || daysBetween(date, from) > LATE_DAYS) continue;
    const basis = first && owed !== null && paidWhole && date >= from ? "balance" : "usual";
    if (basis === "balance") into.settling.push({ cardId: card.id, date: date < from ? from : date });
    first = false;
    const amountCents = basis === "balance" ? owed! : owed === null ? usual : Math.min(usual, owed);
    if (amountCents > 0) into.moves.push({ date: date < from ? from : date, name: card.name, amountCents, source: "card", basis, cardId: card.id });
  }
}
