/**
 * The loans' way from a day to the day they are paid (`debtPath`): what is owed and the interest still to come, by each
 * loan's own plan (`payments`, `planFrom` of `loans.ts`), and the same with the reference rate moved. The Lainat chart
 * draws it.
 */
import { partCents } from "./account-use.ts";
import { addMonthsToDate } from "./dates.ts";
import { type Debt, partly } from "./debt-part.ts";
import { type Payment, planOf } from "./loan-plan.ts";
import { hasReferenceRate, loanBalanceOn, type LoanUnknown, movedRate, planFrom } from "./loans.ts";
import type { IsoDate } from "./types.ts";

/** One line of `debtPath` at a moved reference rate. */
interface DebtPathMove {
  /** The move asked for in hundredths of a percent, as in `RateScenario`; each loan moves at most to its margin. */
  shiftBp: number;
  /** Balance and the interest still to pay on each day of the path, every loan a reference rate moves at the moved rate. */
  tops: number[];
  /** The due date that pays the last loan at that rate. */
  payoff: IsoDate;
  /** The interest still to pay on the path's first day at that rate less at today's: what the move costs, or saves, in all. */
  extraCents: number;
}

/**
 * Where the loans go from a day to the day they are paid: on the day and on the same day of each month after it, what
 * they owe and the interest of their payments still to come, each loan by its own plan (`payments`). The two stacked are
 * what is still to pay in all. A debt the plan cannot move forward (a card, a credit line, a loan lacking a field or one
 * that never ends) is left out and named in `left`. `moves` draws the same with the reference rate moved by each shift.
 */
export interface DebtPath {
  days: IsoDate[];
  /** What the loans of the path owe on each day. */
  balanceCents: number[];
  /** The interest of their payments due after each day, at today's rates. */
  interestCents: number[];
  /** `balanceCents` and `interestCents` stacked, so the chart adds up nothing. */
  tops: number[];
  /** The due date that pays the last loan of the path; null when no loan is in it. */
  payoff: IsoDate | null;
  /** Only when a loan of the path has a reference rate, and only the moves that change what is still to pay. */
  moves: DebtPathMove[];
  /** The debts that owe on the day and are not in the path, with the field that would have put them there. */
  left: { id: string; name: string; unknown: LoanUnknown }[];
}

/** The payments of one loan from the day on at a shift, cut to its part, or why it has none. */
function pathPayments(loan: Debt, day: IsoDate, shiftBp: number): { start: number; list: Payment[] } | LoanUnknown | null {
  const cut = partly(loan);
  if (cut) {
    const whole = pathPayments(cut.whole, day, shiftBp);
    if (whole === null || typeof whole === "string") return whole;
    // each figure cut once: the parts of a debt's users add up to the debt on every day
    const part = (c: number) => partCents(c, cut.part);
    return { start: part(whole.start), list: whole.list.map((p) => ({ ...p, interestCents: part(p.interestCents!), balanceCents: part(p.balanceCents) })) };
  }
  if (day < loan.balanceDate) return "before_balance_date";
  if ((loanBalanceOn(loan, day).cents ?? 1) <= 0) return null;
  if (loan.rateBp === null) return "rate";
  const plan = planOf(loan);
  if ("missing" in plan) return plan.missing ?? "repayment";
  const from = planFrom(loan, plan, day, hasReferenceRate(loan) ? movedRate(loan.rateBp, loan.marginBp, shiftBp) : loan.rateBp);
  if (from === null) return "end_date";
  const list = [...from.payments()];
  if (list.length === 0 || list.at(-1)!.balanceCents > 0) return "end_date";
  return { start: from.balanceCents, list: list.map((p) => ({ ...p, interestCents: p.interestCents ?? 0 })) };
}

/** The path of `DebtPath` from `day`, with a line for each reference rate move of `shiftsBp`. */
export function debtPath(loans: readonly Debt[], day: IsoDate, shiftsBp: readonly number[] = []): DebtPath {
  const left: DebtPath["left"] = [];
  const base: { loan: Debt; start: number; list: Payment[] }[] = [];
  for (const loan of loans) {
    const p = pathPayments(loan, day, 0);
    if (p === null) continue;
    if (typeof p === "string") left.push({ id: loan.id, name: loan.name, unknown: p });
    else base.push({ loan, ...p });
  }
  // a move that leaves a loan with no plan (an annuity that would never end) has no line to draw
  const shifted = shiftsBp.flatMap((shiftBp) => {
    const line = base.map((b) => ({ ...b, moved: pathPayments(b.loan, day, shiftBp) }));
    return line.every((b) => b.moved !== null && typeof b.moved !== "string") ? [{ shiftBp, line: line.map((b) => ({ loan: b.loan, ...(b.moved as { start: number; list: Payment[] }) })) }] : [];
  });
  const lines = [base, ...shifted.map((s) => s.line)];
  const lastDate = (line: typeof base) => line.reduce<IsoDate | null>((m, b) => (m === null || b.list.at(-1)!.date > m ? b.list.at(-1)!.date : m), null);
  const ends = lines.map(lastDate);
  const end = ends.reduce<IsoDate | null>((m, e) => (e !== null && (m === null || e > m) ? e : m), null);
  const days: IsoDate[] = [day];
  for (let k = 1; end !== null && days.at(-1)! < end; k++) days.push(addMonthsToDate(day, k));
  // owed and interest still to come on each day: the balance after the last payment on or before it, the interest of the payments after it
  const walk = (line: typeof base) => {
    const owed = days.map(() => 0);
    const interest = days.map(() => 0);
    for (const b of line) {
      let i = 0;
      let after = b.list.reduce((s, p) => s + p.interestCents!, 0);
      let balance = b.start;
      days.forEach((d, k) => {
        while (i < b.list.length && b.list[i]!.date <= d) {
          after -= b.list[i]!.interestCents!;
          balance = b.list[i]!.balanceCents;
          i++;
        }
        owed[k]! += balance;
        interest[k]! += after;
      });
    }
    return { owed, interest, tops: owed.map((o, k) => o + interest[k]!) };
  };
  const [now, ...moved] = lines.map(walk);
  return {
    days,
    balanceCents: now!.owed,
    interestCents: now!.interest,
    tops: now!.tops,
    payoff: ends[0] ?? null,
    moves: moved.flatMap((m, k) => (m.interest[0] === now!.interest[0] ? [] : [{ shiftBp: shifted[k]!.shiftBp, tops: m.tops, payoff: ends[k + 1]!, extraCents: m.interest[0]! - now!.interest[0]! }])),
    left,
  };
}
