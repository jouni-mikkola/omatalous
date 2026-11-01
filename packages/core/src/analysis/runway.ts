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
 * The payday is the pay the window waits for (`cashAhead`). Without one the answer says why and does not guess.
 */
import { addDays, daysBetween, monthOf } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import type { AheadBasis } from "./ahead.ts";
import type { AnalysisContext } from "./context.ts";
import { type EverydayGap, expectedEveryday } from "./expected.ts";

/**
 * Why there is no runway. "no-payday": no regular pay to wait for within the days looked at, or one behind its day with
 * no next one. "late": the largest regular income is late. "no-balance": a counted checking account has no balance.
 * "history": under three complete months to expect everyday spending from. "cards": a linked card's purchases are missing from them.
 */
type RunwayGap = "no-payday" | "late" | "no-balance" | EverydayGap;

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
      /** `Käytettävissä`: the balance less the payments and own transfers of the window. */
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
    };

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
  if (!ahead.balance || !direct) return { known: false, reason: "no-balance" };
  const { from } = ahead;
  const days = daysBetween(from, payday.date);
  const until = addDays(payday.date, -1);
  const all = expectedEveryday(ctx, from, until);
  const own = expectedEveryday(ctx, from, until, (t) => direct.has(t.accountId));
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
  const { freeCents } = ahead.balance;
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
  };
}
