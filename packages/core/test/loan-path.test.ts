import { describe, expect, it } from "vitest";
import { debtPath } from "../src/loan-path.ts";
import { loanInterestNext12Months, loanPayoffDate } from "../src/loans.ts";
import type { Loan } from "../src/types.ts";

// the Lainat chart's path (VC2): what is owed and the interest still to come from today to the day the loans are paid
const loan = (over: Partial<Loan> = {}): Loan => ({
  id: "loan-1",
  name: "Asuntolaina",
  lender: null,
  kind: "mortgage",
  grantedCents: null,
  balanceCents: 12_000_000,
  balanceDate: "2026-01-15",
  rateBp: 350,
  reference: "euribor_12",
  marginBp: 60,
  repayment: "annuity",
  intervalMonths: 1,
  paymentCents: 70_000,
  endDate: "2045-01-15",
  limitCents: null,
  seriesKey: null,
  ...over,
});
const day = "2026-10-19";

describe("debtPath", () => {
  const home = loan();
  const car = loan({ id: "loan-2", name: "Autolaina", kind: "car", balanceCents: 1_500_000, rateBp: 590, reference: "fixed", marginBp: null, paymentCents: 40_000, endDate: "2030-03-01" });
  const p = debtPath([home, car], day, [-100, 100]);

  it("starts at what is owed with the interest still to come, and ends at nothing on the payoff date", () => {
    expect(p.days[0]).toBe(day);
    expect(p.tops[0]).toBe(p.balanceCents[0]! + p.interestCents[0]!);
    expect(p.tops.every((t, k) => t === p.balanceCents[k]! + p.interestCents[k]!)).toBe(true);
    expect(p.tops.at(-1)).toBe(0);
    expect(p.payoff).toBe([loanPayoffDate(home).date!, loanPayoffDate(car).date!].sort().at(-1));
    expect(p.days.at(-1)! >= p.payoff!).toBe(true);
    // never up: each month pays some of it
    for (let k = 1; k < p.tops.length; k++) expect(p.tops[k]!).toBeLessThanOrEqual(p.tops[k - 1]!);
  });

  it("takes the next 12 months of interest from the path as loans.ts tells them", () => {
    expect(p.interestCents[0]! - p.interestCents[12]!).toBe(loanInterestNext12Months(home, day).cents! + loanInterestNext12Months(car, day).cents!);
  });

  it("draws a moved reference rate on the loans it moves, with what the move costs in all", () => {
    const up = p.moves.find((m) => m.shiftBp === 100)!;
    const down = p.moves.find((m) => m.shiftBp === -100)!;
    expect(up.extraCents).toBeGreaterThan(0);
    expect(down.extraCents).toBeLessThan(0);
    expect(up.tops[0]! - p.tops[0]!).toBe(up.extraCents);
    // an annuity keeps its end when the rate moves: the payment changes, so the path ends on the same day
    expect(up.payoff).toBe(p.payoff);
  });

  it("has no move for loans a reference rate does not move", () => {
    expect(debtPath([car], day, [-100, 100]).moves).toEqual([]);
  });

  it("leaves out a debt with no plan and names why, and a paid one altogether", () => {
    const line = loan({ id: "line", name: "Luottoraja", kind: "credit_line", repayment: null, intervalMonths: null, paymentCents: null, endDate: null, balanceCents: 50_000 });
    const paid = loan({ id: "paid", balanceCents: 0 });
    const noRate = loan({ id: "norate", rateBp: null });
    const q = debtPath([home, line, paid, noRate], day);
    expect(q.left).toEqual([
      { id: "line", name: "Luottoraja", unknown: "repayment" },
      { id: "norate", name: "Asuntolaina", unknown: "rate" },
    ]);
    expect(q.balanceCents[0]).toBe(debtPath([home], day).balanceCents[0]);
  });

  it("is empty with no loan to draw", () => {
    expect(debtPath([], day, [100])).toEqual({ days: [day], balanceCents: [0], interestCents: [0], tops: [0], payoff: null, moves: [], left: [] });
  });

  it("cuts a debt at a part to the part", () => {
    const mine = debtPath([{ ...home, part: { from: 0, to: 1, of: 2 } }], day);
    const theirs = debtPath([{ ...home, part: { from: 1, to: 2, of: 2 } }], day);
    const whole = debtPath([home], day);
    expect(mine.balanceCents[0]! + theirs.balanceCents[0]!).toBe(whole.balanceCents[0]);
    expect(mine.days).toEqual(whole.days);
  });
});
