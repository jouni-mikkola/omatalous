/**
 * The months the expected figure is read from, by category or by day (`expectedFor(...).itemised`): not itemised while
 * they hold card bills of a card the rows do not itemise, as in a household whose card begins in the middle of the
 * history. The month totals stay comparable and keep their expected level.
 */
import { describe, expect, it } from "vitest";
import { expectedFor, expectedSpending } from "../src/analysis/expected.ts";
import { cardsBreakUsual, completeMonthsBefore } from "../src/analysis/usual.ts";
import { lateCardContext } from "./late-card-household.ts";

describe("a card that begins in the middle of the history", () => {
  const late = lateCardContext("2026-07");

  it("holds the months before its first row as card bills: they cannot be compared by category or by day", () => {
    // April to June hold the bills and none of the purchases
    expect(completeMonthsBefore(late, "2026-10")).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(cardsBreakUsual(late, "2026-10")).toBe(true);
    expect(expectedFor(late, "2026-10")!.itemised).toBe(false);
  });

  it("covers a month once the window has left the bills behind", () => {
    // February 2027: the window is August to January, all with the card's rows
    const later = lateCardContext("2026-07", "2027-02-09");
    expect(cardsBreakUsual(later, "2027-02")).toBe(false);
    expect(expectedFor(later, "2027-02")).toMatchObject({ itemised: true, months: ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"] });
    // January 2027 reads July to December: July is the card's first month, June's bill is outside
    expect(cardsBreakUsual(later, "2027-01")).toBe(false);
  });

  it("leaves the month totals their expected level: a bill counts as spending", () => {
    expect(expectedSpending(late, "2026-10")).not.toBeNull();
  });
});

describe("a card that begins in the middle of the history with no card bills before it", () => {
  const bare = lateCardContext("2026-07", "2026-10-09", false);

  it("is compared by category over the card's own months: the figure reads no month before its history", () => {
    expect(completeMonthsBefore(bare, "2026-10").length).toBeGreaterThanOrEqual(3);
    // the complete months before October lack the card's purchases, which is why a figure with too few months says "cards"
    expect(cardsBreakUsual(bare, "2026-10")).toBe(true);
    // the figure starts where the card's rows do (`usualBase`), and those months hold its purchases
    expect(expectedFor(bare, "2026-10")).toMatchObject({ itemised: true, months: ["2026-07", "2026-08", "2026-09"] });
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
    expect(expectedFor(early, "2026-10")).toMatchObject({ itemised: true, months: completeMonthsBefore(early, "2026-10") });
    expect(expectedFor(early, "2026-10")!.months).toHaveLength(6);
  });
});

describe("under three complete months", () => {
  it("is no card gap: there is simply nothing to compare", () => {
    expect(cardsBreakUsual(lateCardContext("2026-07"), "2026-02")).toBe(false);
  });
});
