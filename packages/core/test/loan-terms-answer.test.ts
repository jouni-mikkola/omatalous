/**
 * The question of a saved loan whose payments cannot be placed: the one fact the plan lacks, asked while the loan owes,
 * and the mark that sets it aside. Made-up loans and sums.
 */
import { describe, expect, it } from "vitest";
import { loanTermsDismissed, loanTermsMissing, loanTermsSubject, parseLoanTermsSubject } from "../src/loan-terms-answer.ts";
import type { Loan } from "../src/types.ts";

const loan = (over: Partial<Loan> = {}): Loan => ({
  id: "loan-1", name: "Asuntolaina", lender: null, kind: "mortgage", grantedCents: null, balanceCents: 15_000_000, balanceDate: "2026-10-01",
  rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null,
  ...over,
});

describe("the fact a loan lacks", () => {
  it("is the first the plan needs", () => {
    expect(loanTermsMissing(loan())).toBe("repayment");
    expect(loanTermsMissing(loan({ repayment: "bullet" }))).toBe("end_date");
    expect(loanTermsMissing(loan({ repayment: "annuity" }))).toBe("interval");
    expect(loanTermsMissing(loan({ repayment: "annuity", intervalMonths: 1 }))).toBe("payment");
    expect(loanTermsMissing(loan({ repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 }))).toBe("rate");
  });
  it("is none for a plan that resolves, and a loan with an equal principal needs no rate", () => {
    expect(loanTermsMissing(loan({ repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, rateBp: 350 }))).toBeNull();
    expect(loanTermsMissing(loan({ repayment: "equal_principal", intervalMonths: 1, paymentCents: 90_000 }))).toBeNull();
    expect(loanTermsMissing(loan({ repayment: "bullet", endDate: "2030-01-01" }))).toBeNull();
  });
  it("is none for a loan that owes nothing, a card and a credit line", () => {
    expect(loanTermsMissing(loan({ balanceCents: 0 }))).toBeNull();
    expect(loanTermsMissing(loan({ kind: "card", limitCents: 200_000 }))).toBeNull();
    expect(loanTermsMissing(loan({ kind: "credit_line", limitCents: 200_000 }))).toBeNull();
  });
});

describe("the mark that sets the question aside", () => {
  it("is one subject per loan, read back only from its own form", () => {
    const subject = loanTermsSubject("loan-1");
    expect(parseLoanTermsSubject(subject)).toBe("loan-1");
    expect(parseLoanTermsSubject("question:loan-terms:")).toBeNull();
    expect(parseLoanTermsSubject("question:loan-terms:a:b")).toBeNull();
    expect(parseLoanTermsSubject("question:payee:loan-1")).toBeNull();
  });
  it("holds for the loan it names and only as a dismissal", () => {
    const marks = [{ subject: loanTermsSubject("loan-1"), mark: "dismissed" as const }];
    expect(loanTermsDismissed(marks, "loan-1")).toBe(true);
    expect(loanTermsDismissed(marks, "loan-2")).toBe(false);
    expect(loanTermsDismissed([{ subject: loanTermsSubject("loan-1"), mark: "in_use" as const }], "loan-1")).toBe(false);
  });
});
