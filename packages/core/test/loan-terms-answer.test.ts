/**
 * The question of a saved loan whose payments cannot be placed: the one fact the plan lacks, asked while the loan owes,
 * and the mark that sets it aside. Made-up loans and sums.
 */
import { describe, expect, it } from "vitest";
import { loanDrift, loanTermsDismissed, loanTermsDismissible, loanTermsGaps, loanTermsSubject, parseLoanTermsSubject } from "../src/loan-terms-answer.ts";
import { seriesId } from "../src/series-id.ts";
import type { Loan } from "../src/types.ts";

const loan = (over: Partial<Loan> = {}): Loan => ({
  id: "loan-1", name: "Asuntolaina", lender: null, kind: "mortgage", grantedCents: null, balanceCents: 15_000_000, balanceDate: "2026-10-01",
  rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null,
  ...over,
});

/** The first fact a loan lacks, the one asked first. */
const first = (l: Loan) => loanTermsGaps(l)[0] ?? null;

describe("the fact a loan lacks", () => {
  it("is the first the plan needs", () => {
    expect(first(loan())).toBe("repayment");
    expect(first(loan({ repayment: "bullet" }))).toBe("end_date");
    expect(first(loan({ repayment: "annuity" }))).toBe("interval");
    expect(first(loan({ repayment: "annuity", intervalMonths: 1 }))).toBe("payment");
    expect(first(loan({ repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 }))).toBe("rate");
  });
  it("is none for a plan that resolves, and a loan with an equal principal needs no rate", () => {
    expect(first(loan({ repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, rateBp: 350 }))).toBeNull();
    expect(first(loan({ repayment: "equal_principal", intervalMonths: 1, paymentCents: 90_000 }))).toBeNull();
    expect(first(loan({ repayment: "bullet", endDate: "2030-01-01" }))).toBeNull();
  });
  it("is none for a loan that owes nothing, a card and a credit line", () => {
    expect(first(loan({ balanceCents: 0 }))).toBeNull();
    expect(first(loan({ kind: "card", limitCents: 200_000 }))).toBeNull();
    expect(first(loan({ kind: "credit_line", limitCents: 200_000 }))).toBeNull();
  });
});

describe("the facts of a loan on a reference rate", () => {
  const euribor = { repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, rateBp: 350, reference: "euribor_12" } as const;
  it("asks the margin, then the day the rate is reviewed, once the plan resolves", () => {
    expect(first(loan(euribor))).toBe("margin");
    expect(first(loan({ ...euribor, marginBp: 80 }))).toBe("review_date");
    expect(first(loan({ ...euribor, marginBp: 80, rateReviewDate: "2027-01-05" }))).toBeNull();
  });
  it("asks the fact of the plan first, and nothing of a fixed rate or a loan with no reference", () => {
    expect(first(loan({ ...euribor, paymentCents: null }))).toBe("payment");
    expect(first(loan({ ...euribor, reference: "fixed" }))).toBeNull();
    expect(first(loan({ ...euribor, reference: null }))).toBeNull();
  });
});

describe("every fact a loan lacks", () => {
  const euribor = { reference: "euribor_12" } as const;
  it("lists them all in the order they are asked, the first being the one fact asked alone", () => {
    const cases: [Partial<Loan>, string[]][] = [
      [{}, ["repayment", "interval", "payment", "rate"]],
      [euribor, ["repayment", "interval", "payment", "rate", "margin", "review_date"]],
      [{ repayment: "bullet", ...euribor }, ["end_date", "margin", "review_date"]],
      [{ repayment: "bullet", endDate: "2030-01-01" }, []],
      [{ repayment: "equal_principal", intervalMonths: 1 }, ["payment"]],
      [{ repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, ...euribor, marginBp: 80 }, ["rate", "review_date"]],
      [{ repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, rateBp: 350, reference: "fixed" }, []],
      [{ kind: "card", limitCents: 200_000 }, []],
      [{ balanceCents: 0 }, []],
    ];
    for (const [over, gaps] of cases) {
      expect(loanTermsGaps(loan(over)), JSON.stringify(over)).toEqual(gaps);
    }
  });
});

describe("the facts that may be set aside", () => {
  it("are all but the rate, the payment and the fee, which decide what the debt costs", () => {
    expect((((["repayment", "interval", "payment", "rate", "end_date", "margin", "review_date", "fee"]) as const)).filter(loanTermsDismissible)).toEqual(["repayment", "interval", "end_date", "margin", "review_date"]);
  });
});

describe("a payment the plan did not expect", () => {
  const key = seriesId({ direction: "out", accountId: "acc-1", merchant: "Esimerkkirahoitus", product: null });
  const plan = { repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, rateBp: 350, seriesKey: key } as const;
  const row = (bookingDate: string, cents: number, id = bookingDate) => ({ id, accountId: "acc-1", merchant: "Esimerkkirahoitus", amountCents: -cents, bookingDate, status: "booked" as "booked" | "pending" });
  const drift = (over: Partial<Loan>, rows: ReturnType<typeof row>[], after = "") => loanDrift(loan({ ...plan, ...over }), rows, [key], after);

  it("is the newest row of the series that departs from the payment of its due date, with the payment to type", () => {
    expect(drift({}, [row("2026-11-03", 95_000)])).toEqual({ rowId: "2026-11-03", date: "2026-11-03", paidCents: 95_000, expectedCents: 90_000, newPaymentCents: 95_000, reviewDate: null });
  });
  it("lets the bank's rounding pass: 1 euro or 1 per cent, whichever is larger", () => {
    // 1 % of 900 euros is 9 euros
    expect(drift({}, [row("2026-11-01", 90_900)])).toBeNull();
    expect(drift({}, [row("2026-11-01", 89_100)])).toBeNull();
    expect(drift({}, [row("2026-11-01", 90_901)])).not.toBeNull();
    expect(drift({}, [row("2026-11-01", 89_099)])).not.toBeNull();
    // 1 euro of 50 euros is more than 1 %
    expect(drift({ paymentCents: 5_000, balanceCents: 500_000 }, [row("2026-11-01", 5_100)])).toBeNull();
    expect(drift({ paymentCents: 5_000, balanceCents: 500_000 }, [row("2026-11-01", 5_101)])).not.toBeNull();
  });
  it("ends when the newest row fits, and asks the newest one that departs when it does not", () => {
    expect(drift({}, [row("2026-11-03", 95_000), row("2026-12-01", 90_000)])).toBeNull();
    expect(drift({}, [row("2026-11-03", 90_000), row("2026-12-01", 96_000)])).toMatchObject({ rowId: "2026-12-01", newPaymentCents: 96_000 });
  });
  it("goes when the loan is saved on or after the row, and counts no row before its balance date", () => {
    expect(drift({}, [row("2026-11-03", 95_000)], "2026-11-03")).toBeNull();
    expect(drift({}, [row("2026-11-03", 95_000)], "2026-11-02")).not.toBeNull();
    expect(drift({}, [row("2026-09-03", 95_000)])).toBeNull();
  });
  it("leaves out a row no due date is near, as an extra repayment is, and a row of another payee or a pending row", () => {
    expect(drift({}, [row("2026-11-15", 300_000)])).toBeNull();
    expect(drift({}, [{ ...row("2026-11-03", 95_000), merchant: "Kahvila" }])).toBeNull();
    expect(drift({}, [{ ...row("2026-11-03", 95_000), status: "pending" }])).toBeNull();
  });
  it("asks nothing of a loan with no linked payments, a card, a credit line, a loan that owes nothing or one whose plan lacks a fact", () => {
    const rows = [row("2026-11-03", 95_000)];
    expect(drift({ seriesKey: null }, rows)).toBeNull();
    expect(drift({ kind: "card", limitCents: 200_000 }, rows)).toBeNull();
    expect(drift({ kind: "credit_line", limitCents: 200_000 }, rows)).toBeNull();
    expect(drift({ balanceCents: 0 }, rows)).toBeNull();
    expect(drift({ paymentCents: null }, rows)).toBeNull();
  });
  it("types an equal principal's amortisation alone, the interest coming on top", () => {
    // 150 000 euros at 3,5 % for a month is 437,50 euros of interest
    expect(drift({ repayment: "equal_principal" }, [row("2026-11-01", 138_750)])).toMatchObject({ expectedCents: 133_750, newPaymentCents: 95_000 });
  });
  it("proposes the due date it moved on as the review day of a loan on a reference rate", () => {
    expect(drift({ reference: "euribor_12", marginBp: 80 }, [row("2026-11-03", 95_000)])).toMatchObject({ newPaymentCents: 95_000, reviewDate: "2026-11-01" });
  });
});

describe("the mark that sets the question aside", () => {
  it("is one subject per loan, read back only from its own form", () => {
    const subject = loanTermsSubject("loan-1");
    expect(parseLoanTermsSubject(subject)).toBe("loan-1");
    expect(parseLoanTermsSubject("question:loan-terms:")).toBeNull();
    expect(parseLoanTermsSubject("question:loan-terms:a:b")).toBeNull();
    // a card no saved loan is linked to is named by its debt's id
    expect(parseLoanTermsSubject(loanTermsSubject("account:acc-1"))).toBe("account:acc-1");
    expect(parseLoanTermsSubject("question:loan-terms:account:")).toBeNull();
    expect(parseLoanTermsSubject("question:loan-terms:account:a:b")).toBeNull();
    expect(parseLoanTermsSubject("question:payee:loan-1")).toBeNull();
  });
  it("holds for the loan it names and only as a dismissal", () => {
    const marks = [{ subject: loanTermsSubject("loan-1"), mark: "dismissed" as const }];
    expect(loanTermsDismissed(marks, "loan-1")).toBe(true);
    expect(loanTermsDismissed(marks, "loan-2")).toBe(false);
    expect(loanTermsDismissed([{ subject: loanTermsSubject("loan-1"), mark: "in_use" as const }], "loan-1")).toBe(false);
  });
});
