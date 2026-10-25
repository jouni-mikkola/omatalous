/**
 * The months "tavallisesti" is read from, by category or by day (`itemisedMonthsBefore`): none while they hold card bills
 * of a card the rows do not itemise, as in a household whose card begins in the middle of the history. The month
 * totals stay comparable and keep their usual level.
 */
import { describe, expect, it } from "vitest";
import { cardsBreakUsual, completeMonthsBefore, itemisedMonthsBefore, usualSpending } from "../src/analysis/usual.ts";
import { lateCardContext } from "./late-card-household.ts";

describe("a card that begins in the middle of the history", () => {
  const late = lateCardContext("2026-07");

  it("holds the months before its first row as card bills: they cannot be compared by category or by day", () => {
    // April to June hold the bills and none of the purchases
    expect(completeMonthsBefore(late, "2026-10")).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(cardsBreakUsual(late, "2026-10")).toBe(true);
    expect(itemisedMonthsBefore(late, "2026-10")).toEqual([]);
  });

  it("covers a month once the window has left the bills behind", () => {
    // February 2027: the window is August to January, all with the card's rows
    const later = lateCardContext("2026-07", "2027-02-09");
    expect(cardsBreakUsual(later, "2027-02")).toBe(false);
    expect(itemisedMonthsBefore(later, "2027-02")).toEqual(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
    // January 2027 reads July to December: July is the card's first month, June's bill is outside
    expect(cardsBreakUsual(later, "2027-01")).toBe(false);
  });

  it("leaves the month totals their usual level: a bill counts as spending", () => {
    expect(usualSpending(late, "2026-10")).not.toBeNull();
  });
});

describe("a card that begins in the middle of the history with no card bills before it", () => {
  const bare = lateCardContext("2026-07", "2026-10-09", false);

  it("cannot be compared by category either: the months before its history hold none of its purchases", () => {
    expect(completeMonthsBefore(bare, "2026-10").length).toBeGreaterThanOrEqual(3);
    expect(cardsBreakUsual(bare, "2026-10")).toBe(true);
    expect(itemisedMonthsBefore(bare, "2026-10")).toEqual([]);
  });

  it("compares again once the window is inside the card's history", () => {
    const later = lateCardContext("2026-07", "2027-02-09", false);
    expect(cardsBreakUsual(later, "2027-02")).toBe(false);
  });
});

describe("a card whose rows cover every month to compare", () => {
  const early = lateCardContext("2026-01");

  it("is compared by category", () => {
    expect(cardsBreakUsual(early, "2026-10")).toBe(false);
    expect(itemisedMonthsBefore(early, "2026-10")).toEqual(completeMonthsBefore(early, "2026-10"));
    expect(itemisedMonthsBefore(early, "2026-10")).toHaveLength(6);
  });
});

describe("under three complete months", () => {
  it("is no card gap: there is simply nothing to compare", () => {
    expect(cardsBreakUsual(lateCardContext("2026-07"), "2026-02")).toBe(false);
  });
});
