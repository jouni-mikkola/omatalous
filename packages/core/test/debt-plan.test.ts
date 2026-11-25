import { describe, expect, it } from "vitest";
import { debtCost } from "../src/debt-cost.ts";
import { consolidationBasis, consolidationCost, extraPlan, payoffPlan } from "../src/debt-plan.ts";
import { debtPath } from "../src/loan-path.ts";
import { annuityPayment, loanSchedule, loanWhatIf } from "../src/loan-schedule.ts";
import { settledCardLoan } from "../src/loans.ts";
import type { IsoDate, Loan } from "../src/types.ts";

const START = "2026-01-15";

/** A loan with a stated fee of 0 €, so its cost is its interest: each test sets its terms. */
const loan = (over: Partial<Loan> = {}): Loan => ({
  id: "loan-1",
  name: "Laina",
  lender: null,
  kind: "consumer",
  grantedCents: null,
  balanceCents: 1_000_000,
  balanceDate: START,
  rateBp: 500,
  reference: null,
  marginBp: null,
  repayment: "fixed_instalment",
  intervalMonths: 1,
  paymentCents: 20_000,
  endDate: null,
  limitCents: null,
  seriesKey: null,
  paymentParts: [{ dueDate: START, principalCents: 0, interestCents: 0, feeCents: 0 }],
  ...over,
});

/** A buffer already full: all the extra money goes to the debts. */
const FULL = { netCents: 1_000_000, spendCents: 500_000 };

/** The payment the plan asks for after the day, as `loanWhatIf` replaces it: the repayment alone of an equal principal loan. */
const planned = (l: Loan, day: IsoDate): number => {
  const next = loanSchedule(l, day).rows[0]!;
  return l.repayment === "equal_principal" ? next.principalCents : next.interestCents! + next.principalCents;
};

describe("payoffPlan", () => {
  it.each([
    ["an annuity", loan({ repayment: "annuity", paymentCents: 18_871, endDate: "2031-01-15" }), START],
    ["an annuity from a day inside an interval", loan({ repayment: "annuity", paymentCents: 18_871, endDate: "2031-01-15" }), "2026-03-20"],
    ["a fixed instalment", loan(), START],
    ["an equal principal loan", loan({ repayment: "equal_principal", paymentCents: 16_667, endDate: "2031-01-15" }), START],
    [
      "a euribor annuity whose rate falls and rises",
      loan({ repayment: "annuity", reference: "euribor_3", marginBp: 100, paymentCents: 18_871, endDate: "2031-01-15", ratePath: [[START, 5_000], ["2026-04-15", 3_500], ["2026-10-15", 4_500]] }),
      START,
    ],
  ])("gives one loan what loanWhatIf gives it for the same payment: %s", (_, one, day) => {
    const plan = payoffPlan([one], day, 10_000, FULL)!;
    const whatIf = loanWhatIf(one, day, { paymentCents: planned(one, day) + 10_000 })!.shorter;
    expect(plan.debtFreeDate).toBe(whatIf.endDate);
    expect(plan.savedCents).toBe(whatIf.interestSavedCents);
    expect(plan.debts).toEqual([{ id: "loan-1", order: 1, endDate: whatIf.endDate, baseEndDate: loanSchedule(one, day).summary!.endDate }]);
  });

  it("pays the dearest debt first and passes only the extra money on to the next, never an ended debt's own payment", () => {
    const card = loan({ id: "card", kind: "card", repayment: null, balanceCents: 150_000, rateBp: 2_000, paymentCents: 5_000 });
    const credit = loan({ id: "credit", balanceCents: 700_000, rateBp: 900, paymentCents: 22_000 });
    const small = loan({ id: "small", balanceCents: 40_000, rateBp: 1_200, paymentCents: 2_000 });
    const plan = payoffPlan([credit, small, card], START, 15_000, FULL)!;
    expect(plan.debts.map((d) => [d.id, d.order])).toEqual([["card", 1], ["small", 2], ["credit", 3]]);
    for (const d of plan.debts) expect(d.endDate < d.baseEndDate).toBe(true);
    expect(plan.debtFreeDate < plan.baseDebtFreeDate).toBe(true);
    expect(plan.savedCents).toBeGreaterThan(0);
    // the smallest first costs a few euros more here, under the 50 € a view shows it from
    expect(plan.snowballExtraCents).toBeGreaterThanOrEqual(0);
    expect(plan.snowballExtraCents).toBe(3_252);
  });

  // Worked out with a small throwaway script that shares no code with the app: each month the interest of a loan is
  // balance x rate / 12 to the cent (a half up), the payment is the annuity formula rounded to the cent (230,72 € for
  // A over 24 months, 290,81 € for B over 36), the last due date pays what is left, and the 100 € goes to the dearer
  // loan (A) with what it does not need on to B in the same month. Without extra A ends in month 24 and B in 36, the
  // interest of both is 1 006,67 €. With it A ends in month 17 (15.6.2027), B in month 31 (15.8.2028) and the interest
  // is 798,59 €: 208,08 € saved. The ended A's 230,72 € is not passed on in either run.
  it("ends two annuities and saves what the extra money alone saves, to the cent", () => {
    const dear = loan({ id: "dear", repayment: "annuity", balanceCents: 500_000, rateBp: 1_000, paymentCents: 23_072, endDate: "2028-01-15" });
    const cheap = loan({ id: "cheap", repayment: "annuity", balanceCents: 1_000_000, rateBp: 300, paymentCents: 29_081, endDate: "2029-01-15" });
    expect(payoffPlan([dear, cheap], START, 10_000, FULL)).toEqual({
      debtFreeDate: "2028-08-15",
      baseDebtFreeDate: "2029-01-15",
      savedCents: 20_808,
      bufferCents: 0,
      bufferFullDate: null,
      debts: [
        { id: "dear", order: 1, endDate: "2027-06-15", baseEndDate: "2028-01-15" },
        { id: "cheap", order: 2, endDate: "2028-08-15", baseEndDate: "2029-01-15" },
      ],
      snowballExtraCents: 0,
    });
    // no extra money, no saving: the debts end on their own dates
    expect(payoffPlan([dear, cheap], START, 0, FULL)).toMatchObject({ debtFreeDate: "2029-01-15", baseDebtFreeDate: "2029-01-15", savedCents: 0 });
  });

  it("tells what the smallest debt first costs more than the dearest first", () => {
    const dear = loan({ id: "dear", balanceCents: 1_500_000, rateBp: 1_990, paymentCents: 30_000 });
    const cheap = loan({ id: "cheap", balanceCents: 300_000, rateBp: 200, paymentCents: 5_000 });
    const plan = payoffPlan([dear, cheap], START, 20_000, FULL)!;
    expect(plan.debts.map((d) => d.id)).toEqual(["dear", "cheap"]);
    expect(plan.snowballExtraCents).toBeGreaterThanOrEqual(5_000);
  });

  it("fills the buffer up to a month of spending before any extra money goes to a debt", () => {
    const one = loan();
    const full = payoffPlan([one], START, 50_000, FULL)!;
    // 1 000 € in the accounts against 3 000 € of a usual month: 2 000 €, four months of 500 €
    const short = payoffPlan([one], START, 50_000, { netCents: 100_000, spendCents: 300_000 })!;
    expect(full).toMatchObject({ bufferCents: 0, bufferFullDate: null });
    expect(short).toMatchObject({ bufferCents: 200_000, bufferFullDate: "2026-04-15" });
    expect(short.debtFreeDate > full.debtFreeDate).toBe(true);
    expect(short.savedCents).toBeLessThan(full.savedCents);
  });

  it("never pays a free debt early, and leaves a card paid in full out", () => {
    const free = loan({ id: "free", kind: "instalment", balanceCents: 60_000, rateBp: 0, paymentCents: 5_000, endDate: "2027-01-15" });
    const small = loan({ id: "small", balanceCents: 40_000, rateBp: 1_200, paymentCents: 2_000 });
    const card = settledCardLoan(loan({ id: "card", kind: "card", repayment: null, rateBp: null, paymentCents: null, balanceCents: 80_000 }), "2026-02-01");
    const plan = payoffPlan([free, small, card], START, 15_000, FULL)!;
    expect(plan.debts.map((d) => [d.id, d.order])).toEqual([["small", 1], ["free", null]]);
    const freeEnd = plan.debts.find((d) => d.id === "free")!;
    expect(freeEnd.endDate).toBe(freeEnd.baseEndDate);
  });

  it("ranks a debt with a rate step by its cost over the whole plan, not by today's 0 %", () => {
    const promo = loan({ id: "promo", balanceCents: 240_000, rateBp: 0, paymentCents: 10_000, ratePath: [[START, 0], ["2026-07-01", 19_900]] });
    const mid = loan({ id: "mid", balanceCents: 300_000, rateBp: 1_000, paymentCents: 10_000 });
    expect(debtCost(promo, START)!.rateMilli).toBeGreaterThan(debtCost(mid, START)!.rateMilli!);
    expect(payoffPlan([mid, promo], START, 20_000, FULL)!.debts.map((d) => d.id)).toEqual(["promo", "mid"]);
  });

  it("plans a debt partly another user's on the viewer's part, as a loan of that size", () => {
    const whole = loan({ repayment: "annuity", paymentCents: 18_872, endDate: "2031-01-15" });
    const half = loan({ repayment: "annuity", balanceCents: 500_000, paymentCents: 9_436, endDate: "2031-01-15" });
    const plan = payoffPlan([{ ...whole, part: { from: 1, to: 2, of: 2 } }], START, 5_000, FULL);
    expect(plan).not.toBeNull();
    expect(plan).toEqual(payoffPlan([half], START, 5_000, FULL));
  });

  it("puts each month's extra money into a loan paid every 3 months: what loanWhatIf gives three months of it on each payment", () => {
    const quarterly = loan({ repayment: "annuity", intervalMonths: 3, paymentCents: annuityPayment(1_000_000, 5_000, 3, 20), endDate: "2031-01-15" });
    const plan = payoffPlan([quarterly], START, 10_000, FULL)!;
    const whatIf = loanWhatIf(quarterly, START, { paymentCents: planned(quarterly, START) + 30_000 })!.shorter;
    expect(plan.debtFreeDate).toBe(whatIf.endDate);
    expect(plan.savedCents).toBe(whatIf.interestSavedCents);
    expect(plan.baseDebtFreeDate).toBe("2031-01-15");
  });

  it("has no plan when a debt that owes has none, or nothing is owed", () => {
    expect(payoffPlan([loan(), loan({ id: "no-rate", rateBp: null })], START, 10_000, FULL)).toBeNull();
    expect(payoffPlan([loan(), loan({ id: "no-payment", paymentCents: null })], START, 10_000, FULL)).toBeNull();
    expect(payoffPlan([], START, 10_000, FULL)).toBeNull();
  });
});

describe("consolidation", () => {
  const card = loan({ id: "card", kind: "card", repayment: null, balanceCents: 150_000, rateBp: 2_000, paymentCents: 5_000 });
  const credit = loan({ id: "credit", balanceCents: 700_000, rateBp: 900, paymentCents: 22_000 });
  const home = loan({ id: "home", kind: "mortgage", balanceCents: 15_000_000, rateBp: 300, paymentCents: 70_000 });

  it("sets what the dear debts cost from here against one loan at the typed terms", () => {
    const basis = consolidationBasis([card, credit, home], START)!;
    expect(basis.debtIds).toEqual(["card", "credit"]);
    expect(basis.owedCents).toBe(150_000 + 700_000);
    expect(basis.nowCents).toBe(debtCost(card, START)!.leftCents! + debtCost(credit, START)!.leftCents!);
    const offer = consolidationCost(basis, START, { rateBp: 600, months: 60, feeCents: 500 })!;
    expect(offer.nowCents).toBe(basis.nowCents);
    expect(offer.newCents).toBeGreaterThan(30_000);
    expect(offer.savedCents).toBe(offer.nowCents - offer.newCents);
    // at 0 % the new loan costs its fees alone
    expect(consolidationCost(consolidationBasis([card, credit], START)!, START, { rateBp: 0, months: 60, feeCents: 500 })!.newCents).toBe(30_000);
  });

  it("prices no offer whose months are not a whole number of at least one", () => {
    const basis = consolidationBasis([card], START)!;
    expect(consolidationCost(basis, START, { rateBp: 600, months: 0, feeCents: 0 })).toBeNull();
    expect(consolidationCost(basis, START, { rateBp: 600, months: 12.5, feeCents: 0 })).toBeNull();
  });

  it("is shown for two dear debts or one very dear, and never for cheap ones", () => {
    expect(consolidationBasis([credit, home], START)).toBeNull();
    expect(consolidationBasis([card], START)!.debtIds).toEqual(["card"]);
  });
});

describe("extraPlan", () => {
  it("is payoffPlan with what the debts owe each month, from today to the first month that owes nothing", () => {
    const one = loan({ repayment: "annuity", paymentCents: 18_871, endDate: "2031-01-15" });
    const base = extraPlan([one], START, 0, FULL)!;
    const more = extraPlan([one], START, 10_000, FULL)!;
    expect(more.plan).toEqual(payoffPlan([one], START, 10_000, FULL));
    expect(base.owedCents[0]).toBe(1_000_000);
    expect(more.owedCents[0]).toBe(1_000_000);
    expect(base.owedCents.at(-1)).toBe(0);
    expect(more.owedCents.at(-1)).toBe(0);
    expect(more.owedCents.length).toBeLessThan(base.owedCents.length);
    // the extra money pays the debt down faster from the first month on
    expect(base.owedCents[1]! - more.owedCents[1]!).toBeGreaterThanOrEqual(10_000);
    expect(more.owedCents.every((owed, k) => owed <= base.owedCents[k]!)).toBe(true);
  });

  it("starts with the card paid in full among the debts, as the line of the debts' own payments does", () => {
    const annuityLoan = loan({ id: "annuity", repayment: "annuity", paymentCents: 18_871, endDate: "2031-01-15" });
    const card = settledCardLoan(loan({ id: "card", kind: "card", repayment: null, rateBp: null, paymentCents: null, balanceCents: 80_000 }), "2026-02-01");
    const path = debtPath([annuityLoan, card], START)!;
    const none = extraPlan([annuityLoan, card], START, 0, FULL)!;
    const more = extraPlan([annuityLoan, card], START, 10_000, FULL)!;
    expect(path.balanceCents[0]).toBe(1_080_000);
    expect(none.owedCents[0]).toBe(path.balanceCents[0]);
    expect(more.owedCents[0]).toBe(path.balanceCents[0]);
    // with no extra money the two lines are the same line, and the extra money only lowers it
    expect(none.owedCents).toEqual(path.balanceCents);
    expect(none.debtFreeDate).toBe(path.payoff);
    more.owedCents.forEach((owed, k) => expect(owed, `month ${k}`).toBeLessThanOrEqual(path.balanceCents[k]!));
  });

  it("ends on the card's day when a card paid in full is the last to be paid", () => {
    const short = loan({ id: "short", repayment: "annuity", balanceCents: 100_000, paymentCents: 10_000, rateBp: 1_000, endDate: "2026-06-15" });
    const card = settledCardLoan(loan({ id: "card", kind: "card", repayment: null, rateBp: null, paymentCents: null, balanceCents: 80_000 }), "2026-12-01");
    const path = debtPath([short, card], START)!;
    const more = extraPlan([short, card], START, 10_000, FULL)!;
    expect(more.plan.debtFreeDate < path.payoff!).toBe(true);
    expect(more.debtFreeDate).toBe(path.payoff);
    expect(more.owedCents).toHaveLength(path.days.length);
    expect(more.owedCents.at(-1)).toBe(0);
  });

  it("has no plan where payoffPlan has none", () => {
    expect(extraPlan([], START, 10_000, FULL)).toBeNull();
  });
});
