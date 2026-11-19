import { describe, expect, it } from "vitest";
import { debtCost, type SeriesPayment } from "../src/debt-cost.ts";
import { loanSchedule } from "../src/loan-schedule.ts";
import { settledCardLoan } from "../src/loans.ts";
import type { Loan } from "../src/types.ts";

/** A 600 € instalment plan at 0 %, 12 payments of 50 € from the balance date. */
const plan = (over: Partial<Loan> = {}): Loan => ({
  id: "loan-1",
  name: "Osamaksu",
  lender: null,
  kind: "instalment",
  grantedCents: null,
  balanceCents: 60_000,
  balanceDate: "2026-01-15",
  rateBp: 0,
  reference: null,
  marginBp: null,
  repayment: "fixed_instalment",
  intervalMonths: 1,
  paymentCents: 5_000,
  endDate: "2027-01-15",
  limitCents: null,
  seriesKey: null,
  ...over,
});

const START = "2026-01-15";
const withFee = (feeCents: number) => [{ dueDate: START, principalCents: 5_000, interestCents: 0, feeCents }];
/** The three newest payments of the loan's series, each the same sum. */
const paid = (cents: number): SeriesPayment[] => ["2025-10-15", "2025-11-15", "2025-12-15"].map((date) => ({ date, cents }));

describe("debtCost", () => {
  it("prices a 0 % plan with a fee on each payment by its fees: 600 € in 12 × 50 € and 3,95 € a payment is 15,2 %", () => {
    expect(debtCost(plan({ paymentParts: withFee(395) }), START)).toEqual({
      rateMilli: 15_247,
      costClass: "very_dear",
      next12: { cents: 4_740, interestCents: 0, feeCents: 4_740 },
      leftCents: 4_740,
      feePerPaymentCents: 395,
      unknown: null,
    });
    // a longer plan with a smaller fee costs far less a year
    const longer = debtCost(plan({ balanceCents: 120_000, endDate: "2028-01-15", paymentParts: withFee(290) }), START);
    expect(longer).toMatchObject({ rateMilli: 5_611, costClass: "cheap" });
  });

  it("measures the fee from the rows when no document states it", () => {
    expect(debtCost(plan(), START, paid(5_395))).toMatchObject({ rateMilli: 15_247, costClass: "very_dear", next12: { feeCents: 4_740 } });
  });

  it("reads a fee under 1 € on a 0 % plan: 0,99 € a payment is cheap, not free", () => {
    expect(debtCost(plan(), START, paid(5_099))).toMatchObject({ costClass: "cheap", leftCents: 1_188, feePerPaymentCents: 99 });
  });

  it("measures the fee from the rows of a loan with interest", () => {
    const annuity = plan({ kind: "consumer", rateBp: 500, repayment: "annuity", balanceCents: 1_000_000, paymentCents: 18_871, endDate: "2031-01-15", seriesKey: "series-1" });
    const noFee = debtCost(annuity, START, paid(18_871))!;
    const withFee = debtCost(annuity, START, paid(18_871 + 395))!;
    expect(noFee.feePerPaymentCents).toBe(0);
    expect(withFee).toMatchObject({ feePerPaymentCents: 395, next12: { feeCents: 4_740 } });
    expect(withFee.rateMilli).toBeGreaterThan(noFee.rateMilli!);
  });

  it("reads no fee when a euribor falls at a review and the newest rows are still at the old rate", () => {
    const mortgage = plan({ kind: "mortgage", rateBp: 400, reference: "euribor_3", marginBp: 50, repayment: "annuity", balanceCents: 15_000_000, paymentCents: 79_200, endDate: "2051-01-15", seriesKey: "series-1", ratePath: [[START, 4_000], ["2026-04-20", 3_500]] });
    // the payments of 15.3., 15.4. and 15.5. count the old rate; the one of 15.6. is the first at the new one
    const rows = loanSchedule(mortgage, START).rows.slice(1, 4).map((r) => ({ date: r.date, cents: r.interestCents! + r.principalCents }));
    const day = "2026-05-20";
    const next = loanSchedule(mortgage, day).rows[0]!;
    expect(rows.at(-1)!.cents - (next.interestCents! + next.principalCents)).toBeGreaterThan(1_000);
    expect(debtCost(mortgage, day, rows)).toMatchObject({ costClass: "cheap", feePerPaymentCents: 0 });
  });

  it("calls a 0 % plan free only when a document or the rows show no fee", () => {
    const free = { rateMilli: 0, costClass: "free", next12: { cents: 0, interestCents: 0, feeCents: 0 }, leftCents: 0, feePerPaymentCents: 0, unknown: null };
    expect(debtCost(plan({ paymentParts: withFee(0) }), START)).toEqual(free);
    expect(debtCost(plan(), START, paid(5_000))).toEqual(free);
    // nothing tells the fee: the cost is unknown, never 0
    expect(debtCost(plan(), START)).toEqual({ rateMilli: null, costClass: null, next12: null, leftCents: null, feePerPaymentCents: null, unknown: "fee" });
  });

  it("takes the fee the household typed, 0 € included, in place of the unknown one", () => {
    expect(debtCost(plan({ paymentFeeCents: 0 }), START)).toMatchObject({ rateMilli: 0, costClass: "free", feePerPaymentCents: 0, unknown: null });
    expect(debtCost(plan({ paymentFeeCents: 395 }), START)).toMatchObject({ costClass: "very_dear", feePerPaymentCents: 395, next12: { feeCents: 4_740 }, unknown: null });
    expect(debtCost(plan({ paymentFeeCents: null }), START)).toMatchObject({ unknown: "fee" });
  });

  it("judges a promotional rate over the whole plan left: the sooner the step, the dearer", () => {
    const promo = (step: string) => plan({ balanceCents: 240_000, paymentCents: 10_000, endDate: null, ratePath: [[START, 0], [step, 19_900]], paymentParts: withFee(0) });
    const late = debtCost(promo("2027-03-01"), START)!;
    const soon = debtCost(promo("2026-07-01"), START)!;
    expect(late.rateMilli).toBeGreaterThan(0);
    expect(soon.rateMilli).toBeGreaterThan(late.rateMilli!);
    expect(soon.rateMilli).toBeLessThan(19_900);
    expect(late.costClass).toBe("cheap");
    expect(soon.costClass).toBe("dear");
    // the 12 months before the step pay no interest, those after it do
    expect(late.next12).toEqual({ cents: 0, interestCents: 0, feeCents: 0 });
    expect(soon.next12!.interestCents).toBeGreaterThan(0);
  });

  it("leaves a card paid in full out: it costs nothing and is no debt to pay down", () => {
    const card = plan({ kind: "card", rateBp: null, repayment: null, paymentCents: null, endDate: null, balanceCents: 80_000 });
    expect(debtCost(settledCardLoan(card, "2026-02-01"), START)).toBeNull();
  });

  it("leaves a debt with no rate and no rows unknown, never 0", () => {
    expect(debtCost(plan({ rateBp: null }), START)).toEqual({ rateMilli: null, costClass: null, next12: null, leftCents: null, feePerPaymentCents: null, unknown: "rate" });
    const card = plan({ kind: "card", rateBp: null, repayment: null, paymentCents: null, endDate: null });
    expect(debtCost(card, START)).toMatchObject({ rateMilli: null, costClass: null, next12: null });
  });

  it("prices a loan with no rate from the payments of its series, with no rate assumed", () => {
    const rowsOnly = plan({ rateBp: null, seriesKey: "series-1" });
    expect(debtCost(rowsOnly, START, paid(5_395))).toMatchObject({ rateMilli: 15_247, costClass: "very_dear", next12: { cents: 4_740, interestCents: null, feeCents: null }, leftCents: 4_740, feePerPaymentCents: null });
  });

  it("gives an annuity the same cost from its plan and from its rows, on any day of an interval", () => {
    const annuity = plan({ kind: "consumer", rateBp: 500, repayment: "annuity", balanceCents: 1_000_000, paymentCents: 18_871, endDate: "2031-01-15", seriesKey: "series-1" });
    const rows = paid(18_871);
    const byPlan = debtCost(annuity, START, rows)!;
    const byRows = debtCost({ ...annuity, rateBp: null }, START, rows)!;
    expect(byPlan.costClass).toBe("cheap");
    expect(Math.abs(byPlan.rateMilli! - byRows.rateMilli!)).toBeLessThanOrEqual(10);
    expect(debtCost(annuity, "2026-07-20", rows)!.rateMilli).toBe(byPlan.rateMilli);
  });

  it("cuts the 12 months to the viewer's part and keeps the rate", () => {
    const half = debtCost({ ...plan({ paymentParts: withFee(395) }), part: { from: 1, to: 2, of: 2 } }, START);
    expect(half).toMatchObject({ rateMilli: 15_247, next12: { cents: 2_370, interestCents: 0, feeCents: 2_370 }, leftCents: 2_370 });
  });

  it("gives nothing for a debt paid off on the day", () => {
    expect(debtCost(plan({ paymentParts: withFee(395) }), "2027-02-01")).toBeNull();
  });
});
