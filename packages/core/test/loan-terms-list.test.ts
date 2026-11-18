/**
 * The list of Täydennä lainat: each debt once, the largest year of payments first, a debt with no known payment last and
 * never weighed as 0, and a saved loan that is complete leaves it. Made-up debts and sums.
 */
import { describe, expect, it } from "vitest";
import { loanTermsList, loanTermsListCents, loanTermsResult, openLoanGaps, savedLoanYearCents, type ListedDebt } from "../src/loan-terms-list.ts";
import type { Loan } from "../src/types.ts";

const loan = (over: Partial<Loan> = {}): Loan => ({
  id: "loan-1", name: "Asuntolaina", lender: null, kind: "mortgage", grantedCents: null, balanceCents: 15_000_000, balanceDate: "2026-10-01",
  rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null,
  ...over,
});

const debt = (id: string, yearCents: number | null, seriesId: string | null = null): ListedDebt & { from: string } => ({ id, seriesId, yearCents, from: id });

describe("the debts of the list", () => {
  it("lists a debt once when two sources tell it, by its id or by its series, and the first source keeps it", () => {
    const listed = loanTermsList([debt("loan:a", 120_000, "s1"), debt("proposal:a", 130_000, "s1"), debt("loan:a", 50_000), debt("card:b", 60_000)]);
    expect(listed.map((d) => d.id)).toEqual(["loan:a", "card:b"]);
    expect(listed[0]!.yearCents).toBe(120_000);
  });
  it("puts the largest year of payments first and the debts with no known payment last, in the order told", () => {
    const listed = loanTermsList([debt("x", null), debt("small", 55_200), debt("y", null), debt("large", 1_033_692)]);
    expect(listed.map((d) => d.id)).toEqual(["large", "small", "x", "y"]);
  });
  it("keeps a debt with no known payment, which counts as no payment and not as 0", () => {
    expect(loanTermsList([debt("zero", 0), debt("unknown", null)]).map((d) => d.id)).toEqual(["zero", "unknown"]);
  });
  it("adds only the known years of payments, and tells no sum when none is known", () => {
    expect(loanTermsListCents([debt("a", 120_000), debt("b", null), debt("c", 5_000)])).toBe(125_000);
    expect(loanTermsListCents([debt("a", null)])).toBeNull();
    expect(loanTermsListCents([])).toBeNull();
  });
});

describe("a saved loan in the list", () => {
  it("weighs a year of its typed payments, none while the payment or the interval is not known", () => {
    expect(savedLoanYearCents(loan({ paymentCents: 90_000, intervalMonths: 1 }))).toBe(1_080_000);
    expect(savedLoanYearCents(loan({ paymentCents: 90_000, intervalMonths: 3 }))).toBe(360_000);
    expect(savedLoanYearCents(loan({ paymentCents: null, intervalMonths: 1 }))).toBeNull();
    expect(savedLoanYearCents(loan({ paymentCents: 0, intervalMonths: 1 }))).toBeNull();
  });
  it("leaves the list once it is complete, or once it owes nothing", () => {
    const full = { repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, rateBp: 350 } as const;
    expect(openLoanGaps(loan(full), 15_000_000, false)).toEqual([]);
    expect(openLoanGaps(loan(), 0, false)).toEqual([]);
    expect(openLoanGaps(loan({ ...full, rateBp: null }), 15_000_000, false)).toEqual(["rate"]);
  });
  it("closes into what it owes, its rate and its plan's end once saved, and tells no rate or end it does not know", () => {
    const result = loanTermsResult(loan({ balanceCents: 1_000_000, repayment: "annuity", intervalMonths: 1, paymentCents: 100_000, rateBp: 500 }), {}, "2026-10-01");
    expect(result.owedCents).toBe(1_000_000);
    expect(result.rateMilli).toBe(5_000);
    expect(result.endDate).not.toBeNull();
    expect(result.interestLeftCents).toBeGreaterThan(0);
    const card = loanTermsResult(loan({ kind: "card", balanceCents: 50_000, limitCents: 200_000, rateBp: null }), {}, "2026-10-01");
    expect(card).toEqual({ owedCents: 50_000, rateMilli: null, endDate: null, interestLeftCents: null });
  });
  it("keeps asking the rate and the payment of a loan set aside, and nothing else", () => {
    expect(openLoanGaps(loan(), 15_000_000, true)).toEqual(["payment", "rate"]);
    expect(openLoanGaps(loan({ repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, rateBp: 350, reference: "euribor_12" }), 15_000_000, true)).toEqual([]);
  });
});
