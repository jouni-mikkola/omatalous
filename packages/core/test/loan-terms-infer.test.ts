/**
 * The terms a loan's payment rows tell, from made-up rows in the styles banks pay them: on the due day or moved past a
 * weekend, monthly or every quarter, an annuity that steps at its reviews, an equal principal that falls, a fixed
 * instalment that holds. Made-up sums and days.
 */
import { describe, expect, it } from "vitest";
import { addMonthsToDate } from "../src/dates.ts";
import { inferLoanTerms } from "../src/loan-terms-infer.ts";

/** Rows every `months` months from `first`, the payment of each from its index. */
const rows = (first: string, count: number, cents: (i: number) => number, months = 1) =>
  Array.from({ length: count }, (_, i) => ({ date: addMonthsToDate(first, i * months), cents: cents(i) }));

/** The same rows with some days moved, as a bank moves a payment that falls on a weekend. */
const moved = (list: { date: string; cents: number }[], days: Record<number, string>) => list.map((r, i) => (days[i] ? { ...r, date: days[i] } : r));

describe("the latest payment and its due date", () => {
  it("is nothing without a row, and one row tells its payment and day alone", () => {
    expect(inferLoanTerms([])).toBeNull();
    expect(inferLoanTerms([{ date: "2026-10-16", cents: 45_000 }])).toEqual({ paymentCents: 45_000, dueDate: "2026-10-16", intervalMonths: null, repayment: null, reference: null, nextReview: null });
  });
  it("takes the newest payment, not the usual one, in any row order", () => {
    const list = rows("2026-05-10", 6, (i) => (i < 5 ? 40_000 : 45_000));
    expect(inferLoanTerms(list)).toMatchObject({ paymentCents: 45_000, dueDate: "2026-10-10", intervalMonths: 1 });
    expect(inferLoanTerms([...list].reverse())).toEqual(inferLoanTerms(list));
  });
  it("keeps the due day when the latest payment was moved past a weekend", () => {
    const list = moved(rows("2026-01-16", 11, () => 84_364), { 4: "2026-05-18", 10: "2026-11-17" });
    expect(inferLoanTerms(list)).toMatchObject({ paymentCents: 84_364, dueDate: "2026-11-16", intervalMonths: 1 });
  });
  it("reads a due day at the end of the month in a short month and past a month's turn", () => {
    const list = [
      { date: "2026-01-31", cents: 30_000 },
      { date: "2026-02-28", cents: 30_000 },
      { date: "2026-03-31", cents: 30_000 },
      { date: "2026-04-30", cents: 30_000 },
      { date: "2026-06-01", cents: 30_000 },
    ];
    expect(inferLoanTerms(list)).toMatchObject({ dueDate: "2026-05-31", intervalMonths: 1 });
  });
  it("reads payments every quarter", () => {
    expect(inferLoanTerms(rows("2025-01-30", 8, () => 120_000, 3))).toMatchObject({ dueDate: "2026-10-30", intervalMonths: 3 });
  });
  it("keeps the usual interval when a month's payment is missing", () => {
    const list = rows("2026-01-10", 10, () => 40_000).filter((_, i) => i !== 4);
    expect(inferLoanTerms(list)).toMatchObject({ dueDate: "2026-10-10", intervalMonths: 1 });
  });
});

describe("the way of paying back", () => {
  it("is an annuity on the 12 month euribor when the payment steps once a year", () => {
    const list = moved(rows("2024-11-16", 25, (i) => (i < 12 ? 82_100 : i < 24 ? 84_364 : 86_141)), { 18: "2026-05-18" });
    expect(inferLoanTerms(list)).toEqual({ paymentCents: 86_141, dueDate: "2026-11-16", intervalMonths: 1, repayment: "annuity", reference: "euribor_12", nextReview: "2027-11-16" });
  });
  it("is an annuity on the 6 month euribor when the payment steps every half year", () => {
    const cents = [51_230, 49_810, 48_795, 48_040];
    const list = rows("2025-03-01", 20, (i) => cents[i < 4 ? 0 : i < 10 ? 1 : i < 16 ? 2 : 3]!);
    expect(inferLoanTerms(list)).toMatchObject({ paymentCents: 48_040, repayment: "annuity", reference: "euribor_6", nextReview: "2027-01-01" });
  });
  it("is an annuity on the 3 month euribor when the payment steps every quarter", () => {
    const cents = [30_000, 31_000, 30_500, 29_600, 29_000];
    const list = rows("2025-12-05", 12, (i) => cents[Math.floor((i + 1) / 3)]!);
    expect(inferLoanTerms(list)).toMatchObject({ paymentCents: 29_000, repayment: "annuity", reference: "euribor_3", nextReview: "2027-02-05" });
  });
  it("is an annuity on the 3 month euribor from two steps a quarter apart", () => {
    const list = rows("2026-01-05", 8, (i) => (i < 3 ? 30_000 : i < 6 ? 31_000 : 30_500));
    expect(inferLoanTerms(list)).toMatchObject({ repayment: "annuity", reference: "euribor_3", nextReview: "2026-10-05" });
  });
  it("tells no euribor from one step: a fixed loan whose payment changed once", () => {
    const list = rows("2025-09-10", 14, (i) => (i < 8 ? 18_990 : 19_450));
    expect(inferLoanTerms(list)).toMatchObject({ paymentCents: 19_450, intervalMonths: 1, repayment: null, reference: null, nextReview: null });
  });
  it("tells no cycle from an extra payment booked late in a month", () => {
    const list = [...rows("2025-10-10", 14, () => 40_000), { date: "2026-03-27", cents: 200_000 }];
    expect(inferLoanTerms(list)).toMatchObject({ paymentCents: 40_000, intervalMonths: 1, reference: null, nextReview: null });
  });
  it("is an equal principal when the payment falls a little at nearly every payment", () => {
    const falling = rows("2025-11-28", 12, (i) => 125_000 - i * 208);
    expect(inferLoanTerms(falling)).toMatchObject({ paymentCents: 125_000 - 11 * 208, repayment: "equal_principal", reference: null, nextReview: null });
    const risenOnce = rows("2025-11-28", 12, (i) => 125_000 - i * 208 + (i >= 6 ? 1_500 : 0));
    expect(inferLoanTerms(risenOnce)).toMatchObject({ repayment: "equal_principal" });
  });
  it("is a fixed instalment when the payment holds for more than a year", () => {
    const list = moved(rows("2025-09-10", 14, () => 18_990), { 3: "2025-12-12" });
    expect(inferLoanTerms(list)).toMatchObject({ repayment: "fixed_instalment", reference: null, nextReview: null });
  });
  it("is not told by a payment held for less than a year, by too few rows or by steps that keep no cycle", () => {
    expect(inferLoanTerms(rows("2026-05-10", 6, () => 18_990))).toMatchObject({ repayment: null });
    expect(inferLoanTerms(rows("2026-09-10", 2, (i) => 18_990 - i * 100))).toMatchObject({ repayment: null });
    const cents = [40_000, 42_000, 41_000];
    const irregular = rows("2026-01-20", 10, (i) => cents[i < 2 ? 0 : i < 7 ? 1 : 2]!);
    expect(inferLoanTerms(irregular)).toMatchObject({ repayment: null, reference: null, nextReview: null });
  });
  it("does not count a change of a cent or two as a step", () => {
    const list = rows("2025-09-10", 14, (i) => 18_990 + (i % 2));
    expect(inferLoanTerms(list)).toMatchObject({ repayment: "fixed_instalment" });
  });
});
