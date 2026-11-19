import { describe, expect, it } from "vitest";
import { detectRecurring } from "../src/recurring.ts";
import { typicalAmountOf, yearlyCostOf } from "../src/recurring-cost.ts";
import { CADENCES } from "../src/recurring-cadence.ts";
import { series } from "./helpers.ts";

const today = "2026-10-09";
const monthly = (amounts: number[], merchant = "Netflix") =>
  detectRecurring(series(addStart(amounts.length), 30.44, amounts.length, (i) => -amounts[i]!, { merchant, category: "subscriptions" }), today)[0]!;
/** A start that puts the last charge a few days before today. */
const addStart = (n: number) => new Date(Date.parse(today) - (n - 1) * 30.44 * 86_400_000 - 5 * 86_400_000).toISOString().slice(0, 10);

describe("a subscription keeps every price it had", () => {
  it("dates each step, with its move and what the move adds to a year", () => {
    const s = monthly([...Array(6).fill(999), ...Array(8).fill(1199), ...Array(4).fill(1399)]);
    expect(s.kind).toBe("subscription");
    expect(s.priceSteps!.map(({ cents, deltaCents, yearlyDeltaCents }) => ({ cents, deltaCents, yearlyDeltaCents }))).toEqual([
      { cents: 999, deltaCents: undefined, yearlyDeltaCents: undefined },
      { cents: 1199, deltaCents: 200, yearlyDeltaCents: 2400 },
      { cents: 1399, deltaCents: 200, yearlyDeltaCents: 2400 },
    ]);
    expect(s.priceSteps![0]!.date).toBe(s.firstDate);
    // the last move is the one `priceChange` names, and the price now is the typical charge
    expect(s.priceChange).toEqual({ fromCents: 1199, toCents: 1399, date: s.priceSteps![2]!.date });
    expect(s.typicalAmountCents).toBe(1399);
  });

  it("keeps the one move of a price that rose once, the newest charge alone at the new price included", () => {
    const s = monthly([1599, 1599, 1599, 1599, 1799]);
    expect(s.priceSteps!.map((p) => p.cents)).toEqual([1599, 1799]);
  });

  it("has no steps on a price that never moved, or on a move smaller than a charge's noise", () => {
    expect(monthly(Array(8).fill(1199)).priceSteps).toBeUndefined();
    expect(monthly([1199, 1199, 1199, 1219, 1219]).priceSteps).toBeUndefined();
  });

  it("calls a sum that moves every month or two a bill, with no steps", () => {
    const helen = monthly([5000, 5000, 6200, 5800, 5800, 7000], "Helen");
    expect(helen.kind).toBe("bill");
    expect(helen.priceSteps).toBeUndefined();
    // a price between the first and the newest held only twice is no step
    expect(monthly([999, 999, 1199, 1199, 1399, 1399]).kind).toBe("bill");
  });
});

describe("the typical amount of a series", () => {
  const occurrences = (amounts: number[]) => amounts.map((cents, i) => ({ date: `2026-${String(i + 1).padStart(2, "0")}-16`, cents, ids: [`r${i}`] }));
  const lender = (amounts: number[]) =>
    detectRecurring(series(addStart(amounts.length), 30.44, amounts.length, (i) => -amounts[i]!, { merchant: "Example Lender", category: "loans" }), today)[0]!;

  it("follows the latest charge when the series is back on a price it held before", () => {
    expect(typicalAmountOf(occurrences([40000, 40000, 45000, 45000, 40000]))).toBe(40000);
    expect(lender([40000, 40000, 45000, 45000, 40000]).typicalAmountCents).toBe(40000);
  });

  it("leaves one extra repayment out", () => {
    expect(typicalAmountOf(occurrences([40000, 40000, 40000, 100000, 40000]))).toBe(40000);
    expect(typicalAmountOf(occurrences([40000, 40000, 40000, 40000, 100000]))).toBe(40000);
    expect(lender([40000, 40000, 40000, 100000, 40000, 40000]).typicalAmountCents).toBe(40000);
  });

  it("keeps the median for a lower charge that is no price it held before", () => {
    // the helper alone: detection reads a series like this as a fixed price with a step
    expect(typicalAmountOf(occurrences([45000, 45000, 45000, 40000]))).toBe(45000);
  });

  it("keeps the median for a lower charge that is a price from long ago", () => {
    expect(typicalAmountOf(occurrences([40000, ...Array<number>(8).fill(45000), 40000]))).toBe(45000);
  });

  it("keeps the median of a sum that moves every month", () => {
    expect(typicalAmountOf(occurrences([6120, 7480, 5530, 4210, 6120]))).toBe(5530);
    // the latest charge is lower and was seen before, yet the sums are on no two levels
    expect(typicalAmountOf(occurrences([4210, 7480, 5530, 6120, 4210]))).toBe(5530);
  });

  // a credit paid at 400 € with two repayments of capital (7 300 € and 2 500 €) and two months of 450 €
  const prepaid = [40000, 40000, 40000, 730000, 40000, 250000, 45000, 45000, 40000];
  const monthlyCadence = CADENCES.find((c) => c.id === "monthly")!;

  it("leaves repayments of capital out of the regular instalment", () => {
    expect(typicalAmountOf(occurrences(prepaid))).toBe(40000);
    expect(lender(prepaid).typicalAmountCents).toBe(40000);
    expect(lender(prepaid).monthlyCents).toBe(40000);
  });

  it("counts a repayment of capital as one instalment in a year of a bill", () => {
    const year = occurrences([...prepaid, 40000, 40000, 40000]);
    // ten charges as paid (eight of 400 €, two of 450 €) and the two repayments as 400 € each
    expect(yearlyCostOf(year, monthlyCadence, "bill", typicalAmountOf(year), 12)).toBe(490000);
  });

  it("moves to a new level that is over twice the old one and stays", () => {
    expect(typicalAmountOf(occurrences([1000, 1000, 1000, 1000, 1000, 1000, 2500, 2500, 2500]))).toBe(2500);
    expect(typicalAmountOf(occurrences([1000, 1000, 1000, 1000, 1000, 1000, 1000, 2500, 2600]))).toBe(2500);
  });

  it("keeps every charge of a card bill, whose sum has no regular level", () => {
    const card = [30000, 80000, 150000, 45000, 200000, 60000, 70000, 52000, 180000, 66000, 91000, 40000];
    const year = occurrences(card);
    // the median of the latest three and the sum of the twelve, as before one-off charges were left out
    expect(typicalAmountOf(year)).toBe(66000);
    expect(yearlyCostOf(year, monthlyCadence, "bill", 66000, 12)).toBe(card.reduce((a, b) => a + b, 0));
  });
});
