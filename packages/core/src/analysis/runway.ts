/**
 * Decision: do the accounts hold out to the payday, and how much is left on the payday.
 *
 * Jää palkkapäivänä is what the counted accounts hold today, less what leaves them before the payday: the payments and
 * own transfers of the window (`Käytettävissä`, the card's bill among them) and the everyday spending expected on the
 * days up to the payday. The everyday spending is the expected figure (`expectedEveryday`, ADR 0021) of the days from
 * today to the day before the payday, and its range is the lower to the upper quartile of the base months, so the
 * answer is a range, never a bare sum.
 *
 * A card's purchases leave the account once, with the bill that pays them. A purchase already made is in the bill the
 * window holds. A purchase of the days after today up to the day of a bill that is paid in full and falls before the payday is in
 * that bill as well, so it is taken off (`billedCents`). A purchase after that day waits for a bill after the payday and
 * is told (`laterCents`) and taken off nothing. Besides those, what the counted accounts pay themselves (debit, cash,
 * a card they pay as it goes) is taken off.
 *
 * A card that is not connected and shows only as its bills (category card_bill, spread over the days of the base months by
 * `expectedEveryday`) is a card whose next bill is known: a bill of its series that falls before the payday is a payment
 * of the window and holds the purchases up to its day, and the purchases after the last one wait for a bill after the
 * payday. So the spread is never taken off here (`own` leaves the card bills out) and lands in `laterCents`.
 *
 * A connected card's debt counts against the payday only when its next bill falls inside the window (ADR 0031): that bill
 * is a row, or, when no bill is known for the card, the whole debt is taken off at once. A debt whose next bill falls on
 * the payday or later is paid from the coming pay, so it is taken off nothing and told (`laterCards`).
 *
 * `parts` is the figure told line by line, each sum negative when it leaves the accounts: the balance, the bills before
 * the payday, the card bills before the payday (the card rows and the debts taken off at once) and the expected spending
 * added up are `leftCents`, to the cent.
 *
 * The payday is the pay the window waits for (`cashAhead`). Without one the answer says why and does not guess.
 */
import { addDays, daysBetween, monthOf } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import type { AheadBasis } from "./ahead.ts";
import type { AnalysisContext } from "./context.ts";
import { type EverydayGap, expectedEveryday } from "./expected.ts";

/**
 * Why there is no runway. "no-payday": no regular pay to wait for within the days looked at, or one behind its day with
 * no next one. "late": the largest regular income is late. "no-balance": a counted checking account has no balance. "no-card-balance": a card in view has none.
 * "history": under three complete months to expect everyday spending from. "cards": the months start at a card connected later, so its earlier purchases are missing.
 */
type RunwayGap = "no-payday" | "late" | "no-balance" | "no-card-balance" | EverydayGap;

export type Runway =
  | { known: false; reason: RunwayGap }
  | {
      known: true;
      from: IsoDate;
      /** The pay the runway ends on, and who pays it. */
      payday: { date: IsoDate; name: string };
      /** The days from today to the day before the payday, today included: 0 when the payday is today. */
      days: number;
      /** What the counted accounts hold today. */
      balanceCents: number;
      /** `Käytettävissä`: the balance less the payments and own transfers of the window and the cards' debt that no bill of it holds. */
      freeCents: number;
      /** The everyday spending expected on the days to the payday that the counted accounts pay themselves: taken off. */
      everydayCents: number;
      /** The purchases expected on the cards whose bill is paid in full before the payday, from tomorrow to the day of that bill: the bill takes them, and they are taken off. */
      billedCents: number;
      /** The everyday spending expected on the same days that cards and other accounts take and no bill before the payday holds: a later bill pays it, after the payday. Taken off nothing. */
      laterCents: number;
      /** `Jää palkkapäivänä`: `freeCents` less `everydayCents` and `billedCents`. Below zero when the accounts do not hold out. */
      leftCents: number;
      /** The range of `leftCents`: the base months with the most and the least spending that is taken off. `lowCents <= leftCents <= highCents`. */
      lowCents: number;
      highCents: number;
      /** How many complete months the expected everyday spending is read from. */
      months: number;
      parts: RunwayParts;
    };

/** `leftCents` in its parts: `balanceCents + bills.cents + cardBills.cents + spending.cents` is `leftCents`. */
interface RunwayParts {
  /** What the counted accounts hold today. */
  balanceCents: number;
  /** The bills, typed bills and own transfers of the window: their sum (negative) and how many rows. */
  bills: { cents: number; count: number };
  /** The card bills of the window and the debt of the cards taken off at once: their sum (negative) and how many rows and cards. */
  cardBills: { cents: number; count: number };
  /** The expected spending taken off (`everydayCents` and `billedCents`, negative), and what it is with the base months that spent the most and the least: `lowCents <= cents <= highCents`. */
  spending: { cents: number; lowCents: number; highCents: number };
  /** The debt of the cards whose bill falls on the payday or later: taken off nothing, and how many cards. */
  laterCards: { cents: number; count: number };
}

/** The day the runway ends on: the pay the window waits for, the next one when that pay is behind its day. null when none is known. */
export function paydayOf({ reason, payday }: Pick<AheadBasis["ahead"], "reason" | "payday">): { date: IsoDate; name: string } | null {
  if (reason !== "payday" || !payday) return null;
  const date = payday.expected ? payday.next : payday.date;
  return date ? { date, name: payday.name } : null;
}

/** What is left of the counted accounts on the payday, with its range; the reason when it cannot be said. */
export function runwayOf(ctx: AnalysisContext, { ahead, direct, settling }: Pick<AheadBasis, "ahead" | "direct" | "settling">): Runway {
  const payday = paydayOf(ahead);
  if (!payday) return { known: false, reason: ahead.reason === "late" ? "late" : "no-payday" };
  if (!ahead.balance || !direct) return { known: false, reason: ahead.missing === "card" ? "no-card-balance" : "no-balance" };
  const { from } = ahead;
  const days = daysBetween(from, payday.date);
  const until = addDays(payday.date, -1);
  const all = expectedEveryday(ctx, from, until, () => true, monthOf(from));
  const own = expectedEveryday(ctx, from, until, (t) => direct.has(t.accountId) && t.category !== "card_bill", monthOf(from));
  if (typeof all === "string") return { known: false, reason: all };
  if (typeof own === "string") return { known: false, reason: own };
  // the purchases of a card that its coming bill holds: after today (what the card owes today holds the day's booked ones) to the day of the bill, when the window holds it
  const billed: Exclude<ReturnType<typeof expectedEveryday>, EverydayGap>[] = [];
  for (const { cardId, date } of settling) {
    if (date > ahead.to || direct.has(cardId)) continue;
    const found = expectedEveryday(ctx, addDays(from, 1), date, (t) => t.accountId === cardId, monthOf(from));
    if (typeof found === "string") return { known: false, reason: found };
    billed.push(found);
  }
  const sum = (key: "cents" | "lowCents" | "highCents") => billed.reduce((n, b) => n + b[key], 0);
  const spent = { cents: own.cents + sum("cents"), lowCents: own.lowCents + sum("lowCents"), highCents: own.highCents + sum("highCents") };
  const { freeCents, cardDebts, laterCardDebts, cardDebtCents } = ahead.balance;
  const cardRows = ahead.rows.filter((r) => r.source === "card");
  const parts: RunwayParts = {
    balanceCents: ahead.balance.startCents,
    bills: { cents: -(ahead.totals.leavingCents - ahead.totals.cardCents), count: ahead.rows.filter((r) => r.source === "recurring" || r.source === "expected" || r.source === "transfer").length },
    cardBills: { cents: -(ahead.totals.cardCents + cardDebtCents), count: cardRows.length + cardDebts.length },
    spending: { cents: -spent.cents, lowCents: -spent.highCents, highCents: -spent.lowCents },
    laterCards: { cents: laterCardDebts.reduce((n, d) => n + d.cents, 0), count: laterCardDebts.length },
  };
  return {
    known: true,
    from,
    payday,
    days,
    balanceCents: ahead.balance.startCents,
    freeCents,
    everydayCents: own.cents,
    billedCents: sum("cents"),
    laterCents: Math.max(0, all.cents - spent.cents),
    leftCents: freeCents - spent.cents,
    lowCents: freeCents - spent.highCents,
    highCents: freeCents - spent.lowCents,
    months: own.months,
    parts,
  };
}
